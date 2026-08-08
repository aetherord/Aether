import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk, readJsonBody } from "@/lib/http";
import { setMediaQuarantined } from "@/lib/media";
import { getStore } from "@/lib/store";

const REPORT_RATE_WINDOW = 60 * 60 * 1000;
const REPORT_RATE_LIMIT = 20;

/**
 * POST /api/moderation/report — report a message.
 *
 * Counter-measure: if the reported message carries media (image/video), the
 * media is quarantined immediately — hidden from all non-admin users and never
 * written to the local drive — and queued in the admin panel's review queue,
 * where a reviewer chooses keep-or-delete. This stops the offending content
 * spreading the moment it is reported, before any human reviews it.
 */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const body = await readJsonBody(req);
    if (!body) return jsonError("Invalid request body", 400);

    const messageId = Number(body.messageId);
    const reason =
      typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!Number.isFinite(messageId) || messageId <= 0) return jsonError("Invalid message", 400);
    if (!reason) return jsonError("A reason is required", 400);

    const store = await getStore();
    const rl = await store.consumeRateLimit(
      `report:${session.user.id}`,
      REPORT_RATE_LIMIT,
      REPORT_RATE_WINDOW
    );
    if (!rl.allowed) {
      return jsonError("Too many reports. Please try again later.", 429, {
        "Retry-After": String(rl.retryAfterSec),
      });
    }

    await store.addReport(messageId, session.user.id, reason);

    // Auto-quarantine media attached to the reported message.
    const [reported] = await store.getMessagesByIds([messageId]);
    if (reported?.mediaRef) {
      try {
        await setMediaQuarantined(reported.mediaRef, true);
        await store.addMediaReview({
          mediaRef: reported.mediaRef,
          mediaMime: reported.mediaMime,
          senderUsername: reported.senderUsername,
          reason,
          reporterUsername: session.user.username,
        });
      } catch {
        // Media store may be unreachable — the report itself still lands.
      }
    }

    return jsonOk();
  } catch (err) {
    return handleApiError(err);
  }
}
