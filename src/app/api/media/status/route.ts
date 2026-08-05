import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/http";
import { mediaStats } from "@/lib/media";

/**
 * GET /api/media/status — counts of media waiting in the Turso queue vs
 * already mirrored to the local drive. Session required.
 */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const stats = await mediaStats();
    return jsonOk({ ...stats });
  } catch (err) {
    return handleApiError(err);
  }
}
