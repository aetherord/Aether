import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/http";
import { getStore } from "@/lib/store";

/** GET /api/chat/conversations — DM threads for the current user. */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const store = await getStore();
    const conversations = await store.listConversations(session.user.username);
    return jsonOk({ conversations });
  } catch (err) {
    return handleApiError(err);
  }
}
