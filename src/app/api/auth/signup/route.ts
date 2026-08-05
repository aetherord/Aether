import {
  CODE_TTL_MS,
  generateVerificationCode,
  hashPassword,
  isValidDob,
  isValidEmail,
  isValidPassword,
  isValidUsername,
  normalizeEmail,
  sendCode,
  verifyTurnstile,
} from "@/lib/auth";
import { generateSalt, hashVerificationCode } from "@/lib/crypto";
import {
  getClientIp,
  handleApiError,
  jsonError,
  jsonOk,
  rateLimitedError,
  readJsonBody,
} from "@/lib/http";
import { DuplicateUserError, getStore } from "@/lib/store";

/**
 * POST /api/auth/signup
 * Creates the account from the full form (email, username, password, DOB,
 * agreements) and emails a 6-digit verification code. The code is never
 * logged or returned — the email is the only channel it travels on.
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const dob = typeof body.dob === "string" ? body.dob : "";
    const agreedTos = body.agreedTos === true;
    const agreedPrivacy = body.agreedPrivacy === true;
    const agreedRules = body.agreedRules === true;

    if (!isValidEmail(email)) return jsonError("Enter a valid email address", 400);
    if (!isValidUsername(username)) {
      return jsonError("Username must be 3–20 characters (letters, numbers, underscores)", 400);
    }
    if (!isValidPassword(password)) {
      return jsonError("Password must be at least 8 characters", 400);
    }
    if (!isValidDob(dob)) return jsonError("You must be at least 13 years old", 400);
    if (!agreedTos || !agreedPrivacy || !agreedRules) {
      return jsonError("You must accept the Terms of Service, Privacy Policy and Rules", 400);
    }

    const turnstileToken =
      typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;
    if (!(await verifyTurnstile(turnstileToken))) {
      return jsonError("Bot check failed. Please try again.", 400);
    }

    const store = await getStore();
    const ip = getClientIp(req);

    const ipLimit = await store.consumeRateLimit(`signup:ip:${ip}`, 10, 15 * 60 * 1000);
    if (!ipLimit.allowed) return rateLimitedError(ipLimit);
    const emailLimit = await store.consumeRateLimit(`signup:email:${email}`, 3, 15 * 60 * 1000);
    if (!emailLimit.allowed) return rateLimitedError(emailLimit);

    const existing = await store.getUserByEmail(email);
    if (existing && existing.verified) {
      return jsonError("An account with this email already exists", 409);
    }
    if (existing) {
      // Unverified pending account from a previous attempt — reuse it, but let
      // the latest form submission win (password, username, DOB, agreements).
      if (existing.username !== username) {
        const nameTaken = await store.getUserByUsername(username);
        if (nameTaken) return jsonError("This username is already taken", 409);
      }
      await store.updateAccount(existing.id, {
        username,
        passwordHash: await hashPassword(password),
        dob,
        agreedTos,
        agreedPrivacy,
        agreedRules,
      });
    } else {
      const nameTaken = await store.getUserByUsername(username);
      if (nameTaken) return jsonError("This username is already taken", 409);
      await store.createUser({
        email,
        username,
        passwordHash: await hashPassword(password),
        dob,
        agreedTos,
        agreedPrivacy,
        agreedRules,
      });
    }

    const code = generateVerificationCode();
    const salt = generateSalt();

    // Only persist the code after the email is dispatched.
    await sendCode(email, code);
    await store.saveCode({
      email,
      codeHash: hashVerificationCode(code, salt),
      salt,
      expiresAt: Date.now() + CODE_TTL_MS,
      attempts: 0,
      createdAt: Date.now(),
    });

    return jsonOk();
  } catch (err) {
    if (err instanceof DuplicateUserError) return jsonError(err.message, 409);
    return handleApiError(err);
  }
}
