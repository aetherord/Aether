/**
 * Aether Pages proxy
 * ------------------
 * The Aether app itself runs as a Cloudflare Worker (OpenNext Cloudflare is
 * Workers-only), but the user-facing URL is aetherord.pages.dev. This Pages
 * Function forwards every request to the Worker and streams the response
 * back, so the address bar stays on pages.dev while the Worker does all the
 * work — auth cookies, SSE chat streams, media and static assets included.
 *
 * Two defensive touches keep the URL pinned to pages.dev:
 *   - any Location/Content-Location header pointing at the Worker host is
 *     rewritten to a host-relative path, so a redirect never bounces the
 *     browser to workers.dev;
 *   - long-lived hashed static assets get Cache-Control so the chat stays
 *     quick instead of round-tripping every asset through the Worker.
 */
const WORKER_HOST = "aether.aetherord.workers.dev";
const REWRITE_RE = new RegExp(`^https://${WORKER_HOST.replace(/\./g, "\\.")}(/|$)`);

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Forward the same path + query to the Worker (keeps host-relative URLs).
  const target = new URL(url.pathname + url.search, `https://${WORKER_HOST}`);

  const headers = new Headers(request.headers);
  // The Worker's own host is derived from the fetch URL; drop the incoming
  // Host so nothing attempts to validate or rewrite it.
  headers.delete("host");

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  const res = await fetch(target, init);
  const outHeaders = new Headers(res.headers);

  // Never let a redirect escape to the Worker host — keep it on pages.dev.
  for (const name of ["location", "content-location"]) {
    const value = outHeaders.get(name);
    if (value && REWRITE_RE.test(value)) {
      outHeaders.set(name, value.replace(REWRITE_RE, "/"));
    }
  }

  // Hashed build assets are immutable and never change per-hash.
  if (url.pathname.startsWith("/_next/static/") && res.status === 200) {
    outHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: outHeaders,
  });
}
