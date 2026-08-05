import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/http";
import { getStore } from "@/lib/store";

/**
 * GET /api/auth/2fa/backup-codes/count
 * Returns how many unused backup codes exist for the signed-in user.
 * Plaintext codes are never returned here — only the count.
 */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const store = await getStore();
    const count = await store.listBackupCodes(session.user.id);
    return jsonOk({ count });
  } catch (err) {
    return handleApiError(err);
  }
}
