import { hashPassword, isValidPassword, resolveSession, verifyPassword } from "@/lib/auth";
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
 * POST /api/settings/password
 * Changes the signed-in user's password. Requires the current password,
 * then revokes every OTHER session (the current one stays alive) and all
 * pending 2FA steps for the account.
 */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const next = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!isValidPassword(next)) {
      return jsonError("New password must be 8-128 characters long", 400);
    }

    const store = await getStore();
    const ip = getClientIp(req);
    const rl = await store.consumeRateLimit(`passchange:${session.user.id}:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) return rateLimitedError(rl);

    const ok = await verifyPassword(current, session.user.passwordHash);
    if (!ok) return jsonError("Current password is incorrect", 403);

    const passwordHash = await hashPassword(next);
    await store.updatePassword(session.user.id, passwordHash);

    // Revoke all sessions except the one we're using, plus pending 2FA steps.
    await store.deleteUserPendings(session.user.email);
    const sessions = await store.getSessionsForUser(session.user.id);
    for (const s of sessions) {
      if (s.tokenHash !== session.session.tokenHash) {
        await store.deleteSession(s.tokenHash);
      }
    }

    return jsonOk({ message: "Password updated." });
  } catch (err) {
    return handleApiError(err);
  }
}
