import {
  isValidEmail,
  issueSession,
  normalizeEmail,
  PENDING_TTL_MS,
  verifyPassword,
} from "@/lib/auth";
import { generateToken, hashToken } from "@/lib/crypto";
import {
  getClientIp,
  handleApiError,
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
 * Email + password. Accounts with 2FA enabled get a short-lived pending
 * cookie and must finish via POST /api/auth/2fa/verify; everyone else is
 * signed straight in.
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
    const password = typeof body.password === "string" ? body.password : "";
    if (!isValidEmail(email) || !password) {
      return jsonError("Invalid credentials", 400);
    }

    const store = await getStore();
    const ip = getClientIp(req);

    const ipLimit = await store.consumeRateLimit(`login:ip:${ip}`, 20, 15 * 60 * 1000);
    if (!ipLimit.allowed) return rateLimitedError(ipLimit);
    const emailLimit = await store.consumeRateLimit(`login:email:${email}`, 10, 15 * 60 * 1000);
    if (!emailLimit.allowed) return rateLimitedError(emailLimit);

    const user = await store.getUserByEmail(email);
    if (!user) return jsonError("Invalid credentials", 401);

    const passwordOk = await verifyPassword(password, user.passwordHash);
    if (!passwordOk) return jsonError("Invalid credentials", 401);

    if (!user.verified) {
      return jsonError("Please verify your email before logging in.", 403);
    }

    if (user.totpEnabled) {
      const pendingToken = generateToken();
      await store.createPending({
        tokenHash: hashToken(pendingToken),
        email: user.email,
        expiresAt: Date.now() + PENDING_TTL_MS,
        createdAt: Date.now(),
      });
      const res = jsonOk({ requires2FA: true });
      setPendingCookie(res, pendingToken);
      return res;
    }

    const sessionToken = await issueSession(store, user);
    const res = jsonOk({ requires2FA: false });
    setSessionCookie(res, sessionToken);
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
