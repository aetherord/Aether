import {
  isValidCode,
  isValidEmail,
  issueSession,
  normalizeEmail,
  verifyEmailCode,
} from "@/lib/auth";
import {
  getClientIp,
  handleApiError,
  jsonError,
  jsonOk,
  rateLimitedError,
  readJsonBody,
  setSessionCookie,
} from "@/lib/http";
import { getStore } from "@/lib/store";

/**
 * POST /api/auth/verify
 * Confirms the emailed signup code, marks the account verified and issues a
 * session so the mandatory 2FA setup step can run. The code is consumed on
 * success and invalidated after repeated failures.
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!isValidEmail(email) || !isValidCode(code)) {
      return jsonError("Invalid or expired code", 400);
    }

    const store = await getStore();
    const ip = getClientIp(req);

    const ipLimit = await store.consumeRateLimit(`verify:ip:${ip}`, 30, 15 * 60 * 1000);
    if (!ipLimit.allowed) return rateLimitedError(ipLimit);
    const emailLimit = await store.consumeRateLimit(`verify:email:${email}`, 10, 15 * 60 * 1000);
    if (!emailLimit.allowed) return rateLimitedError(emailLimit);

    // Generic error for unknown emails, expired codes and wrong codes alike.
    const user = await store.getUserByEmail(email);
    if (!user) return jsonError("Invalid or expired code", 400);

    const ok = await verifyEmailCode(store, email, code);
    if (!ok) return jsonError("Invalid or expired code", 400);

    await store.markVerified(user.id);

    const sessionToken = await issueSession(store, user);
    const res = jsonOk({ requires2FASetup: true });
    setSessionCookie(res, sessionToken);
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
