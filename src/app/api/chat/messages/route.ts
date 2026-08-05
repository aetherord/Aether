import { resolveSession } from "@/lib/auth";
import {
  handleApiError,
  jsonError,
  jsonOk,
  readJsonBody,
} from "@/lib/http";
import { getStore, type ChatRoom } from "@/lib/store";

const MAX_MESSAGE_LENGTH = 4000;
const MESSAGE_RATE_WINDOW = 10 * 60 * 1000;
const MESSAGE_RATE_LIMIT = 60;

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function parseRoom(url: URL, me: string): ChatRoom {
  const kind = url.searchParams.get("room") ?? "community";
  if (kind === "dm") {
    const peer = (url.searchParams.get("peer") ?? "").trim();
    if (USERNAME_RE.test(peer) && peer !== me) {
      return { kind: "dm", me, peer };
    }
  }
  return { kind: "community" };
}

/** GET /api/chat/messages?room=community|dm&peer=...&before=<id> */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const store = await getStore();
    const url = new URL(req.url);
    const room = parseRoom(url, session.user.username);
    const beforeRaw = Number(url.searchParams.get("before") ?? 0);
    const before = Number.isFinite(beforeRaw) && beforeRaw > 0 ? beforeRaw : null;

    const raw = await store.listMessages(room, before, 50);

    // Respect the user's block list (community + DM threads). hasMore is
    // computed from the raw count so pagination doesn't stall when blocked
    // users occupy rows in the batch.
    const blocked = new Set(await store.getBlockedIds(session.user.id));
    const messages = blocked.size > 0 ? raw.filter((m) => !blocked.has(m.senderId)) : raw;

    return jsonOk({ messages, hasMore: raw.length === 50 });
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/chat/messages — send a text message and/or media to a room. */
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
    const recipient =
      typeof body.recipient === "string" && body.recipient.trim()
        ? body.recipient.trim().slice(0, 32)
        : null;
    if (!content.trim() && !mediaRef) return jsonError("Message is empty", 400);

    const store = await getStore();

    // Muted users cannot send messages (admin-moderation).
    if (session.user.mutedUntil && session.user.mutedUntil > Date.now()) {
      return jsonError("You are muted and cannot send messages right now.", 403);
    }

    // DM send: the recipient must exist, and blocking applies in both directions.
    if (recipient) {
      if (recipient === session.user.username) return jsonError("You cannot message yourself", 400);
      const peer = await store.getUserByUsername(recipient);
      if (!peer) return jsonError("That user does not exist", 400);
      const [theyBlockedMe, iBlockedThem] = await Promise.all([
        store.isBlocked(peer.id, session.user.id),
        store.isBlocked(session.user.id, peer.id),
      ]);
      if (theyBlockedMe || iBlockedThem) {
        return jsonError("You cannot message this user.", 403);
      }
    }

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
      recipientUsername: recipient, // null = community room
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
