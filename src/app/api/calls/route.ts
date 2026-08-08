import { resolveSession } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk, readJsonBody } from "@/lib/http";
import { generateToken } from "@/lib/crypto";
import { getStore } from "@/lib/store";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const MAX_BODY_BYTES = 64 * 1024; // SDP offers/answers are a few KB

/**
 * Voice-call signaling relay.
 *
 * WebRTC needs a channel to exchange SDP offers/answers and ICE candidates.
 * This route stores that handshake in D1 (call_sessions + call_candidates)
 * and both peers poll for updates — the same pattern the chat stream uses,
 * so no new infrastructure (WebSockets/durable objects) is required.
 *
 * POST /api/calls
 *   { action: "start", callee }            → creates a ringing call, returns { callId }
 *   { action: "offer", callId, offer }     → caller stores their SDP offer
 *   { action: "answer", callId, answer }   → callee stores their SDP answer
 *   { action: "candidate", callId, candidate } → exchange ICE candidates
 *   { action: "hangup", callId, reason? }  → end the call
 *   { action: "ringing", callId }          → callee acknowledges they saw it
 *
 * GET /api/calls?poll=1                    → active calls for me (ringing/active)
 * GET /api/calls?callId=...&after=...      → poll one call for updates + new candidates
 */
export async function POST(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    // Larger body cap: SDP blobs are big; read directly instead of readJsonBody.
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return jsonError("Request body too large", 413);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return jsonError("Invalid request body", 400);
    }

    const action = typeof body.action === "string" ? body.action : "";
    const store = await getStore();

    switch (action) {
      case "start": {
        const callee = (typeof body.callee === "string" ? body.callee : "").trim();
        if (!USERNAME_RE.test(callee) || callee === session.user.username) {
          return jsonError("Invalid callee", 400);
        }
        // Rate-limit call attempts so a single account can't spam session rows.
        const rl = await store.consumeRateLimit(`call:start:${session.user.id}`, 30, 15 * 60 * 1000);
        if (!rl.allowed) return jsonError("Too many calls. Please try again later.", 429);
        const target = await store.getUserByUsername(callee);
        if (!target) return jsonError("That user does not exist", 400);
        if (target.bannedUntil && target.bannedUntil > Date.now()) {
          return jsonError("That user is unavailable.", 403);
        }
        const callId = generateToken(12);
        await store.createCallSession(callId, session.user.username, callee);
        return jsonOk({ callId });
      }
      case "offer": {
        const callId = (typeof body.callId === "string" ? body.callId : "").slice(0, 64);
        const offer = typeof body.offer === "string" ? body.offer : "";
        if (!callId || !offer) return jsonError("Invalid call", 400);
        const call = await store.getCallSession(callId);
        if (!call || call.caller !== session.user.username) return jsonError("Invalid call", 403);
        await store.updateCallOffer(callId, offer);
        return jsonOk();
      }
      case "answer": {
        const callId = (typeof body.callId === "string" ? body.callId : "").slice(0, 64);
        const answer = typeof body.answer === "string" ? body.answer : "";
        if (!callId || !answer) return jsonError("Invalid call", 400);
        const call = await store.getCallSession(callId);
        if (!call || call.callee !== session.user.username) return jsonError("Invalid call", 403);
        await store.updateCallAnswer(callId, answer, "active");
        return jsonOk();
      }
      case "candidate": {
        const callId = (typeof body.callId === "string" ? body.callId : "").slice(0, 64);
        const candidate = typeof body.candidate === "string" ? body.candidate : "";
        if (!callId || !candidate) return jsonError("Invalid call", 400);
        const call = await store.getCallSession(callId);
        if (!call || (call.caller !== session.user.username && call.callee !== session.user.username)) {
          return jsonError("Invalid call", 403);
        }
        await store.addCallCandidate(callId, session.user.username, candidate);
        return jsonOk();
      }
      case "hangup": {
        const callId = (typeof body.callId === "string" ? body.callId : "").slice(0, 64);
        const call = callId ? await store.getCallSession(callId) : null;
        if (call && (call.caller === session.user.username || call.callee === session.user.username)) {
          await store.updateCallState(callId, "ended");
        }
        return jsonOk();
      }
      case "ringing": {
        const callId = (typeof body.callId === "string" ? body.callId : "").slice(0, 64);
        const call = callId ? await store.getCallSession(callId) : null;
        if (call && call.callee === session.user.username) {
          await store.updateCallState(callId, "ringing");
        }
        return jsonOk();
      }
      default:
        return jsonError("Unknown action", 400);
    }
  } catch (err) {
    return handleApiError(err);
  }
}

/** GET /api/calls — poll for calls I'm in, or updates for one call. */
export async function GET(req: Request) {
  try {
    const session = await resolveSession(req);
    if (!session) return jsonError("Not authenticated", 401);

    const url = new URL(req.url);
    const callId = (url.searchParams.get("callId") ?? "").trim();
    const store = await getStore();

    // Sweep old ended calls occasionally (cheap, once per poll cycle).
    await store.deleteExpiredCalls(Date.now() - 24 * 60 * 60 * 1000);

    if (callId) {
      const call = await store.getCallSession(callId);
      if (!call || (call.caller !== session.user.username && call.callee !== session.user.username)) {
        return jsonError("Call not found", 404);
      }
      const after = Number(url.searchParams.get("after") ?? 0);
      const candidates = await store.listCallCandidates(callId, Number.isFinite(after) ? after : 0);
      return jsonOk({ call, candidates });
    }

    const calls = await store.listActiveCallsFor(session.user.username);
    // Only return calls where the offer exists (otherwise the caller is still
    // creating it) — except we still surface them so callee sees "incoming".
    return jsonOk({ calls });
  } catch (err) {
    return handleApiError(err);
  }
}
