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
 * POST /api/auth/2fa/enable
 * Confirms the pending TOTP secret (from /api/auth/2fa/setup) with a
 * 6-digit code from the authenticator app and activates 2FA.
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);
    const code = typeof body.code === "string" ? body.code.trim() : "";

    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const { user } = session;

    if (user.totpEnabled) {
      return jsonError("Two-factor authentication is already enabled", 409);
    }
    if (!user.totpSecret) {
      return jsonError("Start the setup first", 400);
    }

    const store = await getStore();
    const ip = getClientIp(req);
    const rl = await store.consumeRateLimit(`totp:setup:${user.id}:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return rateLimitedError(rl);
    }

    const secret = await decryptString(user.totpSecret);
    if (!secret) {
      return jsonError("Setup expired. Please start over.", 400);
    }
    if (!verifyTotp(secret, code)) {
      return jsonError("Invalid code", 400);
    }

    // Generate the backup codes BEFORE flipping 2FA on, so a failure here
    // can't leave the account with 2FA enabled but zero usable codes.
    const backupCodes = await store.generateBackupCodes(user.id, 10);
    await store.enableTotp(user.id);
    return jsonOk({ backupCodes });
  } catch (err) {
    return handleApiError(err);
  }
}
