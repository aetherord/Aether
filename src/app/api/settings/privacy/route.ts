import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk, readJsonBody } from "@/lib/http";
import { getStore, type MessagePrivacy } from "@/lib/store";

/** GET /api/settings/privacy — current "who can message you" setting. */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const store = await getStore();
    return jsonOk({ messagePrivacy: await store.getMessagePrivacy(session.user.id) });
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/settings/privacy — set who can DM you. */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const value = body.messagePrivacy;
    if (value !== "everyone" && value !== "friends" && value !== "nobody") {
      return jsonError("messagePrivacy must be everyone, friends or nobody", 400);
    }

    const store = await getStore();
    await store.setMessagePrivacy(session.user.id, value as MessagePrivacy);
    return jsonOk({ messagePrivacy: value });
  } catch (err) {
    return handleApiError(err);
  }
}
