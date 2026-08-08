import { handleApiError, jsonOk } from "@/lib/http";
import { getSecret } from "@/lib/env";

/** GET /api/push/config — exposes whether Web Push is configured (public key). */
export async function GET() {
  try {
    const publicKey = getSecret("VAPID_PUBLIC_KEY");
    return jsonOk({ enabled: Boolean(publicKey), publicKey: publicKey ?? null });
  } catch (err) {
    return handleApiError(err);
  }
}
