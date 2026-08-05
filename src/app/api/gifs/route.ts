import { resolveSession } from "@/lib/auth";
import { getSecret } from "@/lib/env";
import { handleApiError, jsonError, jsonOk } from "@/lib/http";

/**
 * GET /api/gifs?q=...&pos=...
 * Proxies Tenor's v2 search so the client never talks to a third party
 * directly (and so no API key leaks into the browser). Set TENOR_API_KEY in
 * .env.local to enable. If unset, returns { configured: false }.
 */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const key = getSecret("TENOR_API_KEY");
    if (!key) return jsonOk({ configured: false, results: [] });

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
    const pos = (url.searchParams.get("pos") ?? "").slice(0, 40);
    if (!q) return jsonOk({ configured: true, results: [] });

    const params = new URLSearchParams({
      key,
      q,
      limit: "18",
      media_filter: "minimal",
      contentfilter: "moderate",
    });
    if (pos) params.set("pos", pos);

    const res = await fetch(`https://tenor.com/v2/search?${params.toString()}`, {
      headers: { "accept": "application/json" },
    });
    if (!res.ok) return jsonError("GIF search failed", 502);

    const data = (await res.json()) as {
      next?: string;
      results?: {
        title?: string;
        media_formats?: { gif?: { url?: string; preview?: string }; tinygif?: { url?: string } };
      }[];
    };
    const results = (data.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.media_formats?.gif?.url ?? "",
      preview: r.media_formats?.gif?.preview ?? r.media_formats?.tinygif?.url ?? "",
    })).filter((r) => r.url);

    return jsonOk({ configured: true, results, next: data.next ?? null });
  } catch (err) {
    return handleApiError(err);
  }
}
