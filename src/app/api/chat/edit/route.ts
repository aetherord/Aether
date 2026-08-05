import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk, readJsonBody } from "@/lib/http";
import { getStore } from "@/lib/store";
import { containsExtremeSlur, SLUR_BLOCK_MESSAGE } from "@/lib/contentFilter";
import { E2E_PREFIX } from "@/lib/e2e";

const MAX_MESSAGE_LENGTH = 4000;

/** POST /api/chat/edit — edit an own message {messageId, content}. */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const messageId = Number(body.messageId ?? 0);
    const content = typeof body.content === "string" ? body.content.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
    if (!Number.isFinite(messageId) || messageId <= 0) return jsonError("Invalid message", 400);
    if (!content) return jsonError("Message cannot be empty", 400);

    // Same filter as sending; E2E ciphertext can't be read server-side, so
    // the client pre-checks those before encrypting.
    if (!content.startsWith(E2E_PREFIX) && containsExtremeSlur(content)) {
      return jsonError(SLUR_BLOCK_MESSAGE, 400);
    }

    const store = await getStore();
    const ok = await store.editMessage(messageId, session.user.id, content);
    if (!ok) return jsonError("You can only edit your own messages", 403);

    return jsonOk();
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * GET /api/chat/edit?messageId=... — edit history (old contents, newest first).
 * Only the sender or an admin may read it.
 */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const messageId = Number(new URL(req.url).searchParams.get("messageId") ?? 0);
    if (!Number.isFinite(messageId) || messageId <= 0) return jsonError("Invalid message", 400);

    const store = await getStore();
    const [target] = await store.getMessagesByIds([messageId]);
    if (!target) return jsonError("Message not found", 404);
    if (target.senderId !== session.user.id && session.user.role !== "admin") {
      return jsonError("You cannot view this message's history", 403);
    }

    const edits = await store.listMessageEdits(messageId);
    return jsonOk({
      edits: edits.reverse().map((e) => ({ content: e.content, editedAt: e.editedAt })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
