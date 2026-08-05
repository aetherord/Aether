import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk, readJsonBody } from "@/lib/http";
import { getStore } from "@/lib/store";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const PUBKEY_RE = /^[A-Za-z0-9+/=]{20,200}$/;

/**
 * POST /api/keys/pubkey — store the caller's E2E public key + timezone.
 * The public key is meant to be public (it is a key-exchange public key); the
 * private key never leaves the client's browser.
 */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const pubkey = typeof body.pubkey === "string" ? body.pubkey.trim() : "";
    const timezone = typeof body.timezone === "string" ? body.timezone.slice(0, 64) : "";
    if (pubkey && !PUBKEY_RE.test(pubkey)) return jsonError("Invalid public key", 400);

    const store = await getStore();
    await store.setProfileKeys(session.user.id, pubkey || null, timezone || null);
    return jsonOk();
  } catch (err) {
    return handleApiError(err);
  }
}

/** GET /api/keys/pubkey?username=... — fetch a peer's public key + timezone. */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const username = (new URL(req.url).searchParams.get("username") ?? "").trim();
    if (!USERNAME_RE.test(username)) return jsonError("Invalid username", 400);

    const store = await getStore();
    const user = await store.getUserByUsername(username);
    if (!user) return jsonError("That user does not exist", 404);

    return jsonOk({ pubkey: user.pubkey, timezone: user.timezone });
  } catch (err) {
    return handleApiError(err);
  }
}
