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

    // Unread counts: how many of the peer's messages are newer than the
    // highest one I've read in each thread.
    const withUnread = await Promise.all(
      conversations.map(async (c) => {
        const myLastRead = (await store.getReadReceipt(session.user.id, "dm", c.peer)) ?? 0;
        const unread = await store.countUnreadDm(session.user.username, c.peer, myLastRead);
        return { ...c, myLastReadId: myLastRead || null, unread };
      })
    );
    return jsonOk({ conversations: withUnread });
  } catch (err) {
    return handleApiError(err);
  }
}
