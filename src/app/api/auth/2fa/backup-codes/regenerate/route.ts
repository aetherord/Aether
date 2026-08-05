import { resolveSession, verifyTotp } from "@/lib/auth";
import { decryptString } from "@/lib/crypto";
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
 * POST /api/auth/2fa/backup-codes/regenerate
 * Mints a fresh set of 10 backup codes, invalidating all previous ones.
 * Requires the current TOTP code so only the account owner (not a stolen
 * session) can rotate recovery credentials. Plaintext codes are returned
 * exactly once.
 */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const { user } = session;

    if (!user.totpEnabled) {
      return jsonError("Two-factor authentication is not enabled", 400);
    }
    if (!user.totpSecret) {
      return jsonError("Your 2FA secret is missing. Re-enable 2FA to continue.", 400);
    }

    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) return jsonError("Enter your current authenticator code", 400);

    const store = await getStore();
    const ip = getClientIp(req);
    const rl = await store.consumeRateLimit(`totp:regen:${user.id}:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) return rateLimitedError(rl);

    const secret = await decryptString(user.totpSecret);
    if (!secret || !verifyTotp(secret, code)) {
      return jsonError("Invalid authenticator code", 403);
    }

    const backupCodes = await store.generateBackupCodes(user.id, 10);
    return jsonOk({ backupCodes });
  } catch (err) {
    return handleApiError(err);
  }
}
