import {
  isValidEmail,
  isValidUsername,
  issueSession,
  normalizeEmail,
  PENDING_TTL_MS,
  verifyPassword,
  verifyTurnstile,
} from "@/lib/auth";
import { generateToken, hashToken } from "@/lib/crypto";
import {
  getClientIp,
  handleApiError,
  json,
  jsonError,
  jsonOk,
  rateLimitedError,
  readJsonBody,
  setPendingCookie,
  setSessionCookie,
} from "@/lib/http";
import { getStore } from "@/lib/store";

/**
 * POST /api/auth/login
 * Username OR email + password. Accounts with 2FA enabled get a short-lived
 * pending cookie and must finish via POST /api/auth/2fa/verify; everyone
 * else is signed straight in.
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    // Bot protection first — before any credential or DB work, so a bot that
    // hasn't solved the widget never reaches the password check or rate tables.
    // Enforced only when BOTH Turnstile keys are configured (see verifyTurnstile).
    const turnstileToken =
      typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;
    if (!(await verifyTurnstile(turnstileToken))) {
      return jsonError("Bot check failed. Please try again.", 400);
    }

    const identifier = (typeof body.email === "string" ? body.email : "").trim();
    const password = typeof body.password === "string" ? body.password : "";
    const remember = body.remember !== false; // default: remember
    if ((!identifier || (!isValidEmail(identifier) && !isValidUsername(identifier))) || !password) {
      return jsonError("Invalid credentials", 400);
    }

    const store = await getStore();
    const ip = getClientIp(req);

    const ipLimit = await store.consumeRateLimit(`login:ip:${ip}`, 20, 15 * 60 * 1000);
    if (!ipLimit.allowed) return rateLimitedError(ipLimit);
    const idLimit = await store.consumeRateLimit(`login:id:${identifier.toLowerCase()}`, 10, 15 * 60 * 1000);
    if (!idLimit.allowed) return rateLimitedError(idLimit);

    // Accept either the account email or the username.
    const user = isValidEmail(identifier)
      ? await store.getUserByEmail(normalizeEmail(identifier))
      : await store.getUserByUsername(identifier);
    if (!user) return jsonError("Invalid credentials", 401);

    const passwordOk = await verifyPassword(password, user.passwordHash);
    if (!passwordOk) return jsonError("Invalid credentials", 401);

    if (!user.verified) {
      return jsonError("Please verify your email before logging in.", 403);
    }

    // Suspended accounts can't sign in — return the reason + duration so the
    // client can render the suspension screen with the appeal form. This is
    // the account owner, so exposing their own ban info leaks nothing.
    if (user.bannedUntil && user.bannedUntil > Date.now()) {
      return json(
        {
          error: "Your account is suspended.",
          code: "banned",
          bannedUntil: user.bannedUntil,
          banReason: user.banReason ?? "No reason was provided.",
        },
        403
      );
    }

    if (user.totpEnabled) {
      const pendingToken = generateToken();
      await store.createPending({
        tokenHash: hashToken(pendingToken),
        email: user.email,
        remember,
        expiresAt: Date.now() + PENDING_TTL_MS,
        createdAt: Date.now(),
      });
      const res = jsonOk({ requires2FA: true });
      setPendingCookie(res, pendingToken);
      return res;
    }

    const sessionToken = await issueSession(store, user, remember);
    const res = jsonOk({ requires2FA: false });
    setSessionCookie(res, sessionToken, remember);
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
