import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError } from "@/lib/http";
import { getStore } from "@/lib/store";

const POLL_MS = 2000;
const KEEPALIVE_MS = 15000;

/**
 * GET /api/chat/stream — Server-Sent Events feed (session required).
 *
 * Pushes new chat messages to the client the moment they exist, with a
 * periodic keepalive so proxies don't close the connection. If the
 * connection drops (network, Cloudflare idle), the client's EventSource
 * reconnects automatically and the initial catch-up replays the tail.
 */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const store = await getStore();
    const encoder = new TextEncoder();
    let lastId = 0;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const send = (data: string) => {
          if (!closed) controller.enqueue(encoder.encode(data));
        };

        const poll = async () => {
          try {
            const messages = await store.listMessages(100);
            for (const m of messages) {
              if (m.id <= lastId) continue;
              send(`data: ${JSON.stringify(m)}\n\n`);
              lastId = m.id;
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
