import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk, readJsonBody } from "@/lib/http";
import { getStore } from "@/lib/store";

const MAX_EMOJI_LENGTH = 16;

/** POST /api/chat/reactions — toggle {messageId, emoji}. */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const messageId = Number(body.messageId ?? 0);
    const emoji = typeof body.emoji === "string" ? body.emoji.trim() : "";
    if (!Number.isFinite(messageId) || messageId <= 0) return jsonError("Invalid message", 400);
    if (!emoji || emoji.length > MAX_EMOJI_LENGTH) return jsonError("Invalid emoji", 400);

    const store = await getStore();
    const target = await store.getMessagesByIds([messageId]);
    if (target.length === 0) return jsonError("Message not found", 404);

    const result = await store.toggleReaction(
      messageId,
      session.user.id,
      session.user.username,
      emoji
    );
    return jsonOk({ added: result === "added" });
  } catch (err) {
    return handleApiError(err);
  }
}

/** GET /api/chat/reactions?ids=1,2,3 — counts for a batch (used after SSE catch-up). */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const ids = (new URL(req.url).searchParams.get("ids") ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 100);
    if (ids.length === 0) return jsonOk({ reactions: [] });

    const store = await getStore();
    const reactions = await store.listReactions(ids, session.user.id);
    return jsonOk({ reactions });
  } catch (err) {
    return handleApiError(err);
  }
}
