import {
  hashPassword,
  isValidCode,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  verifyEmailCode,
  verifyTurnstile,
} from "@/lib/auth";
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
 * POST /api/auth/reset
 * Completes a password reset: verifies the emailed 6-digit code, sets the new
 * password, and revokes every existing session + pending-2FA step for the
 * account so a stolen old session can't survive a password change.
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const newPassword = typeof body.password === "string" ? body.password : "";

    if (!isValidEmail(email)) return jsonError("Invalid email address", 400);
    if (!isValidCode(code)) return jsonError("Invalid reset code", 400);
    if (!isValidPassword(newPassword)) {
      return jsonError("Password must be 8-128 characters long", 400);
    }

    const turnstileToken =
      typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;
    if (!(await verifyTurnstile(turnstileToken))) {
      return jsonError("Bot check failed. Please try again.", 400);
    }

    const store = await getStore();
    const ip = getClientIp(req);

    const ipLimit = await store.consumeRateLimit(`reset:ip:${ip}`, 10, 15 * 60 * 1000);
    if (!ipLimit.allowed) return rateLimitedError(ipLimit);
    const emailLimit = await store.consumeRateLimit(`reset:email:${email}`, 5, 15 * 60 * 1000);
    if (!emailLimit.allowed) return rateLimitedError(emailLimit);

    const user = await store.getUserByEmail(email);
    if (!user) return jsonError("Invalid or expired reset code", 400);

    const codeOk = await verifyEmailCode(store, email, code);
    if (!codeOk) return jsonError("Invalid or expired reset code", 400);

    const passwordHash = await hashPassword(newPassword);
    await store.updatePassword(user.id, passwordHash);
    await store.deleteUserSessions(user.id);
    await store.deleteUserPendings(user.email);

    return jsonOk({ message: "Password updated. You can now log in." });
  } catch (err) {
    return handleApiError(err);
  }
}
