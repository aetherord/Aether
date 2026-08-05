import { resolveSession } from "@/lib/auth";
import {
  handleApiError,
  jsonError,
  jsonOk,
  readJsonBody,
} from "@/lib/http";
import { getStore } from "@/lib/store";

const MAX_MESSAGE_LENGTH = 4000;
const MESSAGE_RATE_WINDOW = 10 * 60 * 1000;
const MESSAGE_RATE_LIMIT = 60;

/** GET /api/chat/messages — the most recent messages (session required). */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const store = await getStore();
    const messages = await store.listMessages(100);
    return jsonOk({ messages });
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/chat/messages — send a message (text and/or image reference). */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const content = typeof body.content === "string" ? body.content.slice(0, MAX_MESSAGE_LENGTH) : "";
    const mediaRef =
      typeof body.mediaRef === "string" && body.mediaRef ? body.mediaRef.slice(0, 64) : null;
    const mediaMime =
      typeof body.mediaMime === "string" && body.mediaMime
        ? body.mediaMime.toLowerCase().slice(0, 64)
        : null;
    if (!content.trim() && !mediaRef) return jsonError("Message is empty", 400);

    const store = await getStore();
    const ipKey = `chat:${session.user.id}`;
    const rl = await store.consumeRateLimit(ipKey, MESSAGE_RATE_LIMIT, MESSAGE_RATE_WINDOW);
    if (!rl.allowed) {
      return jsonError("You are sending messages too quickly.", 429, {
        "Retry-After": String(rl.retryAfterSec),
      });
    }

    const message = await store.addMessage({
      senderId: session.user.id,
      senderUsername: session.user.username,
      recipientUsername: null, // public room for now
      content: content.trim(),
      mediaRef,
      mediaMime,
      createdAt: Date.now(),
    });
    return jsonOk({ message });
  } catch (err) {
    return handleApiError(err);
  }
}
