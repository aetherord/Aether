import { isValidEmail, normalizeEmail, verifyTurnstile } from "@/lib/auth";
import { getClientIp, handleApiError, jsonError, jsonOk, readJsonBody } from "@/lib/http";
import { getStore } from "@/lib/store";

/**
 * POST /api/moderation/appeal
 * Anonymous (no session — a suspended user has none by design). Lets a banned
 * account submit an appeal that lands in the admin panel's Appeals queue.
 *
 * Protection: Turnstile bot check (same keys as login) + a per-IP cap of 3
 * appeals/hour, so the endpoint can't be spammed to flood the queue.
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const turnstileToken =
      typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;
    if (!(await verifyTurnstile(turnstileToken))) {
      return jsonError("Bot check failed. Please try again.", 400);
    }

    const account = (typeof body.account === "string" ? body.account : "").trim().slice(0, 254);
    const reason = (typeof body.reason === "string" ? body.reason : "").trim().slice(0, 1000);
    if (!account || !reason) return jsonError("Please fill in both fields", 400);

    const store = await getStore();
    const ip = getClientIp(req);
    const rl = await store.consumeRateLimit(`appeal:ip:${ip}`, 3, 60 * 60 * 1000);
    if (!rl.allowed) return jsonError("Too many appeals. Please try again later.", 429);

    // The account may be an email or a username; it must exist AND be banned.
    const user = isValidEmail(account)
      ? await store.getUserByEmail(normalizeEmail(account))
      : await store.getUserByUsername(account);
    if (!user) return jsonError("We couldn't find that account.", 404);

    const ok = await store.createAppeal({ userId: user.id, username: user.username, reason });
    if (!ok) return jsonError("That account is not currently suspended.", 400);

    return jsonOk({ submitted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
