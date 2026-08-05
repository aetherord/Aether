import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk, readJsonBody } from "@/lib/http";
import { getStore } from "@/lib/store";

const STATUSES = new Set(["online", "idle", "away", "busy", "dnd", "offline"]);

/** POST /api/users/status {status} — set the caller's presence status. */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const body = await readJsonBody(req);
    const status =
      typeof body?.status === "string" ? body.status.trim().toLowerCase() : "";
    if (!STATUSES.has(status)) return jsonError("Invalid status", 400);

    const store = await getStore();
    await store.setStatus(session.user.id, status);
    return jsonOk({ status });
  } catch (err) {
    return handleApiError(err);
  }
}
