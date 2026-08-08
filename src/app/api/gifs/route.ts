import { resolveSession } from "@/lib/auth";
import { getSecret } from "@/lib/env";
import { handleApiError, jsonError, jsonOk } from "@/lib/http";

/**
 * GET /api/gifs?q=...&pos=...
 * GIF search for the picker.
 *
 * Preferred: Tenor's v2 API (set TENOR_API_KEY). Fallback: scrape the public
 * Tenor search page for direct media URLs — keyless, so GIFs keep working
 * even without an API key (the old beta keys are discontinued).
 */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
    if (!q) return jsonOk({ configured: true, results: [] });

    const key = getSecret("TENOR_API_KEY");
    if (key) {
      const pos = (url.searchParams.get("pos") ?? "").slice(0, 40);
      const params = new URLSearchParams({
        key,
        q,
        limit: "18",
        media_filter: "minimal",
        contentfilter: "moderate",
      });
      if (pos) params.set("pos", pos);
      const res = await fetch(`https://tenor.com/v2/search?${params.toString()}`, {
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          next?: string;
          results?: {
            title?: string;
            media_formats?: { gif?: { url?: string; preview?: string }; tinygif?: { url?: string } };
          }[];
        };
        const results = (data.results ?? [])
          .map((r) => ({
            title: r.title ?? "",
            url: r.media_formats?.gif?.url ?? "",
            preview: r.media_formats?.gif?.preview ?? r.media_formats?.tinygif?.url ?? "",
          }))
          .filter((r) => r.url);
        return jsonOk({ configured: true, results, next: data.next ?? null });
      }
    }

    // Keyless fallback: scrape tenor.com/search for direct media URLs.
    const html = await fetch(`https://tenor.com/search/${encodeURIComponent(q + "-gifs")}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Aether/1.0" },
    }).then((r) => (r.ok ? r.text() : Promise.resolve("")));

    const byId = new Map<string, { title: string; url: string; preview: string }>();
    const re = /https:\/\/media\.tenor\.com\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\.(gif|webp)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) && byId.size < 60) {
      const [full, idAndSize, name, ext] = match;
      const sizeMatch = /^(.*?)(A{2,}[0-9A-Za-z]+)$/.exec(idAndSize);
      const contentId = sizeMatch ? sizeMatch[1] : idAndSize;
      const size = sizeMatch ? sizeMatch[2] : "";
      const entry = byId.get(contentId) ?? { title: name.replace(/-/g, " "), url: "", preview: "" };
      if (ext === "gif" && size.startsWith("AAAA") && size.endsWith("M")) entry.url = full;
      else if (ext === "webp" && size.startsWith("AAAA") && size.endsWith("1") && !entry.preview) entry.preview = full;
      byId.set(contentId, entry);
    }
    const results = [...byId.values()].filter((r) => r.url).slice(0, 18);
    if (results.length > 0) return jsonOk({ configured: true, results, next: null });
    return jsonOk({ configured: true, results: [], next: null });
  } catch (err) {
    return handleApiError(err);
  }
}
