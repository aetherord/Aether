import { resolveSession } from "@/lib/auth";
import {
  handleApiError,
  jsonError,
  jsonOk,
  rateLimitedError,
} from "@/lib/http";
import { getStore } from "@/lib/store";
import { enqueueMedia, ensureMediaSchema, mediaConfigured, setMediaQuarantined } from "@/lib/media";
import { getAiBinding } from "@/lib/env";
import { classifyImage } from "@/lib/nsfw";

// Per-user upload throttle so a single account cannot fill the Turso queue.
const UPLOAD_WINDOW_MS = 15 * 60 * 1000;
const UPLOAD_LIMIT = 30;

// Turso's HTTP API chokes around ~17.5 MB payloads (measured), so images are
// capped at 5 MB and videos at 15 MB to stay safely under the ceiling.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_VIDEO_BYTES = 15 * 1024 * 1024; // 15 MB

const ALLOWED_MIME = new Map<string, "image" | "video">([
  ["image/png", "image"],
  ["image/jpeg", "image"],
  ["image/gif", "image"],
  ["image/webp", "image"],
  ["image/avif", "image"],
  ["video/mp4", "video"],
  ["video/webm", "video"],
  ["video/quicktime", "video"],
]);

function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "media";
  const cleaned = base.replace(/[^\w.\- ]/g, "_").slice(0, 120).trim();
  return cleaned || "media";
}

/**
 * POST /api/media/upload (multipart/form-data: file, optional recipient)
 * Stores the image/video in the Turso media queue. The local machine mirrors
 * it into D:\Aether-Images-and-media\{sender}\{recipient}\ via
 * scripts/sync-media.mjs.
 */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    if (!mediaConfigured()) {
      return jsonError("Media storage is not configured", 503);
    }

    const store = await getStore();
    const rl = await store.consumeRateLimit(
      `upload:user:${session.user.id}`,
      UPLOAD_LIMIT,
      UPLOAD_WINDOW_MS
    );
    if (!rl.allowed) return rateLimitedError(rl, "Too many uploads. Please try again later.");

    const form = await req.formData();
    const file = form.get("file");
    const recipientRaw = form.get("recipient");
    const recipient =
      typeof recipientRaw === "string" && recipientRaw.trim()
        ? recipientRaw.trim().slice(0, 32)
        : null;

    if (!(file instanceof File)) return jsonError("No file provided", 400);

    const mime = file.type.toLowerCase();
    const kind = ALLOWED_MIME.get(mime);
    if (!kind) return jsonError("Unsupported file type", 415);

    const cap = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (file.size > cap) {
      return jsonError(
        kind === "video" ? "Video too large (max 15 MB)" : "Image too large (max 5 MB)",
        413
      );
    }
    if (file.size === 0) return jsonError("File is empty", 400);

    const bytes = new Uint8Array(await file.arrayBuffer());

    await ensureMediaSchema();
    const mediaRef = await enqueueMedia({
      senderUsername: session.user.username,
      recipientUsername: recipient,
      filename: sanitizeFilename(file.name),
      mime,
      bytes,
    });

    // Automated NSFW screening (Workers AI, image-only). A hard flag
    // quarantines the media immediately — hidden from every non-admin and
    // never written to the local drive — and queues it for the review panel.
    // Best-effort: without the AI binding (or on any inference error) the
    // upload goes through untouched, like before.
    let flagged = false;
    const ai = kind === "image" ? getAiBinding() : null;
    if (ai) {
      const verdict = await classifyImage(ai, bytes);
      if (verdict.scanned && verdict.reason) {
        try {
          if (verdict.flagged) {
            await setMediaQuarantined(mediaRef, true);
            flagged = true;
          }
          await store.addMediaReview({
            mediaRef,
            mediaMime: mime,
            senderUsername: session.user.username,
            reason: verdict.reason,
            reporterUsername: "auto-scan",
          });
        } catch {
          /* media store or DB hiccup — the upload itself already succeeded */
        }
      }
    }

    return jsonOk({ mediaRef, mime, flagged });
  } catch (err) {
    return handleApiError(err);
  }
}
