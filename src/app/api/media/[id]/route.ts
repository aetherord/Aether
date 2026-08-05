import { NextResponse } from "next/server";
import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError } from "@/lib/http";
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
