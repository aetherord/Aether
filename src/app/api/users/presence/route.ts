import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/http";
import { getStore } from "@/lib/store";

/**
 * POST /api/users/presence — heartbeat.
 *
 * The chat client pings this every ~30 seconds while the app is open. It
 * records `last_seen_at`, which is what makes presence *real*: instead of a
 * hand-picked status label, friends see "online" only when you actually have
 * the app open, and "last seen X ago" when you don't.
 */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const store = await getStore();
    // Keep heartbeats cheap: one row update, no rate limit needed (it's a
    // tiny write, and throttling it would just make presence lag).
    await store.setLastSeen(session.user.id);
    return jsonOk({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
