import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk, readJsonBody } from "@/lib/http";
import { getStore } from "@/lib/store";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/**
 * Admin moderation endpoints (POST /api/moderation/admin).
 * Body shape: { action, messageId | username, minutes? }.
 */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    if (session.user.role !== "admin") return jsonError("Forbidden", 403);

    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const action = typeof body.action === "string" ? body.action : "";
    const store = await getStore();

    switch (action) {
      case "delete-message": {
        const messageId = Number(body.messageId);
        if (!Number.isFinite(messageId) || messageId <= 0) return jsonError("Invalid message", 400);
        await store.deleteMessage(messageId);
        return jsonOk();
      }
      case "mute": {
        const username = typeof body.username === "string" ? body.username.trim() : "";
        const minutes = Number(body.minutes);
        if (!USERNAME_RE.test(username)) return jsonError("Invalid username", 400);
        if (!Number.isFinite(minutes) || minutes <= 0) return jsonError("Invalid duration", 400);
        const target = await store.getUserByUsername(username);
        if (!target) return jsonError("That user does not exist", 400);
        await store.setMutedUntil(target.id, Date.now() + minutes * 60 * 1000);
        return jsonOk({ muted: true, until: Date.now() + minutes * 60 * 1000 });
      }
      case "unmute": {
        const username = typeof body.username === "string" ? body.username.trim() : "";
        if (!USERNAME_RE.test(username)) return jsonError("Invalid username", 400);
        const target = await store.getUserByUsername(username);
        if (!target) return jsonError("That user does not exist", 400);
        await store.setMutedUntil(target.id, null);
        return jsonOk();
      }
      case "set-admin": {
        const username = typeof body.username === "string" ? body.username.trim() : "";
        if (!USERNAME_RE.test(username)) return jsonError("Invalid username", 400);
        const target = await store.getUserByUsername(username);
        if (!target) return jsonError("That user does not exist", 400);
        await store.setRole(target.id, "admin");
        return jsonOk();
      }
      default:
        return jsonError("Unknown action", 400);
    }
  } catch (err) {
    return handleApiError(err);
  }
}
