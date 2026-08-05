import { issueSession, verifyTotp } from "@/lib/auth";
import { decryptString, hashToken } from "@/lib/crypto";
import {
  getClientIp,
  handleApiError,
  jsonError,
  jsonOk,
  PENDING_COOKIE,
  rateLimitedError,
  readCookie,
  readJsonBody,
  setSessionCookie,
} from "@/lib/http";
import { getStore } from "@/lib/store";

/**
 * POST /api/auth/2fa/verify
 * Completes a login for accounts with TOTP 2FA enabled. Requires the
 * short-lived pending cookie issued by /api/auth/verify.
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);
    const code = typeof body.code === "string" ? body.code.trim() : "";

    const store = await getStore();

    const pendingToken = readCookie(req, PENDING_COOKIE);
    if (!pendingToken) {
      return jsonError("Session expired. Please start over.", 401);
    }

    const pending = await store.getPending(hashToken(pendingToken));
    if (!pending || pending.expiresAt < Date.now()) {
      if (pending) await store.deletePending(pending.tokenHash);
      return jsonError("Session expired. Please start over.", 401);
    }

    const user = await store.getUserByEmail(pending.email);
    if (!user || !user.totpEnabled || !user.totpSecret) {
      await store.deletePending(pending.tokenHash);
      return jsonError("2FA is not enabled for this account.", 400);
    }

    const ip = getClientIp(req);
    const rl = await store.consumeRateLimit(`totp:${user.email}:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      await store.deletePending(pending.tokenHash);
      return rateLimitedError(rl, "Too many attempts. Please start over.");
    }

    const secret = await decryptString(user.totpSecret);
    if (!secret || !verifyTotp(secret, code)) {
      return jsonError("Invalid 2FA code", 401);
    }

    const remember = pending.remember !== false;
    await store.deletePending(pending.tokenHash);

    const sessionToken = await issueSession(store, user, remember);
    const res = jsonOk();
    setSessionCookie(res, sessionToken, remember);
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
