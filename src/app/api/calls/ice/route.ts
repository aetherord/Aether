import { resolveSession } from "@/lib/auth";
import { getSecret } from "@/lib/env";
import { handleApiError, jsonError, jsonOk } from "@/lib/http";

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * GET /api/calls/ice (session required)
 * Returns the RTCPeerConnection `iceServers` array for calls.
 *
 * When TURN_KEY_ID + TURN_KEY_API_TOKEN are configured (Cloudflare Calls TURN
 * keys created in the dashboard/API), short-lived credentials are minted on
 * demand — the browser never sees the long-term key, and credentials expire
 * on their own TTL. Without them, STUN-only (works on most home networks).
 *
 * The minted config is cached per isolate for a few hours; if it ever goes
 * stale the TTL self-heals the next day, and any failure degrades to STUN
 * rather than breaking call setup.
 */

const STUN_ONLY: IceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];

const CACHE_MS = 12 * 60 * 60 * 1000;
const TTL_SECONDS = 86_400; // credentials live for 24h

let cached: { at: number; iceServers: IceServer[] } | null = null;

export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    if (cached && Date.now() - cached.at < CACHE_MS) {
      return jsonOk({ iceServers: cached.iceServers });
    }

    const keyId = getSecret("TURN_KEY_ID");
    const keyToken = getSecret("TURN_KEY_API_TOKEN");
    if (!keyId || !keyToken) {
      cached = { at: Date.now(), iceServers: STUN_ONLY };
      return jsonOk({ iceServers: STUN_ONLY });
    }

    try {
      const res = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${keyToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ttl: TTL_SECONDS }),
        }
      );
      if (!res.ok) throw new Error(`TURN: HTTP ${res.status}`);

      const data = (await res.json()) as { iceServers?: IceServer[] };
      const iceServers = (data.iceServers ?? [])
        // Port 53 is blocked by browsers and only causes timeout waits.
        .map((s) => ({
          ...s,
          urls: Array.isArray(s.urls)
            ? s.urls.filter((u) => !/:53(\?|$)/.test(u))
            : s.urls,
        }))
        .filter((s) => (Array.isArray(s.urls) ? s.urls.length > 0 : Boolean(s.urls)));

      cached = { at: Date.now(), iceServers: iceServers.length > 0 ? iceServers : STUN_ONLY };
      return jsonOk({ iceServers: cached.iceServers });
    } catch {
      // Fall back to STUN-only rather than failing call setup.
      return jsonOk({ iceServers: STUN_ONLY });
    }
  } catch (err) {
    return handleApiError(err);
  }
}
