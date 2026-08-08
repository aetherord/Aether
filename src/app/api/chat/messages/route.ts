import { resolveSession } from "@/lib/auth";
import {
  handleApiError,
  jsonError,
  jsonOk,
  readJsonBody,
} from "@/lib/http";
import { getStore, type ChatRoom, type MessageRow } from "@/lib/store";
import { containsExtremeSlur, SLUR_BLOCK_MESSAGE } from "@/lib/contentFilter";
import { E2E_PREFIX } from "@/lib/e2e";
import { pushPayload, sendPush } from "@/lib/push";

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

/**
 * Attaches `replyTo` (snippet of the referenced message) and `reactions`
 * (grouped counts) to every message in a batch.
 */
async function decorate(
  store: ReturnType<typeof getStore> extends Promise<infer T> ? T : never,
  userId: number,
  messages: MessageRow[]
): Promise<unknown[]> {
  if (messages.length === 0) return [];

  const replyIds = messages
    .map((m) => m.replyToId)
    .filter((id): id is number => id != null);
  const replyMap = new Map<number, MessageRow>();
  if (replyIds.length > 0) {
    for (const r of await store.getMessagesByIds(replyIds)) replyMap.set(r.id, r);
  }

  const reactions = await store.listReactions(
    messages.map((m) => m.id),
    userId
  );
  const byMessage = new Map<number, { emoji: string; count: number; mine: boolean }[]>();
  for (const r of reactions) {
    const list = byMessage.get(r.messageId) ?? [];
    list.push(r);
    byMessage.set(r.messageId, list);
  }

  return messages.map((m) => {
    const ref = m.replyToId != null ? replyMap.get(m.replyToId) : undefined;
    return {
      id: m.id,
      senderId: m.senderId,
      senderUsername: m.senderUsername,
      recipientUsername: m.recipientUsername,
      content: m.content,
      mediaRef: m.mediaRef,
      mediaMime: m.mediaMime,
      replyToId: m.replyToId,
      editedAt: m.editedAt,
      createdAt: m.createdAt,
      replyTo: ref
        ? {
            id: ref.id,
            senderUsername: ref.senderUsername,
            content: ref.content.slice(0, 200),
            mediaRef: ref.mediaRef,
            mediaMime: ref.mediaMime,
          }
        : null,
      reactions: byMessage.get(m.id) ?? [],
    };
  });
}

/** GET /api/chat/messages?room=dm&peer=...&before=<id> */
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

    // Respect the user's block list.
    const blocked = new Set(await store.getBlockedIds(session.user.id));
    const messages = blocked.size > 0 ? raw.filter((m) => !blocked.has(m.senderId)) : raw;

    return jsonOk({
      messages: await decorate(store, session.user.id, messages),
      hasMore: raw.length === 50,
    });
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
    const replyToRaw = Number(body.replyToId ?? 0);
    const replyToId = Number.isFinite(replyToRaw) && replyToRaw > 0 ? replyToRaw : null;
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

      // Respect the recipient's "who can message you" privacy setting.
      const privacy = await store.getMessagePrivacy(peer.id);
      if (privacy === "nobody") {
        return jsonError("This user is not accepting direct messages.", 403);
      }
      if (privacy === "friends") {
        const friends = await store.areFriends(session.user.id, peer.id);
        if (!friends) {
          return jsonError("This user only accepts messages from friends.", 403);
        }
      }
    }

    // A reply must point at a real message in this same thread.
    if (replyToId != null) {
      const target = await store.getMessagesByIds([replyToId]);
      if (target.length === 0) return jsonError("The message you replied to no longer exists.", 400);
    }

    const rl = await store.consumeRateLimit(`chat:${session.user.id}`, MESSAGE_RATE_LIMIT, MESSAGE_RATE_WINDOW);
    if (!rl.allowed) {
      return jsonError("You are sending messages too quickly.", 429, {
        "Retry-After": String(rl.retryAfterSec),
      });
    }

    // Extreme slurs are blocked; regular profanity is fine. Skipped for
    // E2E ciphertext (unreadable here) — the client pre-filters those
    // before encrypting. Runs after the rate limit so blocked spam still
    // burns quota.
    if (content.trim() && !content.startsWith(E2E_PREFIX) && containsExtremeSlur(content)) {
      return jsonError(SLUR_BLOCK_MESSAGE, 400);
    }

    const message = await store.addMessage({
      senderId: session.user.id,
      senderUsername: session.user.username,
      recipientUsername: recipient, // null = community room
      content: content.trim(),
      mediaRef,
      mediaMime,
      replyToId,
      editedAt: null,
      createdAt: Date.now(),
    });
    const [decorated] = await decorate(store, session.user.id, [message]);

    // Fire-and-forget Web Push to the DM recipient — this is what delivers
    // notifications when their chat window is closed. Best-effort: never
    // block or fail the send because push hiccuped.
    if (recipient) {
      const peer = await store.getUserByUsername(recipient);
      if (peer) {
        const subs = await store.listPushSubscriptions(peer.id);
        if (subs.length > 0) {
          const plainPreview = content.startsWith(E2E_PREFIX)
            ? "🔒 (encrypted)"
            : content.slice(0, 120);
          void sendPush(subs, pushPayload(session.user.username, plainPreview, Boolean(mediaRef)), (endpoint) =>
            store.removePushSubscription(endpoint)
          );
        }
      }
    }

    return jsonOk({ message: decorated });
  } catch (err) {
    return handleApiError(err);
  }
}
