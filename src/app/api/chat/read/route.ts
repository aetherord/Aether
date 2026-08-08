import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk, readJsonBody } from "@/lib/http";
import { getStore } from "@/lib/store";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/**
 * Read receipts — one row per (user, thread) holding the highest message id
 * that user has actually seen. The opposite side reads it back to render
 * ✓ / ✓✓ next to their own messages.
 *
 * POST /api/chat/read { room: "dm"|"community", peer?, messageId }
 *   peer is the OTHER user in the thread (DM only).
 *
 * GET /api/chat/read?room=dm|community
 *   Returns every other user's last-read id in a thread I'm in.
 */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const room = body.room === "community" ? "community" : "dm";
    const peerRaw = typeof body.peer === "string" ? body.peer.trim() : "";
    const peer = room === "dm" && USERNAME_RE.test(peerRaw) ? peerRaw : "";
    if (room === "dm" && peer === session.user.username) return jsonError("Invalid peer", 400);

    const messageId = Number(body.messageId);
    if (!Number.isFinite(messageId) || messageId <= 0) return jsonError("Invalid message", 400);

    const store = await getStore();
    // Throttled on the client, but cap server-side too so a loop can't write rows.
    const rl = await store.consumeRateLimit(`read:${session.user.id}`, 120, 60_000);
    if (rl.allowed) {
      await store.setReadReceipt(session.user.id, room, peer, messageId);
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
    const receipts = await store.listReadReceipts(
      room,
      room === "community" ? "" : session.user.username,
      session.user.id
    );
    return jsonOk({ receipts });
  } catch (err) {
    return handleApiError(err);
  }
}
