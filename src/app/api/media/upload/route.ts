import { resolveSession } from "@/lib/auth";
import {
  handleApiError,
  jsonError,
  jsonOk,
} from "@/lib/http";
import { enqueueMedia, ensureMediaSchema, mediaConfigured } from "@/lib/media";

const MAX_MEDIA_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "image";
  const cleaned = base.replace(/[^\w.\- ]/g, "_").slice(0, 120).trim();
  return cleaned || "image";
}

/**
 * POST /api/media/upload (multipart/form-data: file, optional recipient)
 * Stores the image in the Turso media queue. The local machine mirrors it into
 * D:\Aether-Images-and-media\{sender}\{recipient}\ via scripts/sync-media.mjs.
 */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    if (!mediaConfigured()) {
      return jsonError("Media storage is not configured", 503);
    }

    const form = await req.formData();
    const file = form.get("file");
    const recipientRaw = form.get("recipient");
    const recipient =
      typeof recipientRaw === "string" && recipientRaw.trim()
        ? recipientRaw.trim().slice(0, 32)
        : null;

    if (!(file instanceof File)) return jsonError("No file provided", 400);

    const mime = file.type.toLowerCase();
    if (!ALLOWED_MIME.has(mime)) return jsonError("Unsupported file type", 415);
    if (file.size > MAX_MEDIA_BYTES) return jsonError("File too large (max 5 MB)", 413);
    if (file.size === 0) return jsonError("File is empty", 400);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const b64 = Buffer.from(bytes).toString("base64");

    await ensureMediaSchema();
    const mediaRef = await enqueueMedia({
      senderUsername: session.user.username,
      recipientUsername: recipient,
      filename: sanitizeFilename(file.name),
      mime,
      b64,
    });

    return jsonOk({ mediaRef });
  } catch (err) {
    return handleApiError(err);
  }
}
