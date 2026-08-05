import { generateTotpSecret, resolveSession, totpUri } from "@/lib/auth";
import { encryptString } from "@/lib/crypto";
import { handleApiError, jsonError, jsonOk } from "@/lib/http";
import { getStore } from "@/lib/store";
import QRCode from "qrcode";

/**
 * POST /api/auth/2fa/setup
 * Generates a fresh TOTP secret for the signed-in user and returns the QR
 * code plus otpauth URL. The secret is encrypted at rest (AES-256-GCM) and
 * only becomes active after /api/auth/2fa/enable confirms it with a code.
 */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const { user } = session;

    if (user.totpEnabled) {
      return jsonError("Two-factor authentication is already enabled", 409);
    }

    const store = await getStore();
    const secret = generateTotpSecret();
    await store.setTotpSecret(user.id, await encryptString(secret));

    const otpauthUrl = totpUri(secret, user.email);

    let qrDataUrl: string | null = null;
    try {
      qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 280, margin: 1 });
    } catch {
      qrDataUrl = null; // secret + otpauth URL still allow manual entry
    }

    return jsonOk({ secret, otpauthUrl, qrDataUrl });
  } catch (err) {
    return handleApiError(err);
  }
}
