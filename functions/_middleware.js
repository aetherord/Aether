/**
 * Aether Pages proxy
 * ------------------
 * The Aether app itself runs as a Cloudflare Worker (OpenNext Cloudflare is
 * Workers-only), but the user-facing URL is aetherord.pages.dev. This Pages
 * Function forwards every request to the Worker and streams the response
 * back, so the address bar stays on pages.dev while the Worker does all the
 * work — auth cookies, SSE chat streams, media and static assets included.
 *
 * Because the app only uses relative URLs internally, nothing here needs to
 * rewrite links or redirects.
 */
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Forward the same path + query to the Worker (keeps host-relative URLs).
  const target = new URL(url.pathname + url.search, "https://aether.aetherord.workers.dev");

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

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: new Headers(res.headers),
  });
}
