"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Message {
  id: number;
  senderUsername: string;
  content: string;
  mediaRef: string | null;
  mediaMime: string | null;
  createdAt: number;
}

const POLL_MS = 4000;

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(ms: number): string {
  const today = new Date();
  const date = new Date(ms);
  if (date.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

/** Deterministic gradient per username. */
const GRADIENTS = [
  "from-indigo-500 to-purple-500",
  "from-sky-500 to-cyan-400",
  "from-emerald-500 to-teal-400",
  "from-rose-500 to-pink-500",
  "from-amber-500 to-orange-500",
  "from-fuchsia-500 to-purple-600",
  "from-blue-500 to-indigo-400",
];

function avatarGradient(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

const isVideo = (mime: string | null) => (mime ?? "").startsWith("video/");

export default function Chat() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [connected, setConnected] = useState(true);
  const [live, setLive] = useState(false); // true when the SSE stream is up
  const [scrollLocked, setScrollLocked] = useState(true);
  const [brokenMedia, setBrokenMedia] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/session")
      .then((r) => r.json() as Promise<{ authenticated?: boolean; user?: { username: string } }>)
      .then((data) => {
        if (!alive) return;
        if (!data.authenticated || !data.user) {
          router.replace("/login");
          return;
        }
        setUsername(data.user.username);
        setChecking(false);
      })
      .catch(() => {
        if (alive) router.replace("/login");
      });
    return () => {
      alive = false;
    };
  }, [router]);

  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/messages");
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = (await res.json()) as { messages?: Message[] };
      if (data.messages) {
        setMessages((prev) =>
          JSON.stringify(prev.map((m) => m.id)) === JSON.stringify(data.messages!.map((m) => m.id))
            ? prev
            : data.messages!
        );
        setConnected(true);
      }
    } catch {
      setConnected(false);
    }
  }, [router]);

  // Live updates via SSE; falls back to 4s polling when the stream is down.
  useEffect(() => {
    if (checking) return;
    loadMessages();

    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
    const startPolling = () => {
      if (!pollTimer) pollTimer = setInterval(loadMessages, POLL_MS);
    };

    const connect = () => {
      if (stopped) return;
      try {
        es = new EventSource("/api/chat/stream");
        es.onopen = () => {
          if (stopped) return;
          setLive(true);
          setConnected(true);
          stopPolling();
        };
        es.onmessage = (ev) => {
          if (stopped) return;
          try {
            const m = JSON.parse(ev.data) as Message;
            setMessages((prev) => {
              if (prev.some((p) => p.id === m.id)) return prev;
              return [...prev, m];
            });
            setConnected(true);
          } catch {
            /* ignore malformed frames */
          }
        };
        es.onerror = () => {
          if (stopped) return;
          // Do NOT call es.close() here — that would kill the browser's
          // automatic reconnection. Instead drop into polling; when the
          // stream comes back, onopen fires again and polling stops.
          setLive(false);
          setConnected(false);
          startPolling();
        };
      } catch {
        startPolling();
      }
    };

    connect();
    return () => {
      stopped = true;
      es?.close();
      stopPolling();
    };
  }, [checking, loadMessages]);

  // Keep the view pinned to the bottom when the user hasn't scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (el && scrollLocked) el.scrollTop = el.scrollHeight;
  }, [messages, scrollLocked]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setScrollLocked(nearBottom);
  }, []);

  const sendText = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to send");
      setDraft("");
      await loadMessages();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const sendMedia = async (file: File) => {
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const up = await fetch("/api/media/upload", { method: "POST", body: form });
      const upData = (await up.json()) as { error?: string; mediaRef?: string; mime?: string };
      if (!up.ok) throw new Error(upData.error || "Upload failed");
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaRef: upData.mediaRef, mediaMime: upData.mime }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to send");
      await loadMessages();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Group consecutive messages by sender + day for a cleaner timeline.
  const grouped = useMemo(() => {
    const out: { message: Message; first: boolean; last: boolean }[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const prev = messages[i - 1];
      const next = messages[i + 1];
      const sameSender = prev && prev.senderUsername === m.senderUsername;
      const sameDay = prev && dayLabel(prev.createdAt) === dayLabel(m.createdAt);
      const close = prev && m.createdAt - prev.createdAt < 5 * 60 * 1000;
      out.push({
        message: m,
        first: !(sameSender && sameDay && close),
        last: !(next && next.senderUsername === m.senderUsername && dayLabel(next.createdAt) === dayLabel(m.createdAt) && next.createdAt - m.createdAt < 5 * 60 * 1000),
      });
    }
    return out;
  }, [messages]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white">
        <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-dvh bg-[#0a0a0a] text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-white/10 px-4 sm:px-6 py-3 flex items-center justify-between bg-[#0d0d0f]/90 backdrop-blur z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-white/20 to-white/5 border border-white/10 flex items-center justify-center text-lg font-serif italic font-bold">
            A
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">Aether Community</div>
            <div className="flex items-center gap-1.5 text-xs">
              <span
                className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"}`}
              />
              <span className={connected ? "text-emerald-400/80" : "text-red-400/80"}>
                {connected ? (live ? "Live" : "Connected") : "Reconnecting…"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden sm:inline text-sm text-gray-300 font-mono">@{username}</span>
          <Link
            href="/settings"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Settings
          </Link>
          <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
            Home
          </Link>
        </div>
      </header>

      {/* Messages */}
      <div
        ref={listRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-6"
      >
        <div className="max-w-2xl w-full mx-auto space-y-0.5">
          {messages.length === 0 && (
            <div className="text-center pt-24 animate-in fade-in duration-500">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-2xl mb-4">
                💬
              </div>
              <p className="text-gray-400 text-sm">
                No messages yet. Say hello — it&apos;s all Aether in here.
              </p>
            </div>
          )}
          {grouped.map(({ message: m, first, last }) => {
            const mine = m.senderUsername === username;
            return (
              <div
                key={m.id}
                className={`flex gap-3 items-end ${mine ? "flex-row-reverse" : ""} ${
                  first ? "mt-4" : ""
                } ${last ? "mb-4" : ""}`}
              >
                {/* Avatar */}
                <div
                  className={`shrink-0 w-8 h-8 rounded-full bg-gradient-to-br ${avatarGradient(
                    m.senderUsername
                  )} flex items-center justify-center text-xs font-bold text-white ${
                    first ? "opacity-100" : "opacity-0"
                  } transition-opacity`}
                >
                  {m.senderUsername.slice(0, 1).toUpperCase()}
                </div>

                {/* Bubble */}
                <div className={`max-w-[75%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                  {first && (
                    <div
                      className={`flex items-baseline gap-2 px-1 mb-1 text-xs ${
                        mine ? "flex-row-reverse" : ""
                      }`}
                    >
                      <span className="font-medium text-gray-300">{m.senderUsername}</span>
                      <span className="text-gray-600">{timeLabel(m.createdAt)}</span>
                    </div>
                  )}
                  <div
                    className={`px-4 py-2.5 text-sm leading-relaxed break-words shadow-sm ${
                      mine
                        ? "bg-white text-black rounded-2xl rounded-br-md"
                        : "bg-white/8 border border-white/10 text-gray-100 rounded-2xl rounded-bl-md"
                    } ${first ? "" : ""}`}
                  >
                    {m.mediaRef && brokenMedia.has(m.mediaRef) ? (
                      <div className="flex items-center gap-2 rounded-lg border border-dashed border-white/15 bg-black/20 px-3 py-2 text-xs text-gray-400 -mx-1 my-1">
                        <span>📦</span>
                        <span>Archived to the local media drive</span>
                      </div>
                    ) : m.mediaRef ? (
                      isVideo(m.mediaMime) ? (
                        <video
                          src={`/api/media/${m.mediaRef}`}
                          controls
                          preload="metadata"
                          playsInline
                          onError={() =>
                            setBrokenMedia((prev) => new Set(prev).add(m.mediaRef!))
                          }
                          className="max-w-full max-h-80 rounded-xl -mx-1 my-1"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/media/${m.mediaRef}`}
                          alt={`Media from ${m.senderUsername}`}
                          loading="lazy"
                          onError={() =>
                            setBrokenMedia((prev) => new Set(prev).add(m.mediaRef!))
                          }
                          className="max-w-full max-h-80 rounded-xl -mx-1 my-1 object-contain"
                        />
                      )
                    ) : null}
                    {m.content ? (
                      <p className={m.mediaRef ? "mt-1.5" : ""}>{m.content}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="text-red-400 text-sm text-center py-1.5 px-4 bg-red-950/40 border-t border-red-900/50">
          {error}
        </p>
      )}

      {/* Composer */}
      <div className="border-t border-white/10 p-3 sm:p-4 bg-[#0d0d0f]/90 backdrop-blur">
        <div className="max-w-2xl w-full mx-auto flex items-center gap-2.5">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif,video/mp4,video/webm,video/quicktime"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void sendMedia(file);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Send an image or video"
            className="shrink-0 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition flex items-center justify-center text-lg disabled:opacity-40 disabled:active:scale-100"
          >
            {uploading ? (
              <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
            )}
          </button>
          <div className="flex-1 relative">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendText()}
              placeholder="Message the community..."
              className="w-full px-4 py-3 pr-12 bg-white/5 border border-white/10 rounded-full text-white placeholder-gray-500 focus:outline-none focus:border-white/30 focus:bg-white/8 transition"
              maxLength={4000}
            />
            {sending && (
              <span className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
            )}
          </div>
          <button
            onClick={sendText}
            disabled={sending || !draft.trim()}
            className="shrink-0 px-5 sm:px-6 py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 active:scale-95 transition disabled:opacity-40 disabled:active:scale-100"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
