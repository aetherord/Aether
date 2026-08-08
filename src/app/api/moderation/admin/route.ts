import { isReservedUsername, isValidUsername, resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk, readJsonBody } from "@/lib/http";
import { deleteMediaRecord, listQuarantinedMedia, setMediaQuarantined } from "@/lib/media";
import { getStore } from "@/lib/store";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/** Guards: only admins may call these endpoints. */
async function requireAdmin(req: Request) {
  const session = await resolveSession(req);
  if (!session) return { error: jsonError("Not authenticated", 401) };
  if (session.user.role !== "admin") return { error: jsonError("Forbidden", 403) };
  return { session };
}

function minutesFromInput(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Admin moderation endpoints.
 *
 * GET /api/moderation/admin?view=users&q=...   user search
 * GET /api/moderation/admin?view=user&username=...  full user audit
 * GET /api/moderation/admin?view=reviews      pending media review queue
 * GET /api/moderation/admin?view=log         moderation audit trail
 * GET /api/moderation/admin?view=reports     open message reports
 * GET /api/moderation/admin?view=appeals     suspension appeals
 *
 * POST /api/moderation/admin  { action, ... }
 *   actions: ban, unban, warn, remove-warning, mute, unmute, delete-message,
 *            set-admin, review-media, approve-appeal, deny-appeal
 */
export async function GET(req: Request) {
  try {
    const guarded = await requireAdmin(req);
    if (guarded.error) return guarded.error;

    const url = new URL(req.url);
    const view = url.searchParams.get("view") ?? "users";
    const store = await getStore();

    if (view === "reviews") {
      const reviews = await store.listMediaReviews("pending");
      return jsonOk({ reviews });
    }
    if (view === "log") {
      const log = await store.listModerationLog(200);
      return jsonOk({ log });
    }
    if (view === "reports") {
      const reports = await store.getReports(100);
      return jsonOk({ reports });
    }
    if (view === "appeals") {
      const appeals = await store.listAppeals();
      return jsonOk({ appeals });
    }
    if (view === "user") {
      const username = (url.searchParams.get("username") ?? "").trim();
      if (!USERNAME_RE.test(username)) return jsonError("Invalid username", 400);
      const user = await store.getUserByUsername(username);
      if (!user) return jsonError("That user does not exist", 404);
      const [warnings, messages, media, calls] = await Promise.all([
        store.listWarnings(user.id),
        store.listMessagesByUser(username, 100),
        store.listMediaRefsByUser(username, 100),
        store.listActiveCallsFor(username),
      ]);
      return jsonOk({
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          mutedUntil: user.mutedUntil,
          bannedUntil: user.bannedUntil,
          banReason: user.banReason,
          status: user.status,
          createdAt: user.createdAt,
        },
        warnings,
        messages,
        media,
        calls,
      });
    }

    // Default: user search — an empty query lists everyone so the admin can
    // browse the whole user base instead of needing to know a username first.
    const q = (url.searchParams.get("q") ?? "").trim();
    const users = await store.searchUsers(q, q.length >= 2 ? 25 : 200);
    return jsonOk({ users });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    const guarded = await requireAdmin(req);
    if (guarded.error) return guarded.error;
    const session = guarded.session!;

    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const action = typeof body.action === "string" ? body.action : "";
    const username = (typeof body.username === "string" ? body.username : "").trim();
    const store = await getStore();

    // ── actions that target a message ─────────────────────────────────────
    if (action === "delete-message") {
      const messageId = Number(body.messageId);
      if (!Number.isFinite(messageId) || messageId <= 0) return jsonError("Invalid message", 400);
      const [msg] = await store.getMessagesByIds([messageId]);
      await store.deleteMessage(messageId);
      await store.resolveReportsForMessage(messageId); // close reports once actioned
      // Quarantine its media too, so the image/video stops being served even
      // before a human reviews the queue.
      if (msg?.mediaRef) {
        try {
          await setMediaQuarantined(msg.mediaRef, true);
        } catch {
          /* media store unreachable */
        }
      }
      await store.logModeration(session.user.username, "delete-message", msg?.senderUsername ?? "?", String(messageId));
      return jsonOk();
    }

    // ── suspension appeals (target by appeal id, so they run before the
    //    username validation below) ────────────────────────────────────────
    if (action === "approve-appeal" || action === "deny-appeal") {
      const appealId = Number(body.appealId);
      if (!Number.isFinite(appealId) || appealId <= 0) return jsonError("Invalid appeal", 400);
      const appeals = await store.listAppeals("pending");
      const appeal = appeals.find((a) => a.id === appealId);
      if (!appeal) return jsonError("Appeal not found", 404);
      if (action === "approve-appeal") {
        await store.setBannedUntil(appeal.userId, null);
        await store.setAppealStatus(appealId, "approved", session.user.username);
        await store.logModeration(session.user.username, "approve-appeal", appeal.username, "unbanned");
      } else {
        await store.setAppealStatus(appealId, "denied", session.user.username);
        await store.logModeration(session.user.username, "deny-appeal", appeal.username);
      }
      return jsonOk();
    }

    if (!USERNAME_RE.test(username)) return jsonError("Invalid username", 400);
    const target = await store.getUserByUsername(username);
    if (!target) return jsonError("That user does not exist", 400);
    if (target.role === "admin" && action !== "unban" && action !== "warn" && action !== "remove-warning") {
      return jsonError("You cannot moderate another admin", 403);
    }

    switch (action) {
      case "ban": {
        const minutes = minutesFromInput(body.minutes);
        const reason =
          typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "Banned";
        if (!minutes) return jsonError("Invalid duration", 400);
        const until = Date.now() + minutes * 60 * 1000;
        await store.setBannedUntil(target.id, until, reason);
        await store.deleteUserSessions(target.id); // kick them out now
        await store.logModeration(session.user.username, "ban", username, `${reason} (${minutes}m)`);
        return jsonOk({ bannedUntil: until });
      }
      case "unban": {
        await store.setBannedUntil(target.id, null);
        await store.logModeration(session.user.username, "unban", username);
        return jsonOk();
      }
      case "warn": {
        const reason =
          typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
        if (!reason) return jsonError("A reason is required", 400);
        await store.addWarning(target.id, session.user.username, reason);
        await store.logModeration(session.user.username, "warn", username, reason);
        return jsonOk();
      }
      case "remove-warning": {
        const warningId = Number(body.warningId);
        if (!Number.isFinite(warningId) || warningId <= 0) return jsonError("Invalid warning", 400);
        await store.removeWarning(warningId);
        await store.logModeration(session.user.username, "remove-warning", username, String(warningId));
        return jsonOk();
      }
      case "mute": {
        const minutes = minutesFromInput(body.minutes);
        if (!minutes) return jsonError("Invalid duration", 400);
        const until = Date.now() + minutes * 60 * 1000;
        await store.setMutedUntil(target.id, until);
        await store.logModeration(session.user.username, "mute", username, `${minutes}m`);
        return jsonOk({ mutedUntil: until });
      }
      case "unmute": {
        await store.setMutedUntil(target.id, null);
        await store.logModeration(session.user.username, "unmute", username);
        return jsonOk();
      }
      case "set-admin": {
        await store.setRole(target.id, "admin");
        await store.logModeration(session.user.username, "set-admin", username);
        return jsonOk();
      }
      case "remove-admin": {
        await store.setRole(target.id, "user");
        await store.logModeration(session.user.username, "remove-admin", username);
        return jsonOk();
      }
      case "change-username": {
        const newName = (typeof body.newUsername === "string" ? body.newUsername : "").trim();
        if (!isValidUsername(newName)) {
          return jsonError("New username must be 3–20 characters (letters, numbers, underscores)", 400);
        }
        if (isReservedUsername(newName)) {
          return jsonError("That username is not allowed — company and brand names can't be used", 400);
        }
        const taken = await store.getUserByUsername(newName);
        if (taken) return jsonError("That username is already taken", 409);
        await store.changeUsername(target.id, newName);
        await store.logModeration(
          session.user.username,
          "change-username",
          username,
          `${username} → ${newName}`
        );
        return jsonOk({ username: newName });
      }
      case "review-media": {
        const mediaRef = (typeof body.mediaRef === "string" ? body.mediaRef : "").trim();
        const decision = body.decision === "delete" ? "delete" : "keep";
        if (!mediaRef) return jsonError("Invalid media ref", 400);
        if (decision === "delete") {
          // Counter-measure: purge the bytes from the media store entirely, so
          // nothing remains server-side, then delete any message referencing it.
          await deleteMediaRecord(mediaRef);
          const msgs = await store.listMessagesByMediaRef(mediaRef);
          for (const m of msgs) await store.deleteMessage(m.id);
        } else {
          await setMediaQuarantined(mediaRef, false);
        }
        // Resolve any pending review rows for this media.
        const pending = (await store.listMediaReviews("pending")).filter((r) => r.mediaRef === mediaRef);
        for (const r of pending) {
          await store.setMediaReviewStatus(r.id, decision, session.user.username);
        }
        await store.logModeration(session.user.username, `review-media:${decision}`, "?", mediaRef);
        return jsonOk({ decision });
      }
      default:
        return jsonError("Unknown action", 400);
    }
  } catch (err) {
    return handleApiError(err);
  }
}
