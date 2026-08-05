import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk, rateLimitedError } from "@/lib/http";
import { getStore } from "@/lib/store";
import { enqueueMedia, mediaConfigured } from "@/lib/media";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_AVATAR_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** POST /api/settings/avatar (multipart: file) — set the profile picture. */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    if (!mediaConfigured()) return jsonError("Media storage is not configured", 503);

    const store = await getStore();
    const rl = await store.consumeRateLimit(`avatar:user:${session.user.id}`, 5, 60 * 60 * 1000);
    if (!rl.allowed) return rateLimitedError(rl, "Too many avatar changes. Try again later.");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("No file provided", 400);
    if (!ALLOWED_AVATAR_MIME.has(file.type.toLowerCase())) {
      return jsonError("Avatar must be a PNG, JPEG, WebP or GIF image", 415);
    }
    if (file.size > MAX_AVATAR_BYTES) return jsonError("Avatar too large (max 2 MB)", 413);
    if (file.size === 0) return jsonError("File is empty", 400);

    const bytes = new Uint8Array(await file.arrayBuffer());

    // Sender "_avatars" keeps profile pictures out of the DM folder tree on
    // the D: drive (the sync script skips this namespace).
    const ref = await enqueueMedia({
      senderUsername: "_avatars",
      recipientUsername: null,
      filename: `avatar-${session.user.id}.${file.type.split("/")[1] ?? "png"}`,
      mime: file.type.toLowerCase(),
      bytes,
    });

    await store.setAvatar(session.user.id, ref);
    return jsonOk({ avatar: ref });
  } catch (err) {
    return handleApiError(err);
  }
}

/** DELETE /api/settings/avatar — remove the profile picture. */
export async function DELETE(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);
    const store = await getStore();
    await store.setAvatar(session.user.id, null);
    return jsonOk();
  } catch (err) {
    return handleApiError(err);
  }
}
