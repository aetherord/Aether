import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/*
 * Per-isolate burst limiter. Cloudflare's edge already absorbs volumetric
 * attacks; this is a cheap second layer that sheds load before it reaches the
 * application when a single IP hammers the origin. It is per-isolate state,
 * so it is a tripwire, not a full DDoS defense.
 */
const BURST_WINDOW_MS = 60_000;
// Generous per-IP ceiling: one page load + polling fires ~10 requests, and
// several users can share a NAT IP. The app routes still enforce their own
// per-user limits; this is only a volumetric tripwire.
const BURST_MAX_PER_IP = 1_500;
const MAX_TRACKED_IPS = 10_000;

const requestLog = new Map<string, number[]>();

function isBursting(ip: string): boolean {
  const now = Date.now();
  if (requestLog.size > MAX_TRACKED_IPS) {
    requestLog.clear();
  }
  const recent = (requestLog.get(ip) ?? []).filter((t) => now - t < BURST_WINDOW_MS);
  if (recent.length >= BURST_MAX_PER_IP) {
    requestLog.set(ip, recent);
    return true;
  }
  recent.push(now);
  requestLog.set(ip, recent);
  return false;
}

export function middleware(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";

  // Long-lived SSE chat streams are a single request each. Burst-limiting them
  // makes the browser's EventSource auto-reconnect loop hammer the origin,
  // which is exactly the storm we're trying to shed. Scoped to the stream path
  // so the header can't be used to dodge the limiter on any other endpoint.
  const urlPath = new URL(request.url).pathname;
  const isStream =
    urlPath === "/api/chat/stream" &&
    (request.headers.get("accept") ?? "").includes("text/event-stream");

  if (!isStream && isBursting(ip)) {
    // JSON body so API clients never choke on a plain-text 429.
    return NextResponse.json(
      { error: "Too many requests. Please slow down and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": "10",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const response = NextResponse.next();

  // Security headers
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );

  /*
   * Content Security Policy.
   *
   * `'unsafe-inline'` on script-src is required: Next.js ships its RSC payload
   * as inline <script> tags (and in dev the hydration bootstrap too), and this
   * Next version exposes no nonce mechanism. The damage is limited by the
   * strict directives around it (no object-src, fixed base-uri, self-only
   * form-action) plus HttpOnly cookies and never-rendered HTML from user data.
   */
  const scriptSrc =
    process.env.NODE_ENV === "development"
      ? "'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com"
      : "'self' 'unsafe-inline' https://challenges.cloudflare.com";
  response.headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; worker-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none';`
  );

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|public/).*)",
  ],
};
