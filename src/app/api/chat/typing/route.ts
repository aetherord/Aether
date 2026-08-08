import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk, readJsonBody } from "@/lib/http";
import { getStore } from "@/lib/store";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
/** Rows older than this are treated as "not typing" (mirrors the server sweep). */
const TYPING_TTL_MS = 5000;

/**
 * Typing indicators — a lightweight presence channel layered on the same
 * D1 polling pattern as everything else, so no WebSockets are needed.
 *
 * POST /api/chat/typing { room: "dm"|"community", peer?, typing }
 *   peer is the OTHER user in the thread (DM only). The row is keyed by
 *   (me, room, peer) so the opposite side can find it by filtering on their
 *   own username as `peer`.
 *
 * GET /api/chat/typing?room=dm|community
 *   Returns usernames currently typing in a thread I'm in (community = the
 *   public room; dm = anyone typing toward me).
 */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const room = body.room === "community" ? "community" : "dm";
    const typing = body.typing !== false;
    const peerRaw = typeof body.peer === "string" ? body.peer.trim() : "";
    const peer = room === "dm" && USERNAME_RE.test(peerRaw) ? peerRaw : "";
    if (room === "dm" && peer === session.user.username) return jsonError("Invalid peer", 400);

    const store = await getStore();
    // Throttle pings so a stuck tab can't hammer the DB. On overflow we
    // silently drop rather than surface errors — typing must never feel broken.
    const rl = await store.consumeRateLimit(`typing:${session.user.id}`, 40, 60_000);
    if (rl.allowed) {
      await store.setTyping(session.user.id, room, peer, typing);
    }
    return jsonOk();
  } catch (err) {
    return handleApiError(err);
  }
}

export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const url = new URL(req.url);
    const room = url.searchParams.get("room") === "community" ? "community" : "dm";
    const store = await getStore();
    const typers = await store.listTypers(
      room,
      room === "community" ? "" : session.user.username,
      session.user.id,
      Date.now() - TYPING_TTL_MS
    );
    return jsonOk({ typers });
  } catch (err) {
    return handleApiError(err);
  }
}
