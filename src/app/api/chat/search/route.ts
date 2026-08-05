import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/http";
import { getStore, type ChatRoom } from "@/lib/store";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/** GET /api/chat/search?q=...&room=community|dm&peer=... — search messages. */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const url = new URL(req.url);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
    if (!query) return jsonOk({ messages: [] });

    let room: ChatRoom = { kind: "community" };
    if (url.searchParams.get("room") === "dm") {
      const peer = (url.searchParams.get("peer") ?? "").trim();
      if (USERNAME_RE.test(peer) && peer !== session.user.username) {
        room = { kind: "dm", me: session.user.username, peer };
      }
    }

    const store = await getStore();
    const rl = await store.consumeRateLimit(
      `search:${session.user.id}`,
      60,
      10 * 60 * 1000
    );
    if (!rl.allowed) {
      return jsonError("Searching too quickly. Please try again later.", 429, {
        "Retry-After": String(rl.retryAfterSec),
      });
    }
    const blocked = new Set(await store.getBlockedIds(session.user.id));
    let messages = await store.searchMessages(room, query, 30);
    if (blocked.size > 0) {
      messages = messages.filter((m) => !blocked.has(m.senderId));
    }
    return jsonOk({ messages });
  } catch (err) {
    return handleApiError(err);
  }
}
