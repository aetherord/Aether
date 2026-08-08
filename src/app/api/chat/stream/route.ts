import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError } from "@/lib/http";
import { getStore, type ChatRoom } from "@/lib/store";

const POLL_MS = 3000;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/**
 * GET /api/chat/stream?room=community|dm&peer=... — Server-Sent Events feed
 * (session required).
 *
 * Pushes new messages for the requested room the moment they exist. Each poll
 * only fetches messages newer than the last delivered id (WHERE id > ?) rather
 * than re-reading the whole tail, which keeps D1 reads low per connection.
 * If the connection drops, EventSource reconnects and catches up from the
 * client's last id via the initial poll.
 */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const url = new URL(req.url);
    let room: ChatRoom = { kind: "community" };
    if (url.searchParams.get("room") === "dm") {
      const peer = (url.searchParams.get("peer") ?? "").trim();
      if (USERNAME_RE.test(peer) && peer !== session.user.username) {
        room = { kind: "dm", me: session.user.username, peer };
      }
    }

    const store = await getStore();
    const encoder = new TextEncoder();
    // Start from the highest message id the client already has (it sends
    // `after=<id>` on connect). Without this the initial catch-up would replay
    // the OLDEST messages of the thread and dump them below the newest ones.
    const afterRaw = Number(url.searchParams.get("after") ?? 0);
    const after = Number.isFinite(afterRaw) && afterRaw > 0 ? Math.floor(afterRaw) : 0;
    let lastId = after;
    const blocked = new Set(await store.getBlockedIds(session.user.id));

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const send = (data: string) => {
          if (!closed) controller.enqueue(encoder.encode(data));
        };

        // Sender avatars + display names for streamed rows (same decoration as
        // the messages GET route, so live messages show the right name/PFP).
        const senderCache = new Map<string, { avatar: string | null; displayName: string | null }>();
        const senderInfo = async (username: string): Promise<{ avatar: string | null; displayName: string | null }> => {
          if (!senderCache.has(username)) {
            const u = await store.getUserByUsername(username);
            senderCache.set(username, { avatar: u?.avatar ?? null, displayName: u?.displayName ?? null });
          }
          return senderCache.get(username) ?? { avatar: null, displayName: null };
        };

        const poll = async () => {
          try {
            const messages = await store.listMessagesAfter(lastId, room, 100);
            for (const m of messages) {
              if (m.id <= lastId) continue;
              lastId = m.id;
              if (blocked.has(m.senderId)) continue; // respect the block list
              const sender = await senderInfo(m.senderUsername);
              send(`data: ${JSON.stringify({ ...m, senderAvatar: sender.avatar, senderDisplayName: sender.displayName })}\n\n`);
            }
          } catch {
            // transient error — keep the connection alive for the next poll
          }
        };

        // Initial catch-up (also handles reconnects).
        await poll();

        const timer = setInterval(async () => {
          await poll();
          send(`: keepalive ${Date.now()}\n\n`);
        }, POLL_MS);

        req.signal.addEventListener("abort", () => {
          closed = true;
          clearInterval(timer);
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store, no-transform",
        "x-accel-buffering": "no",
        connection: "keep-alive",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
