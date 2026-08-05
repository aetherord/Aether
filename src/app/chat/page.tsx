"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Message {
  id: number;
  senderId: number;
  senderUsername: string;
  recipientUsername: string | null;
  content: string;
  mediaRef: string | null;
  mediaMime: string | null;
  createdAt: number;
}

interface Conversation {
  peer: string;
  messageId: number;
  content: string;
  mediaRef: string | null;
  mediaMime: string | null;
  lastAt: number;
  lastSender: string;
}

interface SessionUser {
  username: string;
  role?: "user" | "admin";
}

type Room = { kind: "community" } | { kind: "dm"; peer: string };

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
const isImage = (mime: string | null) => (mime ?? "").startsWith("image/");

/**
 * Client-side image compression before upload: downscales to at most
 * MAX_DIM px and re-encodes as WebP. Big photos (3-10 MB) typically drop to
 * a few hundred KB, keeping the Turso queue small. GIFs are left alone so
 * animation survives.
 */
const MAX_DIM = 1600;
const WEBP_QUALITY = 0.82;

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 500_000) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", WEBP_QUALITY)
    );
    if (!blob || blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${base}.webp`, { type: "image/webp" });
  } catch {
    return file;
  }
}

export default function Chat() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [room, setRoom] = useState<Room>({ kind: "community" });
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [connected, setConnected] = useState(true);
  const [live, setLive] = useState(false);
  const [scrollLocked, setScrollLocked] = useState(true);
  const [brokenMedia, setBrokenMedia] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [actionFor, setActionFor] = useState<number | null>(null);
  const [reportFor, setReportFor] = useState<Message | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [friends, setFriends] = useState<{ id: number; username: string }[]>([]);
  const [incoming, setIncoming] = useState<{ id: number; username: string; createdAt: number }[]>([]);
  const [outgoing, setOutgoing] = useState<{ id: number; username: string; createdAt: number }[]>([]);
  const [friendModal, setFriendModal] = useState(false);
  const [friendName, setFriendName] = useState("");
  const [friendBusy, setFriendBusy] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const loadingOlder = useRef<{ room: string; active: boolean }>({ room: "", active: false });

  const loadFriends = useCallback(async () => {
    try {
      const res = await fetch("/api/friends");
      if (!res.ok) return;
      const data = (await res.json()) as {
        friends?: { id: number; username: string }[];
        incoming?: { id: number; username: string; createdAt: number }[];
        outgoing?: { id: number; username: string; createdAt: number }[];
      };
      setFriends(data.friends ?? []);
      setIncoming(data.incoming ?? []);
      setOutgoing(data.outgoing ?? []);
    } catch {
      /* sidebar stays empty when the call fails */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/session")
      .then((r) => r.json() as Promise<{ authenticated?: boolean; user?: SessionUser }>)
      .then((data) => {
        if (!alive) return;
        if (!data.authenticated || !data.user) {
          router.replace("/login");
          return;
        }
        setUser(data.user);
        setChecking(false);
        void loadFriends();
      })
      .catch(() => {
        if (alive) router.replace("/login");
      });
    return () => {
      alive = false;
    };
  }, [router, loadFriends]);

  // Refresh the DM conversation list whenever the room changes or messages arrive.
  useEffect(() => {
    if (checking) return;
    let alive = true;
    fetch("/api/chat/conversations")
      .then((r) => (r.ok ? (r.json() as Promise<{ conversations?: Conversation[] }>) : Promise.resolve(null)))
      .then((data: { conversations?: Conversation[] } | null) => {
        if (alive && data?.conversations) setConversations(data.conversations);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [checking, room, messages.length]);

  const loadMessages = useCallback(
    async (before: number | null = null, append = false) => {
      try {
        const params = new URLSearchParams();
        if (room.kind === "dm") {
          params.set("room", "dm");
          params.set("peer", room.peer);
        }
        if (before) params.set("before", String(before));
        const res = await fetch(`/api/chat/messages?${params.toString()}`);
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        const data = (await res.json()) as { messages?: Message[]; hasMore?: boolean };
        if (data.messages) {
          setMessages((prev) =>
            append ? [...data.messages!, ...prev] : data.messages!
          );
          setHasMore(Boolean(data.hasMore));
        }
        setConnected(true);
      } catch {
        setConnected(false);
      }
    },
    [room, router]
  );

  // Live updates via SSE per room; falls back to polling when the stream is down.
  useEffect(() => {
    if (checking) return;
    setMessages([]);
    setHasMore(false);
    setBrokenMedia(new Set());
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
      if (!pollTimer) pollTimer = setInterval(() => loadMessages(), POLL_MS);
    };

    const connect = () => {
      if (stopped) return;
      try {
        const params = new URLSearchParams();
        if (room.kind === "dm") {
          params.set("room", "dm");
          params.set("peer", room.peer);
        }
        es = new EventSource(`/api/chat/stream?${params.toString()}`);
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
          // Don't close() — that kills the browser's auto-reconnect. Drop into
          // polling until onopen fires again.
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
  }, [checking, room, loadMessages]);

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
    // Load older messages when the user scrolls near the top.
    const roomKey = room.kind === "community" ? "community" : `dm:${room.peer}`;
    if (
      el.scrollTop < 80 &&
      hasMore &&
      !loadingOlder.current.active &&
      messages.length > 0
    ) {
      loadingOlder.current = { room: roomKey, active: true };
      const firstId = messages[0].id;
      const prevHeight = el.scrollHeight;
      const scrollTopAtStart = el.scrollTop;
      loadMessages(firstId, true).finally(() => {
        requestAnimationFrame(() => {
          // Only restore scroll if the user is still in the same room.
          if (listRef.current && loadingOlder.current.room === roomKey) {
            listRef.current.scrollTop =
              listRef.current.scrollHeight - prevHeight + scrollTopAtStart;
          }
          loadingOlder.current = { room: "", active: false };
        });
      });
    }
  }, [hasMore, messages, loadMessages, room]);

  const sendText = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          recipient: room.kind === "dm" ? room.peer : undefined,
        }),
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

  const sendMedia = async (raw: File) => {
    if (!raw || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const file = await compressImage(raw);
      const form = new FormData();
      form.append("file", file);
      if (room.kind === "dm") form.append("recipient", room.peer);
      const up = await fetch("/api/media/upload", { method: "POST", body: form });
      const upData = (await up.json()) as { error?: string; mediaRef?: string; mime?: string };
      if (!up.ok) throw new Error(upData.error || "Upload failed");
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaRef: upData.mediaRef,
          mediaMime: upData.mime,
          recipient: room.kind === "dm" ? room.peer : undefined,
        }),
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

  const runSearch = async (q: string) => {
    const query = q.trim();
    if (!query) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const params = new URLSearchParams({ q: query });
      if (room.kind === "dm") {
        params.set("room", "dm");
        params.set("peer", room.peer);
      }
      const res = await fetch(`/api/chat/search?${params.toString()}`);
      const data = (await res.json()) as { messages?: Message[] };
      setSearchResults(data.messages ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const reportMessage = async () => {
    if (!reportFor) return;
    if (!reportReason.trim()) return;
    setError(null);
    try {
      const res = await fetch("/api/moderation/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: reportFor.id, reason: reportReason.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to report");
      setReportFor(null);
      setReportReason("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to report");
    }
  };

  const blockUser = async (username: string) => {
    setError(null);
    try {
      const res = await fetch("/api/moderation/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to block");
      setActionFor(null);
      // Their messages disappear immediately.
      setMessages((prev) => prev.filter((m) => m.senderUsername !== username));
      await loadMessages();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to block");
    }
  };

  const addFriend = async () => {
    const name = friendName.trim();
    if (!name || friendBusy) return;
    setFriendBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to send request");
      setFriendName("");
      setFriendModal(false);
      await loadFriends();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send request");
    } finally {
      setFriendBusy(false);
    }
  };

  const respondFriend = async (username: string, accept: boolean) => {
    try {
      await fetch("/api/friends", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, accept }),
      });
      await loadFriends();
    } catch {
      /* ignore */
    }
  };

  const removeFriend = async (username: string) => {
    try {
      await fetch(`/api/friends?username=${encodeURIComponent(username)}`, {
        method: "DELETE",
      });
      await loadFriends();
    } catch {
      /* ignore */
    }
  };

  const adminDelete = async (messageId: number) => {
    setError(null);
    try {
      const res = await fetch("/api/moderation/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-message", messageId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      setActionFor(null);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete");
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
        last: !(
          next &&
          next.senderUsername === m.senderUsername &&
          dayLabel(next.createdAt) === dayLabel(m.createdAt) &&
          next.createdAt - m.createdAt < 5 * 60 * 1000
        ),
      });
    }
    return out;
  }, [messages]);

  const roomTitle = room.kind === "community" ? "Aether Community" : room.peer;
  const roomSubtitle =
    room.kind === "community" ? "Everyone" : "Direct message";

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white">
        <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-dvh bg-[#0a0a0a] text-white flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-white/10 flex flex-col bg-[#0c0c0e]">
        <div className="p-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-white/20 to-white/5 border border-white/10 flex items-center justify-center text-base font-serif italic font-bold">
              A
            </div>
            <span className="text-sm font-semibold">Aether</span>
          </div>
          <Link
            href="/"
            className="text-xs text-gray-500 hover:text-white transition-colors"
            title="Home"
          >
            ⌂
          </Link>
        </div>

        <button
          onClick={() => {
            setRoom({ kind: "community" });
            setSearchOpen(false);
            setSearchResults(null);
          }}
          className={`mx-2 px-3 py-2 rounded-xl text-left text-sm flex items-center gap-2.5 transition ${
            room.kind === "community" && !searchOpen
              ? "bg-white/10 text-white"
              : "text-gray-400 hover:bg-white/5 hover:text-white"
          }`}
        >
          <span className="text-base">#</span>
          <span className="font-medium">Community</span>
          {connected && <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" />}
        </button>

        <button
          onClick={() => {
            setSearchOpen((v) => !v);
            setSearchResults(null);
          }}
          className={`mx-2 mt-1 px-3 py-2 rounded-xl text-left text-sm flex items-center gap-2.5 transition ${
            searchOpen ? "bg-white/10 text-white" : "text-gray-400 hover:bg-white/5 hover:text-white"
          }`}
        >
          <span className="text-base">⌕</span>
          <span className="font-medium">Search</span>
        </button>

        {searchOpen && (
          <div className="mx-2 mt-2 px-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value.trim()) void runSearch(e.target.value);
              }}
              placeholder="Search this room…"
              autoFocus
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition"
            />
          </div>
        )}

        <div className="mt-4 px-4 pb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">
            Friends
          </span>
          <button
            onClick={() => setFriendModal(true)}
            title="Add a friend"
            className="text-gray-500 hover:text-white transition-colors text-sm leading-none"
          >
            ＋
          </button>
        </div>
        <div className="overflow-y-auto pb-1 max-h-44 shrink-0">
          {friends.length === 0 && outgoing.length === 0 && incoming.length === 0 && (
            <p className="px-4 py-1.5 text-xs text-gray-600">
              No friends yet — add someone to DM them.
            </p>
          )}
          {incoming.map((r) => (
            <div
              key={r.username}
              className="mx-2 mb-1 flex items-center gap-2 rounded-lg bg-amber-400/5 border border-amber-400/20 px-2.5 py-1.5"
            >
              <span className="text-xs font-medium text-amber-300 truncate min-w-0 flex-1">
                {r.username} wants to chat
              </span>
              <button
                onClick={() => void respondFriend(r.username, true)}
                title="Accept"
                className="text-emerald-400 hover:text-emerald-300 transition"
              >
                ✓
              </button>
              <button
                onClick={() => void respondFriend(r.username, false)}
                title="Decline"
                className="text-red-400 hover:text-red-300 transition"
              >
                ✕
              </button>
            </div>
          ))}
          {friends.map((f) => {
            const active = room.kind === "dm" && room.peer === f.username;
            return (
              <button
                key={f.id}
                onClick={() => {
                  setRoom({ kind: "dm", peer: f.username });
                  setSearchOpen(false);
                  setSearchResults(null);
                }}
                className={`w-full px-4 py-1.5 flex items-center gap-3 text-left transition ${
                  active ? "bg-white/10" : "hover:bg-white/5"
                }`}
                title={`DM ${f.username} — right-click to unfriend`}
                onContextMenu={(e) => {
                  e.preventDefault();
                  void removeFriend(f.username);
                }}
              >
                <div
                  className={`shrink-0 w-6 h-6 rounded-full bg-gradient-to-br ${avatarGradient(
                    f.username
                  )} flex items-center justify-center text-[10px] font-bold text-white`}
                >
                  {f.username.slice(0, 1).toUpperCase()}
                </div>
                <span className="text-xs font-medium truncate">{f.username}</span>
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400/60" />
              </button>
            );
          })}
          {outgoing.map((r) => (
            <p
              key={r.username}
              className="px-4 py-1 text-[11px] text-gray-600 truncate"
            >
              → {r.username} (pending)
            </p>
          ))}
        </div>

        <div className="mt-3 px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-600">
          Direct messages
        </div>
        <div className="flex-1 overflow-y-auto pb-2">
          {conversations.length === 0 && (
            <p className="px-4 py-2 text-xs text-gray-600">
              No DMs yet — click a username in chat to start one.
            </p>
          )}
          {conversations.map((c) => {
            const active = room.kind === "dm" && room.peer === c.peer;
            return (
              <button
                key={c.peer}
                onClick={() => {
                  setRoom({ kind: "dm", peer: c.peer });
                  setSearchOpen(false);
                  setSearchResults(null);
                }}
                className={`w-full px-4 py-2.5 flex items-center gap-3 text-left transition ${
                  active ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                <div
                  className={`shrink-0 w-7 h-7 rounded-full bg-gradient-to-br ${avatarGradient(
                    c.peer
                  )} flex items-center justify-center text-[10px] font-bold text-white`}
                >
                  {c.peer.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{c.peer}</div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {c.lastSender === user?.username ? "You: " : ""}
                    {c.mediaRef ? "📎 Media" : c.content || ""}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="border-t border-white/10 p-3 flex items-center justify-between">
          <span className="text-xs text-gray-400 font-mono">@{user?.username}</span>
          <div className="flex items-center gap-3">
            {user?.role === "admin" && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5">
                Admin
              </span>
            )}
            <Link href="/settings" className="text-xs text-gray-500 hover:text-white transition-colors">
              Settings
            </Link>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="border-b border-white/10 px-4 sm:px-6 py-3 flex items-center justify-between bg-[#0d0d0f]/90 backdrop-blur z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-white/20 to-white/5 border border-white/10 flex items-center justify-center text-lg font-serif italic font-bold shrink-0">
              {room.kind === "dm" ? (
                <span className={`bg-gradient-to-br ${avatarGradient(room.peer)} w-full h-full rounded-full flex items-center justify-center text-xs font-sans font-bold`}>
                  {room.peer.slice(0, 1).toUpperCase()}
                </span>
              ) : (
                "A"
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight truncate">{roomTitle}</div>
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
            <span className="hidden sm:inline text-sm text-gray-300 font-mono">
              {roomSubtitle}
            </span>
          </div>
        </header>

        {/* Messages or search results */}
        <div
          ref={listRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto px-4 sm:px-6 py-6"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file && (file.type.startsWith("image/") || file.type.startsWith("video/"))) {
              void sendMedia(file);
            }
          }}
        >
          <div className="max-w-2xl w-full mx-auto space-y-0.5">
            {searchOpen ? (
              <div className="pt-4">
                <p className="text-xs text-gray-500 mb-3">
                  {searching
                    ? "Searching…"
                    : searchResults === null
                      ? `Type to search ${roomTitle}.`
                      : searchResults.length === 0
                        ? "No matches."
                        : `${searchResults.length} result(s).`}
                </p>
                {searchResults?.map((m) => {
                  const mine = m.senderUsername === user?.username;
                  return (
                    <div key={m.id} className="py-2 border-b border-white/5 last:border-0">
                      <div className="text-xs text-gray-500 mb-1">
                        <span className="font-medium text-gray-300">{m.senderUsername}</span>
                        {" · "}
                        {dayLabel(m.createdAt)} {timeLabel(m.createdAt)}
                      </div>
                      <div className={`text-sm ${mine ? "text-emerald-300/90" : "text-gray-200"}`}>
                        {m.content || (m.mediaRef ? "📎 Media" : "")}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                {hasMore && (
                  <button
                    onClick={() => {
                      const firstId = messages[0]?.id;
                      if (firstId) loadMessages(firstId, true);
                    }}
                    className="w-full py-2 text-xs text-gray-500 hover:text-white transition-colors"
                  >
                    ↑ Load earlier messages
                  </button>
                )}
                {messages.length === 0 && (
                  <div className="text-center pt-24 animate-in fade-in duration-500">
                    <div className="w-14 h-14 mx-auto rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-2xl mb-4">
                      {room.kind === "dm" ? "💬" : "👋"}
                    </div>
                    <p className="text-gray-400 text-sm">
                      {room.kind === "dm"
                        ? `Say hello to ${room.peer} — it's all Aether in here.`
                        : "No messages yet. Say hello — it's all Aether in here."}
                    </p>
                  </div>
                )}
                {grouped.map(({ message: m, first, last }) => {
                  const mine = m.senderUsername === user?.username;
                  const showActions = actionFor === m.id;
                  return (
                    <div
                      key={m.id}
                      className={`flex gap-3 items-end relative group ${mine ? "flex-row-reverse" : ""} ${
                        first ? "mt-4" : ""
                      } ${last ? "mb-4" : ""}`}
                      onMouseLeave={() => setActionFor(null)}
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
                          className={`px-3 py-2.5 text-sm leading-relaxed break-words shadow-sm ${
                            m.mediaRef
                              ? "bg-black border border-white/10 rounded-2xl"
                              : mine
                                ? "bg-white text-black rounded-2xl rounded-br-md"
                                : "bg-white/8 border border-white/10 text-gray-100 rounded-2xl rounded-bl-md"
                          }`}
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
                                onClick={() => isImage(m.mediaMime) && setLightbox(m.mediaRef!)}
                                onError={() =>
                                  setBrokenMedia((prev) => new Set(prev).add(m.mediaRef!))
                                }
                                className={`max-w-full max-h-80 rounded-xl -mx-1 my-1 object-contain ${
                                  isImage(m.mediaMime) ? "cursor-zoom-in" : ""
                                }`}
                              />
                            )
                          ) : null}
                          {m.content ? (
                            <p className={m.mediaRef ? "mt-1.5" : ""}>{m.content}</p>
                          ) : null}
                        </div>
                      </div>

                      {/* Hover actions */}
                      {!mine && (
                        <div
                          className={`absolute -top-3 right-0 flex gap-1 text-[11px] transition-opacity ${
                            showActions ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                          }`}
                        >
                          <button
                            onClick={() =>
                              setRoom({ kind: "dm", peer: m.senderUsername })
                            }
                            className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20 transition"
                            title="Message"
                          >
                            💬
                          </button>
                          <button
                            onClick={() => {
                              setReportFor(m);
                              setReportReason("");
                            }}
                            className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20 transition"
                            title="Report"
                          >
                            ⚑
                          </button>
                          {user?.role === "admin" && (
                            <button
                              onClick={() => void adminDelete(m.id)}
                              className="px-2 py-1 rounded-lg bg-red-500/20 border border-red-500/30 hover:bg-red-500/40 transition"
                              title="Delete (admin)"
                            >
                              ✕
                            </button>
                          )}
                          {!showActions && (
                            <button
                              onClick={() => setActionFor(m.id)}
                              className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20 transition"
                              title="More"
                            >
                              ⋯
                            </button>
                          )}
                          {showActions && (
                            <button
                              onClick={() => setActionFor(null)}
                              className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20 transition"
                              title="Close"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      )}

                      {/* Block affordance (in the ⋯ menu) */}
                      {showActions && !mine && (
                        <div className="absolute -bottom-8 right-0 z-10 flex items-center gap-1 text-[11px] animate-in fade-in duration-150">
                          <button
                            onClick={() => void blockUser(m.senderUsername)}
                            className="px-2.5 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/30 hover:text-red-200 transition"
                          >
                            Block @{m.senderUsername}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
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
              title="Send an image or video (or paste / drag & drop)"
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
                onPaste={(e) => {
                  const file = e.clipboardData.files?.[0];
                  if (file && (file.type.startsWith("image/") || file.type.startsWith("video/"))) {
                    e.preventDefault();
                    void sendMedia(file);
                  }
                }}
                placeholder={`Message ${roomTitle}…`}
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

      {/* Add friend modal */}
      {friendModal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setFriendModal(false)}
        >
          <div
            className="w-full max-w-sm bg-[#141416] border border-white/10 rounded-2xl p-6 animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-1">Add a friend</h2>
            <p className="text-sm text-gray-400 mb-4">
              Enter their username — they&apos;ll get a request they can accept.
            </p>
            <input
              type="text"
              value={friendName}
              onChange={(e) => setFriendName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addFriend();
              }}
              placeholder="username"
              maxLength={20}
              autoFocus
              className="w-full px-3 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setFriendModal(false)}
                className="flex-1 py-2.5 rounded-full border border-white/15 text-sm text-gray-300 hover:bg-white/5 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => void addFriend()}
                disabled={friendBusy || !friendName.trim()}
                className="flex-1 py-2.5 rounded-full bg-white text-black text-sm font-medium hover:bg-gray-200 transition disabled:opacity-40"
              >
                {friendBusy ? "Sending…" : "Send request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report modal */}
      {reportFor && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setReportFor(null)}
        >
          <div
            className="w-full max-w-sm bg-[#141416] border border-white/10 rounded-2xl p-6 animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-1">Report message</h2>
            <p className="text-sm text-gray-400 mb-4">
              From <span className="text-white">{reportFor.senderUsername}</span>
            </p>
            <textarea
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="Why is this message inappropriate?"
              rows={3}
              autoFocus
              className="w-full px-3 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition resize-none"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setReportFor(null)}
                className="flex-1 py-2.5 rounded-full border border-white/15 text-sm text-gray-300 hover:bg-white/5 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => void reportMessage()}
                disabled={!reportReason.trim()}
                className="flex-1 py-2.5 rounded-full bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition disabled:opacity-40"
              >
                Submit report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightbox(null)}
          onKeyDown={(e) => e.key === "Escape" && setLightbox(null)}
          tabIndex={-1}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/media/${lightbox}`}
            alt="Enlarged media"
            className="max-w-full max-h-full rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  );
}
