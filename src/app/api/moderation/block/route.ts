import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk, readJsonBody } from "@/lib/http";
import { getStore } from "@/lib/store";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/** POST /api/moderation/block — block a user (their messages vanish for you). */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const username = typeof body.username === "string" ? body.username.trim() : "";
    if (!USERNAME_RE.test(username)) return jsonError("Invalid username", 400);
    if (username === session.user.username) return jsonError("You cannot block yourself", 400);

    const store = await getStore();
    const target = await store.getUserByUsername(username);
    if (!target) return jsonError("That user does not exist", 400);

    await store.addBlock(session.user.id, target.id);
    return jsonOk();
  } catch (err) {
    return handleApiError(err);
  }
}

/** DELETE /api/moderation/block — unblock a user. */
export async function DELETE(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const username = typeof body.username === "string" ? body.username.trim() : "";
    if (!USERNAME_RE.test(username)) return jsonError("Invalid username", 400);

    const store = await getStore();
    const target = await store.getUserByUsername(username);
    if (!target) return jsonError("That user does not exist", 400);

    await store.removeBlock(session.user.id, target.id);
    return jsonOk();
  } catch (err) {
    return handleApiError(err);
  }
}
