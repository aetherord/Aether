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
 * POST /api/auth/2fa/disable
 * Disables 2FA, but only after a valid TOTP code from the authenticator app.
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);
    const code = typeof body.code === "string" ? body.code.trim() : "";

    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const { user } = session;

    if (!user.totpEnabled) {
      return jsonError("Two-factor authentication is not enabled", 400);
    }

    const store = await getStore();
    const ip = getClientIp(req);
    const rl = await store.consumeRateLimit(`totp:disable:${user.id}:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return rateLimitedError(rl);
    }

    const secret = user.totpSecret ? await decryptString(user.totpSecret) : null;
    if (!secret || !verifyTotp(secret, code)) {
      return jsonError("Invalid code", 400);
    }

    await store.disableTotp(user.id);
    return jsonOk();
  } catch (err) {
    return handleApiError(err);
  }
}
