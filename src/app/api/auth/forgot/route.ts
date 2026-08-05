import {
  CODE_TTL_MS,
  generateVerificationCode,
  isValidEmail,
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
import { getStore } from "@/lib/store";

/**
 * POST /api/auth/forgot
 * Starts a password reset: emails a 6-digit code to the address if an account
 * exists. Responds identically whether or not the email is registered, so the
 * endpoint never leaks which emails have accounts. The code is never logged
 * or returned — the email is the only channel it travels on.
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
    if (!isValidEmail(email)) return jsonError("Invalid email address", 400);

    const turnstileToken =
      typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;
    if (!(await verifyTurnstile(turnstileToken))) {
      return jsonError("Bot check failed. Please try again.", 400);
    }

    const store = await getStore();
    const ip = getClientIp(req);

    const ipLimit = await store.consumeRateLimit(`forgot:ip:${ip}`, 10, 15 * 60 * 1000);
    if (!ipLimit.allowed) return rateLimitedError(ipLimit);
    const emailLimit = await store.consumeRateLimit(`forgot:email:${email}`, 3, 15 * 60 * 1000);
    if (!emailLimit.allowed) return rateLimitedError(emailLimit);

    const user = await store.getUserByEmail(email);
    if (user) {
      const code = generateVerificationCode();
      const salt = generateSalt();
      await sendCode(email, code);
      await store.saveCode({
        email,
        codeHash: hashVerificationCode(code, salt),
        salt,
        expiresAt: Date.now() + CODE_TTL_MS,
        attempts: 0,
        createdAt: Date.now(),
      });
    }

    // Always the same response, whether or not the account exists.
    return jsonOk({ message: "If that email is registered, a reset code is on its way." });
  } catch (err) {
    return handleApiError(err);
  }
}
