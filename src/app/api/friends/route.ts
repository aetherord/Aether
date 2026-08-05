import { resolveSession } from "@/lib/auth";
import {
  handleApiError,
  jsonError,
  jsonOk,
  readJsonBody,
} from "@/lib/http";
import { getStore } from "@/lib/store";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/** GET /api/friends — friends list + incoming/outgoing requests. */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const store = await getStore();
    const [friends, requests] = await Promise.all([
      store.listFriends(session.user.id),
      store.listFriendRequests(session.user.id),
    ]);

    // Attach each friend/requester's avatar + presence so the sidebar can show
    // real PFPs and status dots.
    const withAvatars = async (
      list: { id: number; username: string }[]
    ): Promise<{ id: number; username: string; avatar: string | null; status: string }[]> => {
      const out: { id: number; username: string; avatar: string | null; status: string }[] = [];
      for (const u of list) {
        const p = await store.getProfileByUsername(u.username);
        out.push({
          id: u.id,
          username: u.username,
          avatar: p?.avatar ?? null,
          status: p?.status ?? "offline",
        });
      }
      return out;
    };

    return jsonOk({
      friends: await withAvatars(friends),
      incoming: await withAvatars(requests.incoming),
      outgoing: await withAvatars(requests.outgoing),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/friends — send a friend request. */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const username = typeof body.username === "string" ? body.username.trim() : "";
    if (!USERNAME_RE.test(username)) return jsonError("Invalid username", 400);
    if (username === session.user.username) {
      return jsonError("You cannot add yourself", 400);
    }

    const store = await getStore();
    const target = await store.getUserByUsername(username);
    if (!target) return jsonError("That user does not exist", 404);
    if (!target.verified) return jsonError("That account is not verified yet", 400);

    const result = await store.sendFriendRequest(session.user.id, target.id);
    if (result === "already") return jsonError("You are already friends (or a request is pending)", 400);
    if (result === "blocked") return jsonError("You cannot send a request to this user", 403);

    return jsonOk({ sent: true });
  } catch (err) {
    return handleApiError(err);
  }
}

/** PUT /api/friends — respond to a request ({username, accept}). */
export async function PUT(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const username = typeof body.username === "string" ? body.username.trim() : "";
    const accept = body.accept === true;
    if (!USERNAME_RE.test(username)) return jsonError("Invalid username", 400);

    const store = await getStore();
    const requester = await store.getUserByUsername(username);
    if (!requester) return jsonError("That user does not exist", 404);

    const ok = await store.respondFriendRequest(session.user.id, requester.id, accept);
    if (!ok) return jsonError("No pending request from that user", 400);

    return jsonOk({ accepted: accept });
  } catch (err) {
    return handleApiError(err);
  }
}

/** DELETE /api/friends?username=... — remove a friend. */
export async function DELETE(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const username = (new URL(req.url).searchParams.get("username") ?? "").trim();
    if (!USERNAME_RE.test(username)) return jsonError("Invalid username", 400);

    const store = await getStore();
    const target = await store.getUserByUsername(username);
    if (!target) return jsonError("That user does not exist", 404);

    await store.removeFriend(session.user.id, target.id);
    return jsonOk();
  } catch (err) {
    return handleApiError(err);
  }
}
