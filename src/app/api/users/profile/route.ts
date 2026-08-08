import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/http";
import { getStore } from "@/lib/store";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/** A user is "really online" when their last heartbeat is < 2 minutes old. */
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;

/** GET /api/users/profile?username=... — public profile for the DM header. */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const username = (new URL(req.url).searchParams.get("username") ?? "").trim();
    if (!USERNAME_RE.test(username)) return jsonError("Invalid username", 400);

    const store = await getStore();
    const profile = await store.getProfileByUsername(username);
    if (!profile) return jsonError("That user does not exist", 404);

    const peer = await store.getUserByUsername(username);
    const isFriend = username === session.user.username
      ? null
      : peer
        ? await store.areFriends(session.user.id, peer.id)
        : false;
    const isBlocked = peer ? await store.isBlocked(session.user.id, peer.id) : false;
    const isOnline =
      profile.lastSeenAt != null && Date.now() - profile.lastSeenAt < ONLINE_WINDOW_MS;

    return jsonOk({
      profile: {
        ...profile,
        isFriend,
        isBlocked,
        isOnline,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
