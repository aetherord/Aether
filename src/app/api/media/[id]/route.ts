import { NextResponse } from "next/server";
import { resolveSession } from "@/lib/auth";
import { handleApiError, json, jsonError } from "@/lib/http";
import { decryptMediaPayload, getMedia } from "@/lib/media";

/**
 * GET /api/media/[id] — serves an uploaded image (session required).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const { id } = await params;
    const rec = await getMedia(id);
    if (!rec) return jsonError("Media not found", 404);

    // Quarantined media (flagged for admin review) is withheld from everyone
    // except admins — it only exists inside the moderation panel until a
    // reviewer decides keep-or-delete. 403 + a code lets the client render a
    // "flagged for review" placeholder instead of a broken image.
    if (rec.quarantined === 1 && session.user.role !== "admin") {
      return json({ error: "Media flagged for review", code: "quarantined" }, 403);
    }

    const bytes = Buffer.from(await decryptMediaPayload(rec.b64));
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "content-type": rec.mime,
        "content-length": String(bytes.byteLength),
        "cache-control": "private, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
