import { NextResponse } from "next/server";
import type { RateLimitResult } from "./store";

export const EMAIL_NOT_CONFIGURED_MESSAGE =
  "Email service is not configured (set BREVO_API_KEY)";

export const MAX_BODY_BYTES = 4096;

export const SESSION_COOKIE = "aether_session";
export const PENDING_COOKIE = "aether_pending";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const PENDING_TTL_SECONDS = 10 * 60; // 10 minutes

const isProd = process.env.NODE_ENV === "production";

/** Error carrying an HTTP status (and optional headers) for API routes. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly headers?: Record<string, string>
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json(data: unknown, status = 200, headers?: Record<string, string>): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export function jsonOk(data: Record<string, unknown> = {}): NextResponse {
  return json({ ok: true, ...data });
}

export function jsonError(message: string, status = 400, headers?: Record<string, string>): NextResponse {
  return json({ error: message }, status, headers);
}

export function rateLimitedError(result: RateLimitResult, message = "Too many requests. Please try again later."): NextResponse {
  return jsonError(message, 429, { "Retry-After": String(result.retryAfterSec) });
}

/** Normalizes any error thrown by a route handler into a JSON response. */
export function handleApiError(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return jsonError(err.message, err.status, err.headers);
  }
  if (err instanceof Error && err.message === EMAIL_NOT_CONFIGURED_MESSAGE) {
    return jsonError(err.message, 503);
  }
  console.error("api error:", err instanceof Error ? err.message : err);
  return jsonError("Something went wrong. Please try again.", 500);
}

/**
 * Reads and parses a JSON request body with a hard size cap. Returns null when
 * the request is not JSON or is unparseable, and throws HttpError when it is
 * too large. This keeps attackers from uploading huge payloads.
 */
export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large");

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large");
  if (text.length === 0) return null;

  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const IP_RE = /^[\d.a-fA-F:]+$/;

/** Best-effort client IP from Cloudflare / proxy headers. */
export function getClientIp(req: Request): string {
  // cf-connecting-ip is set by Cloudflare and cannot be spoofed by the client;
  // x-forwarded-for can be forged when the origin is hit directly.
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp && cfIp.length <= 45 && IP_RE.test(cfIp)) return cfIp;
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim() ?? "";
    if (first.length <= 45 && IP_RE.test(first)) return first;
  }
  return "unknown";
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      const value = part.slice(idx + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_SECONDS));
}

export function setPendingCookie(res: NextResponse, token: string): void {
  res.cookies.set(PENDING_COOKIE, token, cookieOptions(PENDING_TTL_SECONDS));
}

export function clearAuthCookies(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  res.cookies.set(PENDING_COOKIE, "", cookieOptions(0));
}
