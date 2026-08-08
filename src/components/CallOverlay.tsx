"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { safeJson } from "@/lib/safeJson";
import { playRingtone, ringtoneEnabled } from "@/lib/audio";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface CallOverlayProps {
  /** My username (the local peer). */
  me: string;
  /** The remote peer's username. */
  peer: string;
  peerAvatar?: string | null;
  /** Direction: I started it (outgoing) or they did (incoming). */
  direction: "outgoing" | "incoming";
  /** Existing call id when resuming a polled call; null for a fresh outgoing call. */
  initialCallId?: string | null;
  /** Fired when the call fully ends (either side). */
  onEnded: () => void;
}

type CallState = "ringing" | "connecting" | "active" | "ended";

const STUN = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];

const POLL_MS = 1200;

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Voice call overlay — a floating "external window" with the peer's avatar,
 * live timer, mute, screen-share and end-call controls. Signaling is relayed
 * through /api/calls (D1-backed polling); media flows peer-to-peer over WebRTC.
 */
export default function CallOverlay({
  me,
  peer,
  peerAvatar,
  direction,
  initialCallId,
  onEnded,
}: CallOverlayProps) {
  const [state, setState] = useState<CallState>("ringing");
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState(false); // I am sharing my screen
  const [remoteSharing, setRemoteSharing] = useState(false); // peer is sharing
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const callIdRef = useRef<string | null>(initialCallId ?? null);
  const candidateCursorRef = useRef(0);
  const answeredRef = useRef(false); // callee answers the offer exactly once
  const endedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const videoSenderRef = useRef<RTCRtpSender | null>(null);

  const peerRef = useRef(peer);
  peerRef.current = peer;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const directionRef = useRef(direction);
  directionRef.current = direction;

  /** POST helper for signaling actions. */
  const api = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await safeJson<{ ok?: boolean; callId?: string; error?: string }>(res);
    if (!res.ok) throw new Error(data?.error ?? "Call signaling failed");
    return data;
  }, []);

  const end = useCallback((quiet = false) => {
    if (endedRef.current) return;
    endedRef.current = true;
    try {
      if (callIdRef.current) void api({ action: "hangup", callId: callIdRef.current });
    } catch {
      /* best-effort */
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    pcRef.current = null;
    setState("ended");
    if (!quiet) onEndedRef.current();
  }, [api]);

  /**
   * Boot: get mic, build the peer connection. Caller creates the offer;
   * callee waits for one from the poll loop.
   */
  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      try {
        if (endedRef.current) return;
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
          // No mic permission/device — allow viewing a screen-share-only call.
          stream = new MediaStream();
        }
        if (cancelled || endedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;

        // Pull ICE servers (STUN + short-lived TURN credentials) from the
        // server so calls work behind strict NATs. STUN-only on failure.
        let iceServers: RTCIceServer[] = STUN;
        try {
          const res = await fetch("/api/calls/ice");
          const data = await safeJson<{ iceServers?: RTCIceServer[] }>(res);
          if (res.ok && data?.iceServers?.length) iceServers = data.iceServers;
        } catch {
          /* keep STUN defaults */
        }
        if (cancelled || endedRef.current) return;

        const pc = new RTCPeerConnection({ iceServers });
        pcRef.current = pc;
        stream.getAudioTracks().forEach((t) => pc.addTrack(t, stream));

        pc.onicecandidate = (e) => {
          if (e.candidate && callIdRef.current && !endedRef.current) {
            void api({ action: "candidate", callId: callIdRef.current, candidate: JSON.stringify(e.candidate) }).catch(() => {});
          }
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") {
            setState((s) => (s === "ended" ? s : "active"));
            setStartedAt((v) => v ?? Date.now());
          } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
            setError("Connection lost");
          }
        };
        pc.ontrack = (e) => {
          if (e.track.kind === "audio") {
            if (!audioRef.current) {
              audioRef.current = new Audio();
              audioRef.current.autoplay = true;
            }
            audioRef.current.srcObject = e.streams[0] ?? new MediaStream([e.track]);
            void audioRef.current.play().catch(() => {});
          } else if (e.track.kind === "video") {
            remoteVideoTrackRef.current = e.track;
            if (videoRef.current) {
              videoRef.current.srcObject = e.streams[0] ?? new MediaStream([e.track]);
            }
            setRemoteSharing(true);
            e.track.onended = () => {
              if (videoRef.current) videoRef.current.srcObject = null;
              remoteVideoTrackRef.current = null;
              setRemoteSharing(false);
            };
          }
        };

        if (directionRef.current === "outgoing") {
          if (!callIdRef.current) {
            const res = await api({ action: "start", callee: peerRef.current });
            callIdRef.current = res.callId ?? null;
          }
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          if (callIdRef.current) {
            await api({ action: "offer", callId: callIdRef.current, offer: JSON.stringify(offer) });
          }
          setState("connecting");
        } else {
          setState("ringing");
        }
      } catch {
        if (!cancelled && !endedRef.current) {
          setError("Could not start the call");
          end(true);
          onEndedRef.current();
        }
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [api, end]);

  /** Play the custom Aether ringtone while the call is still ringing. */
  useEffect(() => {
    if (state !== "ringing") return;
    if (!ringtoneEnabled()) return;
    const stop = playRingtone();
    return () => stop();
  }, [state]);

  /**
   * Poll loop: caller waits for the answer; both sides exchange ICE
   * candidates. Stops once the call is active for a while or ended.
   */
  useEffect(() => {
    if (state === "ended") return;
    let alive = true;

    const poll = async () => {
      if (!callIdRef.current || endedRef.current) return;
      try {
        const res = await fetch(`/api/calls?callId=${encodeURIComponent(callIdRef.current)}&after=${candidateCursorRef.current}`);
        const data = await safeJson<{ call?: any; candidates?: { id: number; fromUser: string; candidate: string }[]; error?: string }>(res);
        if (!res.ok || !data?.call) return;
        const call = data.call;
        const pc = pcRef.current;
        if (!pc) return;

        // The remote answered — consume their SDP.
        if (call.answer && pc.signalingState === "have-local-offer") {
          try {
            await pc.setRemoteDescription(JSON.parse(call.answer));
            setState((s) => (s === "ended" ? s : "connecting"));
          } catch {
            /* ignore */
          }
        }
        // The callee received the offer — answer it exactly once.
        if (
          directionRef.current === "incoming" &&
          call.offer &&
          !answeredRef.current &&
          pc.signalingState === "stable"
        ) {
          answeredRef.current = true;
          try {
            await pc.setRemoteDescription(JSON.parse(call.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await api({ action: "answer", callId: call.id, answer: JSON.stringify(answer) });
            setState((s) => (s === "ended" ? s : "connecting"));
          } catch {
            /* ignore */
          }
        }
        // Ingest new ICE candidates from the other side.
        for (const c of data.candidates ?? []) {
          if (c.fromUser === me) continue;
          if (c.id <= candidateCursorRef.current) continue;
          candidateCursorRef.current = c.id;
          try {
            await pc.addIceCandidate(JSON.parse(c.candidate));
          } catch {
            /* ignore */
          }
        }

        if (call.state === "ended") {
          end(true);
          onEndedRef.current();
        }
      } catch {
        /* transient — keep polling */
      }
    };

    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [state, api, me, end, onEndedRef]);

  /** Timer tick for the duration readout. */
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const toggleMute = useCallback(() => {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    setMuted(next);
  }, [muted]);

  const toggleScreenShare = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    if (sharing) {
      // Stop sharing locally only — the remote video element is the peer's
      // stream and must stay until they stop their own share.
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      videoSenderRef.current = null;
      setSharing(false);
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const [track] = display.getVideoTracks();
      if (!track) {
        display.getTracks().forEach((t) => t.stop());
        return;
      }
      screenStreamRef.current = display;
      if (videoSenderRef.current) {
        await videoSenderRef.current.replaceTrack(track);
      } else {
        videoSenderRef.current = pc.addTrack(track, display);
      }
      track.onended = () => {
        screenStreamRef.current = null;
        videoSenderRef.current = null;
        setSharing(false);
      };
      setSharing(true);
    } catch {
      /* user cancelled the picker */
    }
  }, [sharing]);

  const duration = startedAt ? now - startedAt : 0;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl glass-strong border border-white/15 overflow-hidden shadow-2xl shadow-black/60 animate-pop">
        {/* Title bar */}
        <div className="px-4 pt-3 pb-2 flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
          <span className="ml-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            {direction === "outgoing" ? "Outgoing call" : "Incoming call"}
          </span>
        </div>

        {/* Remote video (screen share) */}
        <div className="px-4">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={false}
            className={`w-full aspect-video rounded-xl bg-black border border-white/10 object-contain transition ${
              remoteSharing ? "block" : "hidden"
            }`}
          />
        </div>

        {/* Avatar + state */}
        <div className="flex flex-col items-center py-6 px-4">
          <div className="relative">
            <div
              className={`w-24 h-24 rounded-full bg-gradient-to-br from-zinc-600 to-zinc-900 border border-white/20 flex items-center justify-center text-4xl font-bold text-white ${
                state === "ringing" ? "animate-pulse-ring" : ""
              }`}
            >
              {peerAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/media/${peerAvatar}`} alt={peer} className="w-full h-full rounded-full object-cover" />
              ) : (
                peer.slice(0, 1).toUpperCase()
              )}
            </div>
          </div>
          <div className="mt-3 text-lg font-semibold text-white">@{peer}</div>
          <div className="text-xs text-gray-400 font-mono mt-1">
            {state === "ringing"
              ? direction === "outgoing"
                ? "Ringing…"
                : "Incoming call…"
              : state === "connecting"
                ? "Connecting…"
                : state === "active"
                  ? formatDuration(duration)
                  : "Call ended"}
          </div>
          {error && <div className="mt-2 text-[11px] text-red-300 text-center max-w-[240px]">{error}</div>}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4 pb-5 px-4">
          <button
            onClick={() => void toggleMute()}
            disabled={state === "ended"}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition active:scale-95 ${
              muted
                ? "bg-white text-black"
                : "bg-white/10 hover:bg-white/20 text-white"
            }`}
            title={muted ? "Unmute" : "Mute"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {muted ? (
                <>
                  <line x1="2" x2="22" y1="2" y2="22" />
                  <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
                  <path d="M5 10v2a7 7 0 0 0 12 5" />
                  <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </>
              ) : (
                <>
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </>
              )}
            </svg>
          </button>

          <button
            onClick={() => void toggleScreenShare()}
            disabled={state !== "active"}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition active:scale-95 disabled:opacity-40 ${
              sharing
                ? "bg-white text-black"
                : "bg-white/10 hover:bg-white/20 text-white"
            }`}
            title={sharing ? "Stop sharing" : "Share screen"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" x2="16" y1="21" y2="21" />
              <line x1="12" x2="12" y1="17" y2="21" />
            </svg>
          </button>

          <button
            onClick={() => end()}
            className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center transition active:scale-95 shadow-lg shadow-red-900/40"
            title="End call"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
        </div>

        {state === "ended" && (
          <div className="px-4 pb-5">
            <button
              onClick={onEnded}
              className="w-full py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-medium text-white transition"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
