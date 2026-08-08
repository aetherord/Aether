import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk, readJsonBody } from "@/lib/http";
import { getStore } from "@/lib/store";

const MAX_DISPLAY_NAME = 40;

/** POST /api/settings/display-name { displayName } — set/clear the display name. */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const raw = typeof body.displayName === "string" ? body.displayName.trim() : "";
    // Clear when empty; otherwise validate a sane length. Display names may
    // contain most printable characters — keep it simple and bounded.
    const displayName = raw.length > MAX_DISPLAY_NAME ? raw.slice(0, MAX_DISPLAY_NAME) : raw;

    const store = await getStore();
    await store.setDisplayName(session.user.id, displayName || null);
    return jsonOk({ displayName: displayName || null });
  } catch (err) {
    return handleApiError(err);
  }
}
