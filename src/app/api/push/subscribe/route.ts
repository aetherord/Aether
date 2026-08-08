import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk, readJsonBody } from "@/lib/http";
import { getStore } from "@/lib/store";

const MAX_LEN = 2048;

/** POST /api/push/subscribe — store a Web Push subscription for this user. */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const endpoint = typeof body.endpoint === "string" ? body.endpoint.slice(0, MAX_LEN) : "";
    const p256dh = typeof body.p256dh === "string" ? body.p256dh.slice(0, MAX_LEN) : "";
    const auth = typeof body.auth === "string" ? body.auth.slice(0, MAX_LEN) : "";
    if (!endpoint.startsWith("https://") && !endpoint.startsWith("http://")) {
      return jsonError("Invalid subscription endpoint", 400);
    }
    if (!p256dh || !auth) return jsonError("Invalid subscription keys", 400);

    const store = await getStore();
    await store.savePushSubscription(session.user.id, { endpoint, p256dh, auth });
    return jsonOk({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

/** DELETE /api/push/subscribe?endpoint=... — remove a subscription. */
export async function DELETE(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const endpoint = (new URL(req.url).searchParams.get("endpoint") ?? "").slice(0, MAX_LEN);
    if (!endpoint) return jsonError("Missing endpoint", 400);

    const store = await getStore();
    await store.removePushSubscription(endpoint);
    return jsonOk({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
