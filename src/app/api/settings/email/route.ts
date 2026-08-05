import { isValidEmail, normalizeEmail, resolveSession, verifyPassword } from "@/lib/auth";
import {
  getClientIp,
  handleApiError,
  jsonError,
  jsonOk,
  rateLimitedError,
  readJsonBody,
} from "@/lib/http";
import { getStore } from "@/lib/store";

/**
 * POST /api/settings/email
 * Changes the signed-in user's email. Requires the current password, rejects
 * an email already in use by another account, and revokes every OTHER session
 * plus all pending 2FA steps for the account.
 */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const next = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    if (!isValidEmail(next)) return jsonError("That email address is invalid", 400);
    if (next === session.user.email) return jsonError("That is already your email address", 400);

    const store = await getStore();
    const ip = getClientIp(req);
    const rl = await store.consumeRateLimit(`emailchange:${session.user.id}:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) return rateLimitedError(rl);

    const ok = await verifyPassword(current, session.user.passwordHash);
    if (!ok) return jsonError("Current password is incorrect", 403);

    // The users table has a UNIQUE index on email — surface collisions cleanly.
    const existing = await store.getUserByEmail(next);
    if (existing && existing.id !== session.user.id) {
      return jsonError("An account with this email already exists", 409);
    }

    await store.updateEmail(session.user.id, next);

    // Revoke all sessions except the one we're using, plus pending 2FA steps.
    await store.deleteUserPendings(session.user.email);
    const sessions = await store.getSessionsForUser(session.user.id);
    for (const s of sessions) {
      if (s.tokenHash !== session.session.tokenHash) {
        await store.deleteSession(s.tokenHash);
      }
    }

    return jsonOk({ message: "Email address updated." });
  } catch (err) {
    return handleApiError(err);
  }
}
