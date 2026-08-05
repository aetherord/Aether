"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import VideoPlayer from "@/components/VideoPlayer";
import ImageViewer from "@/components/ImageViewer";
import EmojiPicker from "@/components/EmojiPicker";
import {
  ArchiveIcon,
  ChatIcon,
  CheckIcon,
  DotsIcon,
  FlagIcon,
  HomeIcon,
  PaperclipIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "@/components/icons";
import {
  ensureKeyPair,
  encryptForPeer,
  decryptFromPeer,
  E2E_PREFIX,
  type E2EKeyPair,
} from "@/lib/e2e";
import { containsExtremeSlur, SLUR_BLOCK_MESSAGE } from "@/lib/contentFilter";
import { safeJson } from "@/lib/safeJson";

interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

interface Message {
  id: number;
  senderId: number;
  senderUsername: string;
  recipientUsername: string | null;
  content: string;
  mediaRef: string | null;
  mediaMime: string | null;
  replyToId: number | null;
  replyTo?: { id: number; senderUsername: string; content: string; mediaRef: string | null; mediaMime: string | null } | null;
  reactions?: Reaction[];
  editedAt: number | null;
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

interface FriendItem {
  id: number;
  username: string;
  avatar: string | null;
  status?: string;
}

interface SessionUser {
  id: number;
  email: string;
  username: string;
  role?: string;
  avatar?: string | null;
  status?: string;
}

type Room = { kind: "dm"; peer: string } | null;

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

/** Presence statuses — the user picks one; friends see it as a colored dot. */
const STATUS_META: Record<string, { label: string; dot: string }> = {
  online: { label: "Online", dot: "bg-emerald-400" },
  idle: { label: "Idle", dot: "bg-amber-400" },
  away: { label: "Away", dot: "bg-orange-400" },
  busy: { label: "Busy", dot: "bg-rose-500" },
  dnd: { label: "Do not disturb", dot: "bg-red-500" },
  offline: { label: "Offline", dot: "bg-gray-500" },
};
const STATUS_OPTIONS = Object.keys(STATUS_META);

let audioCtx: AudioContext | null = null;

/** Creates/resumes the audio context. Called on user gestures so it's ready. */
function primeAudio() {
  try {
    if (typeof AudioContext === "undefined") return;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    /* audio unavailable */
  }
}

/**
 * A soft, synthesized three-note chime (Web Audio — no audio file needed).
 * Sine arpeggio kept quiet so it never startles or disturbs the room.
 */
function playChime() {
  try {
    if (typeof AudioContext === "undefined") return;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const ctx = audioCtx;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.1, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1);
    });
  } catch {
    /* audio unavailable */
  }
}

const isVideo = (mime: string | null) => (mime ?? "").startsWith("video/");
const isImage = (mime: string | null) => (mime ?? "").startsWith("image/");

/** Inline SVG user avatar: real PFP when available, otherwise a gradient letter. */
function Avatar({ name, avatar, size = 32, className = "" }: { name: string; avatar?: string | null; size?: number; className?: string }) {
  const cls = `shrink-0 rounded-full overflow-hidden flex items-center justify-center font-bold text-white ${className}`;
  const style = { width: size, height: size, fontSize: size * 0.42 };
  if (avatar) {
    return (
      <div className={cls} style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/media/${avatar}`} alt={name} className="w-full h-full object-cover" />
      </div>
    );
  }
  return (
    <div className={`${cls} bg-gradient-to-br ${avatarGradient(name)}`} style={style}>
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

// Kept modest so uploads and downloads stay fast: 1280px @ 72% WebP is
// typically ~2-3x smaller than the original phone photo.
const MAX_DIM = 1280;
const WEBP_QUALITY = 0.72;

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") {
    return file;
  }
  try {
    let bitmap: ImageBitmap;
    try {
      // "from-image" applies EXIF orientation so phone photos aren't sideways.
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      bitmap = await createImageBitmap(file);
    }
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 300_000) {
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
  const [room, setRoom] = useState<Room>(null);
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
  const [actionFor, setActionFor] = useState<number | null>(null);
  const [reportFor, setReportFor] = useState<Message | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [lightbox, setLightbox] = useState<{ srcs: string[]; index: number } | null>(null);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [incoming, setIncoming] = useState<FriendItem[]>([]);
  const [outgoing, setOutgoing] = useState<FriendItem[]>([]);
  const [friendModal, setFriendModal] = useState(false);
  const [friendName, setFriendName] = useState("");
  const [friendBusy, setFriendBusy] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);

  // Replies / edits / reactions
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [historyFor, setHistoryFor] = useState<Message | null>(null);
  const [historyItems, setHistoryItems] = useState<{ content: string; editedAt: number }[]>([]);

  // Pending file previews before sending
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  // E2E
  const [e2eKeys, setE2eKeys] = useState<E2EKeyPair | null>(null);
  const [peerPub, setPeerPub] = useState<string | null>(null);
  const [peerProfile, setPeerProfile] = useState<{ username: string; avatar: string | null; timezone: string | null; status: string; createdAt: number } | null>(null);
  const [decryptedMap, setDecryptedMap] = useState<Record<number, string>>({});
  const [clock, setClock] = useState<Date>(new Date());

  const listRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const loadingOlder = useRef<{ room: string; active: boolean }>({ room: "", active: false });
  const e2eReady = useRef(false);
  // Messages older than this were already on screen when the room opened —
  // never notify for them (kills the reconnect/replay notification flood).
  const roomOpenedAtRef = useRef(0);

  /* ── session + keypair ─────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/session")
      .then(async (r) => ({
        status: r.status,
        data: await safeJson<{ authenticated?: boolean; user?: SessionUser }>(r),
      }))
      .then(async ({ status, data }) => {
        if (!alive) return;
        if (status === 429) return; // rate-limited — stay put, don't log out
        if (!data.authenticated || !data.user) {
          router.replace("/login");
          return;
        }
        setUser(data.user);
        setChecking(false);
        void loadFriends();
        // E2E: make sure a keypair exists and is registered once.
        if (!e2eReady.current) {
          e2eReady.current = true;
          try {
            const kp = await ensureKeyPair();
            setE2eKeys(kp);
            void fetch("/api/keys/pubkey", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                pubkey: kp.pub,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
              }),
            });
          } catch {
            /* E2E unavailable (old browser) — messages fall back to server-encrypted */
          }
        }
      })
      .catch(() => {
        if (alive) router.replace("/login");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const loadFriends = useCallback(async () => {
    try {
      const res = await fetch("/api/friends");
      if (!res.ok) return;
      const data = await safeJson<{
        friends?: FriendItem[];
        incoming?: FriendItem[];
        outgoing?: FriendItem[];
      }>(res);
      setFriends(data.friends ?? []);
      setIncoming(data.incoming ?? []);
      setOutgoing(data.outgoing ?? []);
    } catch {
      /* sidebar stays empty when the call fails */
    }
  }, []);

  const changeStatus = async (status: string) => {
    setStatusOpen(false);
    setUser((u) => (u ? { ...u, status } : u));
    try {
      const res = await fetch("/api/users/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) setError("Could not update your status.");
    } catch {
      /* keep the optimistic local status */
    }
  };

  useEffect(() => {
    if (checking) return;
    let alive = true;
    fetch("/api/chat/conversations")
      .then((r) => (r.ok ? safeJson<{ conversations?: Conversation[] }>(r) : Promise.resolve(null)))
      .then((data: { conversations?: Conversation[] } | null) => {
        if (alive && data?.conversations) setConversations(data.conversations);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [checking, room, messages.length]);

  /* ── peer profile + E2E pubkey when a DM opens ─────────────────────── */
  useEffect(() => {
    if (!room) {
      setPeerProfile(null);
      setPeerPub(null);
      return;
    }
    let alive = true;
    setPeerProfile(null);
    setPeerPub(null);
    fetch(`/api/users/profile?username=${encodeURIComponent(room.peer)}`)
      .then((r) => (r.ok ? safeJson<{ profile?: { username: string; avatar: string | null; timezone: string | null; status: string; createdAt: number } }>(r) : Promise.resolve(null)))
      .then((d) => {
        if (alive && d?.profile) setPeerProfile(d.profile);
      })
      .catch(() => {});
    fetch(`/api/keys/pubkey?username=${encodeURIComponent(room.peer)}`)
      .then((r) => (r.ok ? safeJson<{ pubkey?: string | null }>(r) : Promise.resolve(null)))
      .then((d) => {
        if (alive) setPeerPub(d?.pubkey ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [room]);

  /* ── decrypt E2E content once keys are known ───────────────────────── */
  useEffect(() => {
    if (!room || !e2eKeys || !peerPub) return;
    let alive = true;
    (async () => {
      const map: Record<number, string> = {};
      for (const m of messages) {
        if (m.content.startsWith(E2E_PREFIX)) {
          const plain = await decryptFromPeer(e2eKeys, peerPub, m.content);
          if (alive && plain != null) map[m.id] = plain;
        }
      }
      if (alive) setDecryptedMap((prev) => ({ ...prev, ...map }));
    })();
    return () => {
      alive = false;
    };
  }, [room, e2eKeys, peerPub, messages]);

  /* ── live clock for the peer's timezone ────────────────────────────── */
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Close the status dropdown when clicking anywhere outside it.
  useEffect(() => {
    if (!statusOpen) return;
    const onDown = (e: PointerEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setStatusOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [statusOpen]);

  /* ── audio warm-up + friend-status refresh ─────────────────────────── */
  useEffect(() => {
    const warm = () => primeAudio();
    window.addEventListener("pointerdown", warm, { once: true });
    window.addEventListener("keydown", warm, { once: true });
    return () => {
      window.removeEventListener("pointerdown", warm);
      window.removeEventListener("keydown", warm);
    };
  }, []);

  useEffect(() => {
    if (checking) return;
    // Keep friends' presence dots reasonably fresh without a WebSocket.
    const t = setInterval(() => void loadFriends(), 60_000);
    return () => clearInterval(t);
  }, [checking, loadFriends]);

  const loadMessages = useCallback(
    async (before: number | null = null, append = false) => {
      try {
        const params = new URLSearchParams();
        if (room) {
          params.set("room", "dm");
          params.set("peer", room.peer);
        }
        if (before) params.set("before", String(before));
        const res = await fetch(`/api/chat/messages?${params.toString()}`);
        if (res.status === 429) {
          // Rate-limited — not an auth failure. Stay put and let the next poll
          // succeed once the window slides.
          setConnected(false);
          return;
        }
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        const data = await safeJson<{ messages?: Message[]; hasMore?: boolean }>(res);
        if (data.messages) {
          setMessages((prev) => (append ? [...data.messages!, ...prev] : data.messages!));
          setHasMore(Boolean(data.hasMore));
        }
        setConnected(true);
      } catch {
        setConnected(false);
      }
    },
    [room, router]
  );

  /* ── live stream + notifications ───────────────────────────────────── */
  useEffect(() => {
    if (checking) return;
    if (!room) {
      setMessages([]);
      setHasMore(false);
      setConnected(false);
      return;
    }
    setMessages([]);
    setHasMore(false);
    setBrokenMedia(new Set());
    setDecryptedMap({});
    // Anything older than this was here before we opened the room.
    roomOpenedAtRef.current = Date.now();
    loadMessages();

    let es: EventSource | null = null;
    let esFailures = 0;
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

    const maybeNotify = (m: Message) => {
      try {
        if (m.senderUsername === user?.username) return;
        // Skip old/replayed messages (initial catch-up, reconnect replays) so
        // opening a room or a flaky connection never floods notifications.
        if (m.createdAt < roomOpenedAtRef.current) return;
        const perm =
          typeof Notification === "undefined" ? "unsupported" : Notification.permission;
        const inBackground = typeof document !== "undefined" && document.hidden;
        // Respect an explicit "denied" — no sound, no popup.
        if (inBackground && perm !== "denied") playChime();
        if (perm === "unsupported") return;
        if (perm === "granted" && inBackground) {
          new Notification("Aether", {
            body: `${m.senderUsername}: ${m.content.startsWith(E2E_PREFIX) ? "🔒 (encrypted)" : m.content || (m.mediaRef ? "📎 Media" : "")}`,
            tag: `aether-${room?.peer}`,
          });
        } else if (perm === "default" && !localStorage.getItem("aether_notif_asked")) {
          localStorage.setItem("aether_notif_asked", "1");
          void Notification.requestPermission();
        }
      } catch {
        /* notifications unavailable */
      }
    };

    const connect = () => {
      if (stopped) return;
      try {
        const params = new URLSearchParams();
        if (room) {
          params.set("room", "dm");
          params.set("peer", room.peer);
        }
        es = new EventSource(`/api/chat/stream?${params.toString()}`);
        es.onopen = () => {
          if (stopped) return;
          esFailures = 0;
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
            maybeNotify(m);
            setConnected(true);
            // Reactions on streamed messages aren't in the frame — fetch them.
            void fetch(`/api/chat/reactions?ids=${m.id}`)
              .then((r) => (r.ok ? safeJson<{ reactions?: Reaction[] }>(r) : Promise.resolve(null)))
              .then((d) => {
                if (!d?.reactions?.length) return;
                setMessages((prev) =>
                  prev.map((p) => (p.id === m.id ? { ...p, reactions: d.reactions } : p))
                );
              })
              .catch(() => {});
          } catch {
            /* ignore malformed frames */
          }
        };
        es.onerror = () => {
          if (stopped) return;
          setLive(false);
          setConnected(false);
          startPolling();
          // Give up on EventSource after repeated failures (edge 429s, proxies
          // that kill long streams) so its auto-reconnect can't turn into a
          // request storm — polling keeps us live until the room changes.
          esFailures += 1;
          if (esFailures >= 4) {
            es?.close();
            // Polling keeps messages flowing meanwhile; once the burst window
            // has slid, try re-establishing the live stream.
            setTimeout(() => {
              if (!stopped) connect();
            }, 60_000);
          }
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
  }, [checking, room, loadMessages, user?.username]);

  // Keep the view pinned to the bottom.
  useEffect(() => {
    const el = listRef.current;
    if (el && scrollLocked) el.scrollTop = el.scrollHeight;
  }, [messages, scrollLocked]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setScrollLocked(nearBottom);
    const roomKey = room ? `dm:${room.peer}` : "none";
    if (el.scrollTop < 80 && hasMore && !loadingOlder.current.active && messages.length > 0) {
      loadingOlder.current = { room: roomKey, active: true };
      const firstId = messages[0].id;
      const prevHeight = el.scrollHeight;
      const scrollTopAtStart = el.scrollTop;
      loadMessages(firstId, true).finally(() => {
        requestAnimationFrame(() => {
          if (listRef.current && loadingOlder.current.room === roomKey) {
            listRef.current.scrollTop = listRef.current.scrollHeight - prevHeight + scrollTopAtStart;
          }
          loadingOlder.current = { room: "", active: false };
        });
      });
    }
  }, [hasMore, messages, loadMessages, room]);

  /* ── send (text, with E2E) ─────────────────────────────────────────── */
  const sendText = async () => {
    const plain = draft.trim();
    if (!plain || sending) return;
    // Check before encrypting — the server can't read E2E messages.
    if (containsExtremeSlur(plain)) {
      setError(SLUR_BLOCK_MESSAGE);
      return;
    }
    setSending(true);
    setError(null);
    try {
      let content = plain;
      if (room && e2eKeys && peerPub) {
        content = await encryptForPeer(e2eKeys, peerPub, plain);
      }
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          recipient: room ? room.peer : undefined,
          replyToId: replyTo?.id,
        }),
      });
      const data = await safeJson<{ error?: string; message?: Message }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to send");
      if (data.message && content.startsWith(E2E_PREFIX)) {
        setDecryptedMap((prev) => ({ ...prev, [data.message!.id]: plain }));
      }
      setDraft("");
      setReplyTo(null);
      // Append the server-confirmed message directly — no refetch round-trip.
      if (data.message) {
        setMessages((prev) =>
          prev.some((p) => p.id === data.message!.id) ? prev : [...prev, data.message!]
        );
      } else {
        await loadMessages();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  /* ── media send (with previews) ────────────────────────────────────── */
  const uploadOne = async (raw: File) => {
    setUploading(true);
    setError(null);
    try {
      const file = await compressImage(raw);
      const form = new FormData();
      form.append("file", file);
      if (room) form.append("recipient", room.peer);
      const up = await fetch("/api/media/upload", { method: "POST", body: form });
      const upData = await safeJson<{ error?: string; mediaRef?: string; mime?: string }>(up);
      if (!up.ok) throw new Error(upData.error || "Upload failed");
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaRef: upData.mediaRef,
          mediaMime: upData.mime,
          recipient: room ? room.peer : undefined,
          replyToId: replyTo?.id,
        }),
      });
      const data = await safeJson<{ error?: string; message?: Message }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to send");
      if (data.message) {
        setMessages((prev) =>
          prev.some((p) => p.id === data.message!.id) ? prev : [...prev, data.message!]
        );
      } else {
        await loadMessages();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
      throw err;
    } finally {
      setUploading(false);
    }
  };

  const sendMedia = async (raw: File) => {
    if (!raw || uploading) return;
    await uploadOne(raw);
  };

  const sendPendingFiles = async () => {
    if (pendingFiles.length === 0 || uploading) return;
    setSending(true);
    try {
      // Fire all uploads in parallel — they're independent messages.
      await Promise.allSettled(pendingFiles.map((f) => uploadOne(f)));
      setPendingFiles([]);
      setReplyTo(null);
    } finally {
      setSending(false);
    }
  };

  // Object URLs for pending previews, revoked on change.
  useEffect(() => {
    const urls = pendingFiles.map((f) => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [pendingFiles]);

  const pickFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files).filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );
    if (list.length === 0) return;
    setPendingFiles((prev) => [...prev, ...list.slice(0, 5 - prev.length)]);
  };

  /* ── local search over decrypted content ───────────────────────────── */
  const runSearch = (q: string) => {
    const query = q.trim().toLowerCase();
    if (!query) {
      setSearchResults(null);
      return;
    }
    if (!room) {
      setSearchResults([]);
      return;
    }
    const results = messages.filter((m) => {
      const text = decryptedMap[m.id] ?? m.content;
      return text.toLowerCase().includes(query);
    });
    setSearchResults(results);
  };

  /* ── actions: reply / edit / react / report / block ────────────────── */
  const reportMessage = async () => {
    if (!reportFor || !reportReason.trim()) return;
    setError(null);
    try {
      const res = await fetch("/api/moderation/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: reportFor.id, reason: reportReason.trim() }),
      });
      const data = await safeJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to report");
      setReportFor(null);
      setReportReason("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to report");
    }
  };

  const toggleReaction = async (message: Message, emoji: string) => {
    setPickerFor(null);
    try {
      const res = await fetch("/api/chat/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id, emoji }),
      });
      const data = await safeJson<{ added?: boolean; error?: string }>(res);
      if (!res.ok) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== message.id) return m;
          const existing = m.reactions ?? [];
          const hit = existing.find((r) => r.emoji === emoji);
          const mine = data.added === true;
          if (!hit) {
            return { ...m, reactions: [...existing, { emoji, count: 1, mine }] };
          }
          if (mine) {
            return {
              ...m,
              reactions: existing.map((r) =>
                r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r
              ),
            };
          }
          return {
            ...m,
            reactions: existing
              .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r))
              .filter((r) => r.count > 0),
          };
        })
      );
    } catch {
      /* ignore */
    }
  };

  const saveEdit = async () => {
    if (!editing || !editDraft.trim()) return;
    if (containsExtremeSlur(editDraft)) {
      setError(SLUR_BLOCK_MESSAGE);
      return;
    }
    setSending(true);
    setError(null);
    try {
      let content = editDraft.trim();
      if (room && e2eKeys && peerPub) {
        content = await encryptForPeer(e2eKeys, peerPub, content);
      }
      const res = await fetch("/api/chat/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: editing.id, content }),
      });
      const data = await safeJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to edit");
      setDecryptedMap((prev) => ({ ...prev, [editing.id]: editDraft.trim() }));
      setEditing(null);
      setEditDraft("");
      await loadMessages();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to edit");
    } finally {
      setSending(false);
    }
  };

  const openHistory = async (message: Message) => {
    setHistoryFor(message);
    setHistoryItems([]);
    try {
      const res = await fetch(`/api/chat/edit?messageId=${message.id}`);
      const data = await safeJson<{ edits?: { content: string; editedAt: number }[]; error?: string }>(res);
      if (res.ok) setHistoryItems(data.edits ?? []);
    } catch {
      /* ignore */
    }
  };

  const sendGif = async (url: string) => {
    setPickerFor(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Could not load GIF");
      const blob = await res.blob();
      const file = new File([blob], "gif.gif", { type: "image/gif" });
      await uploadOne(file);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load GIF");
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
      const data = await safeJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to block");
      setActionFor(null);
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
      const data = await safeJson<{ error?: string }>(res);
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

  const cancelRequest = async (username: string) => {
    try {
      await fetch(`/api/friends?username=${encodeURIComponent(username)}`, { method: "DELETE" });
      await loadFriends();
    } catch {
      /* ignore */
    }
  };

  const removeFriend = async (username: string) => {
    try {
      await fetch(`/api/friends?username=${encodeURIComponent(username)}`, { method: "DELETE" });
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
      const data = await safeJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      setActionFor(null);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  /* ── derived ───────────────────────────────────────────────────────── */
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

  const roomTitle = room ? room.peer : "Messages";
  const e2eActive = Boolean(room && e2eKeys && peerPub);
  const mediaSrcs = useMemo(() => messages.filter((m) => m.mediaRef && isImage(m.mediaMime)).map((m) => `/api/media/${m.mediaRef}`), [messages]);

  const peerTime = useMemo(() => {
    if (!peerProfile?.timezone) return null;
    try {
      return new Intl.DateTimeFormat([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: peerProfile.timezone,
      }).format(clock);
    } catch {
      return null;
    }
  }, [peerProfile, clock]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white">
        <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-dvh bg-[#0a0a0a] text-white flex overflow-hidden">
      {/* ══ Sidebar ══ */}
      <aside className="w-64 shrink-0 border-r border-white/10 flex flex-col bg-[#0c0c0e]">
        <div className="p-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600 flex items-center justify-center text-base font-serif italic font-bold shadow-lg shadow-indigo-950/50">
              A
            </div>
            <span className="text-sm font-semibold">Aether</span>
          </div>
          <Link href="/" className="text-gray-500 hover:text-white transition-colors p-1 rounded" title="Home">
            <HomeIcon size={16} />
          </Link>
        </div>

        <button
          onClick={() => {
            setSearchOpen((v) => !v);
            setSearchResults(null);
          }}
          className={`mx-2 mt-1 px-3 py-2 rounded-xl text-left text-sm flex items-center gap-2.5 transition ${
            searchOpen ? "bg-white/10 text-white" : "text-gray-400 hover:bg-white/5 hover:text-white"
          }`}
        >
          <SearchIcon size={15} />
          <span className="font-medium">Search</span>
        </button>

        {searchOpen && (
          <div className="mx-2 mt-2 px-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                runSearch(e.target.value);
              }}
              placeholder="Search this conversation…"
              autoFocus
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition"
            />
          </div>
        )}

        <div className="mt-4 px-4 pb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">Friends</span>
          <button onClick={() => setFriendModal(true)} title="Add a friend" className="text-gray-500 hover:text-white transition-colors leading-none">
            <PlusIcon size={14} />
          </button>
        </div>
        <div className="overflow-y-auto pb-1 max-h-52 shrink-0">
          {friends.length === 0 && outgoing.length === 0 && incoming.length === 0 && (
            <p className="px-4 py-1.5 text-xs text-gray-600">No friends yet — add someone to DM them.</p>
          )}

          {/* Incoming requests */}
          {incoming.map((r) => (
            <div key={r.username} className="mx-2 mb-1 flex items-center gap-2 rounded-lg bg-amber-400/5 border border-amber-400/20 px-2 py-1.5">
              <Avatar name={r.username} avatar={r.avatar} size={22} />
              <span className="text-xs font-medium text-amber-300 truncate min-w-0 flex-1">{r.username} wants to chat</span>
              <button onClick={() => void respondFriend(r.username, true)} title="Accept" className="text-emerald-400 hover:text-emerald-300 transition p-0.5">
                <CheckIcon size={13} />
              </button>
              <button onClick={() => void respondFriend(r.username, false)} title="Decline" className="text-red-400 hover:text-red-300 transition p-0.5">
                <XIcon size={13} />
              </button>
            </div>
          ))}

          {/* Friends */}
          {friends.map((f) => {
            const active = room?.kind === "dm" && room.peer === f.username;
            return (
              <button
                key={f.id}
                onClick={() => {
                  setRoom({ kind: "dm", peer: f.username });
                  setSearchOpen(false);
                  setSearchResults(null);
                  setReplyTo(null);
                  setEditing(null);
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
                <Avatar name={f.username} avatar={f.avatar} size={24} />
                <span className="text-xs font-medium truncate">{f.username}</span>
                <span
                  className={`ml-auto h-1.5 w-1.5 rounded-full ${STATUS_META[f.status ?? "offline"].dot}`}
                  title={STATUS_META[f.status ?? "offline"].label}
                />
              </button>
            );
          })}

          {/* Outgoing requests — cancellable */}
          {outgoing.map((r) => (
            <div key={r.username} className="px-4 py-1 flex items-center gap-2 text-[11px] text-gray-600">
              <Avatar name={r.username} avatar={r.avatar} size={18} />
              <span className="truncate flex-1">→ {r.username} (pending)</span>
              <button
                onClick={() => void cancelRequest(r.username)}
                title="Cancel request"
                className="text-gray-500 hover:text-red-400 transition"
              >
                <XIcon size={12} />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-600">Direct messages</div>
        <div className="flex-1 overflow-y-auto pb-2">
          {conversations.length === 0 && (
            <p className="px-4 py-2 text-xs text-gray-600">No DMs yet — add a friend and say hi.</p>
          )}
          {conversations.map((c) => {
            const active = room?.kind === "dm" && room.peer === c.peer;
            return (
              <button
                key={c.peer}
                onClick={() => {
                  setRoom({ kind: "dm", peer: c.peer });
                  setSearchOpen(false);
                  setSearchResults(null);
                  setReplyTo(null);
                  setEditing(null);
                }}
                className={`w-full px-4 py-2.5 flex items-center gap-3 text-left transition ${
                  active ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                <Avatar name={c.peer} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{c.peer}</div>
                  <div className="flex items-center gap-2 min-w-0">
                    {c.mediaRef && isImage(c.mediaMime) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/media/${c.mediaRef}`}
                        alt=""
                        loading="lazy"
                        className="h-8 w-8 rounded-lg object-cover border border-white/10 shrink-0"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    )}
                    <div className="text-[11px] text-gray-500 truncate min-w-0">
                      {c.lastSender === user?.username ? "You: " : ""}
                      {c.mediaRef ? (
                        <span className="inline-flex items-center gap-1">
                          <PaperclipIcon size={11} /> Media
                        </span>
                      ) : (
                        c.content || ""
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* User panel */}
        <div className="border-t border-white/10 p-3 flex items-center gap-2.5">
          <Avatar name={user?.username ?? "?"} avatar={user?.avatar} size={30} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium truncate">@{user?.username}</div>
            <div className="relative" ref={statusMenuRef}>
              <button
                onClick={() => setStatusOpen((v) => !v)}
                className="flex items-center gap-1.5 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                title="Change status"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[user?.status ?? "online"].dot}`} />
                <span className="truncate">{STATUS_META[user?.status ?? "online"].label}</span>
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${statusOpen ? "rotate-180" : ""}`}>
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {statusOpen && (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-44 rounded-xl border border-white/10 bg-[#16161a] shadow-2xl p-1.5">
                  {STATUS_OPTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => void changeStatus(s)}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition ${
                        user?.status === s ? "bg-white/10 text-white" : "text-gray-300 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${STATUS_META[s].dot}`} />
                      <span className="flex-1">{STATUS_META[s].label}</span>
                      {user?.status === s && <CheckIcon size={12} className="text-gray-400" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {user?.role === "admin" && (
            <span className="text-[9px] font-semibold uppercase tracking-wide text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-1.5 py-0.5">
              Admin
            </span>
          )}
          <Link href="/settings" className="text-gray-500 hover:text-white transition-colors p-1 rounded" title="Settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
        </div>
      </aside>

      {/* ══ Main column ══ */}
      <div className="flex-1 flex flex-col min-w-0">
        {!room && <div className="flex-1" aria-hidden />}
        {room && (
          <>
            {/* Header */}
            <header className="border-b border-white/10 px-4 sm:px-6 py-3 flex items-center justify-between bg-[#0d0d0f]/90 backdrop-blur z-10">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={room.peer} avatar={peerProfile?.avatar} size={36} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold leading-tight truncate">{roomTitle}</div>
                    {e2eActive && (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-full px-1.5 py-0.5" title="End-to-end encrypted">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        E2E
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"}`} />
                    <span className={connected ? "text-emerald-400/80" : "text-red-400/80"}>
                      {connected ? (live ? "Live" : "Connected") : "Reconnecting…"}
                    </span>
                    {peerTime && (
                      <span className="text-gray-500 font-mono ml-2">Their time — {peerTime}</span>
                    )}
                  </div>
                </div>
              </div>
              <span className="hidden sm:inline-flex items-center gap-1.5 text-sm text-gray-300">
                <span className={`h-2 w-2 rounded-full ${STATUS_META[peerProfile?.status ?? "offline"].dot}`} />
                {STATUS_META[peerProfile?.status ?? "offline"].label}
              </span>
            </header>

            {room && !e2eActive && e2eKeys && (
              <div className="px-4 py-1.5 text-[11px] text-amber-300/90 bg-amber-400/5 border-b border-amber-400/15 flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                </svg>
                This user hasn&apos;t enabled end-to-end encryption yet. Messages are still encrypted in storage.
              </div>
            )}

            {/* Messages */}
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
                pickFiles(e.dataTransfer.files);
              }}
            >
              <div className="max-w-2xl w-full mx-auto space-y-0.5">
                {searchOpen ? (
                  <div className="pt-4">
                    <p className="text-xs text-gray-500 mb-3">
                      {searchResults === null
                        ? `Type to search ${roomTitle}.`
                        : searchResults.length === 0
                          ? "No matches."
                          : `${searchResults.length} result(s).`}
                    </p>
                    {searchResults?.map((m) => (
                      <div key={m.id} className="py-2 border-b border-white/5 last:border-0">
                        <div className="text-xs text-gray-500 mb-1">
                          <span className="font-medium text-gray-300">{m.senderUsername}</span>
                          {" · "}
                          {dayLabel(m.createdAt)} {timeLabel(m.createdAt)}
                        </div>
                        <div className="text-sm text-gray-200">{decryptedMap[m.id] ?? (m.content || (m.mediaRef ? "📎 Media" : ""))}</div>
                      </div>
                    ))}
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
                        <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/20 border border-indigo-400/30 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(99,102,241,0.2)]">
                          <ChatIcon size={24} className="text-indigo-300" />
                        </div>
                        <p className="text-gray-400 text-sm">Say hello to {room.peer} — it&apos;s all Aether in here.</p>
                      </div>
                    )}
                    {grouped.map(({ message: m, first, last }) => {
                      const mine = m.senderUsername === user?.username;
                      const showActions = actionFor === m.id;
                      const displayContent = decryptedMap[m.id] ?? m.content;
                      const encrypted = m.content.startsWith(E2E_PREFIX);
                      const reactions = m.reactions ?? [];
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
                              <div className={`flex items-baseline gap-2 px-1 mb-1 text-xs ${mine ? "flex-row-reverse" : ""}`}>
                                <span className="font-medium text-gray-300">{m.senderUsername}</span>
                                <span className="text-gray-600">{timeLabel(m.createdAt)}</span>
                              </div>
                            )}

                            {/* Reply quote */}
                            {m.replyTo && (
                              <div
                                className={`max-w-[85%] mb-1 rounded-lg border-l-2 border-white/25 bg-white/5 px-2.5 py-1.5 text-[11px] text-gray-400 cursor-pointer hover:bg-white/10 transition ${
                                  mine ? "self-end" : "self-start"
                                }`}
                                onClick={() => {
                                  const el = document.getElementById(`msg-${m.replyTo!.id}`);
                                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                                }}
                              >
                                <span className="font-medium text-gray-300">{m.replyTo.senderUsername}</span>
                                <span className="ml-1.5 truncate block max-w-[24ch] sm:max-w-[36ch]">
                                  {m.replyTo.mediaRef ? "📎 Media" : m.replyTo.content}
                                </span>
                              </div>
                            )}

                            <div
                              id={`msg-${m.id}`}
                              className={`px-3 py-2.5 text-sm leading-relaxed break-words shadow-sm ${
                                m.mediaRef
                                  ? "bg-black border border-white/10 rounded-2xl"
                                  : mine
                                    ? "bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-600 text-white shadow-lg shadow-indigo-950/40 rounded-2xl rounded-br-md"
                                    : "bg-white/8 border border-white/10 text-gray-100 rounded-2xl rounded-bl-md"
                              }`}
                            >
                              {m.mediaRef && brokenMedia.has(m.mediaRef) ? (
                                <div className="flex items-center gap-2 rounded-lg border border-dashed border-white/15 bg-black/20 px-3 py-2 text-xs text-gray-400 -mx-1 my-1">
                                  <ArchiveIcon size={14} />
                                  <span>Archived to the local media drive</span>
                                </div>
                              ) : m.mediaRef ? (
                                isVideo(m.mediaMime) ? (
                                  <VideoPlayer
                                    src={`/api/media/${m.mediaRef}`}
                                    className="-mx-1 my-1 max-w-[26rem]"
                                    onError={() => setBrokenMedia((prev) => new Set(prev).add(m.mediaRef!))}
                                  />
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={`/api/media/${m.mediaRef}`}
                                    alt={`Media from ${m.senderUsername}`}
                                    loading="lazy"
                                    onClick={() => {
                                      const idx = mediaSrcs.indexOf(`/api/media/${m.mediaRef}`);
                                      setLightbox({ srcs: mediaSrcs, index: Math.max(0, idx) });
                                    }}
                                    onError={() => setBrokenMedia((prev) => new Set(prev).add(m.mediaRef!))}
                                    className={`max-w-full max-h-80 rounded-xl -mx-1 my-1 object-contain cursor-zoom-in`}
                                  />
                                )
                              ) : null}

                              {displayContent !== "" && displayContent != null ? (
                                <p className={m.mediaRef ? "mt-1.5 inline-flex items-center gap-1.5" : "inline-flex items-center gap-1.5"}>
                                  <span>{displayContent}</span>
                                  {encrypted && (
                                    <span title="End-to-end encrypted" className={`shrink-0 ${mine ? "text-white/80" : "text-gray-500 dark:text-gray-400"}`}>
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                      </svg>
                                    </span>
                                  )}
                                  {m.editedAt && (
                                    <button
                                      onClick={() => user?.role === "admin" && void openHistory(m)}
                                      className={`shrink-0 text-[10px] ${
                                        mine
                                          ? "text-white/70 hover:text-white"
                                          : user?.role === "admin"
                                            ? "text-gray-400 hover:text-white cursor-pointer"
                                            : "text-gray-500"
                                      }`}
                                      title={user?.role === "admin" ? "View edit history" : "Edited"}
                                    >
                                      (edited)
                                    </button>
                                  )}
                                </p>
                              ) : null}
                            </div>

                            {/* Reactions */}
                            {reactions.length > 0 && (
                              <div className={`flex flex-wrap gap-1 mt-1 ${mine ? "self-end" : "self-start"}`}>
                                {reactions.map((r) => (
                                  <button
                                    key={r.emoji}
                                    onClick={() => void toggleReaction(m, r.emoji)}
                                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                                      r.mine
                                        ? "border-indigo-300/50 bg-indigo-500/20 shadow-[0_0_10px_rgba(99,102,241,0.25)]"
                                        : "border-white/10 bg-white/5 hover:bg-white/10"
                                    }`}
                                  >
                                    <span>{r.emoji}</span>
                                    <span className="text-gray-400">{r.count}</span>
                                  </button>
                                ))}
                                <button
                                  onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
                                  className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-gray-400 hover:bg-white/10 hover:text-white transition"
                                >
                                  +
                                </button>
                              </div>
                            )}

                            {pickerFor === m.id && (
                              <div className={`relative z-20 mt-1 ${mine ? "self-end" : "self-start"}`}>
                                <EmojiPicker onPick={(e) => void toggleReaction(m, e)} onPickGif={(url) => void sendGif(url)} />
                              </div>
                            )}
                          </div>

                          {/* Hover actions */}
                          {!mine && (
                            <div
                              className={`absolute -top-3 right-0 flex gap-1 text-[11px] transition-opacity ${
                                showActions ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                              }`}
                            >
                              <button
                                onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
                                className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20 transition"
                                title="React"
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <circle cx="12" cy="12" r="10" />
                                  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                                  <line x1="9" x2="9.01" y1="9" y2="9" />
                                  <line x1="15" x2="15.01" y1="9" y2="9" />
                                </svg>
                              </button>
                              <button
                                onClick={() => {
                                  setReplyTo(m);
                                  setEditing(null);
                                }}
                                className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20 transition"
                                title="Reply"
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="9 17 4 12 9 7" />
                                  <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                                </svg>
                              </button>
                              <button
                                onClick={() => {
                                  setReportFor(m);
                                  setReportReason("");
                                }}
                                className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20 transition"
                                title="Report"
                              >
                                <FlagIcon size={13} />
                              </button>
                              <button
                                onClick={() => setActionFor(m.id)}
                                className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20 transition"
                                title="More"
                              >
                                <DotsIcon size={13} />
                              </button>
                            </div>
                          )}

                          {mine && !showActions && (
                            <div className="absolute -top-3 right-0 flex gap-1 text-[11px] opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
                                className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20 transition"
                                title="React"
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <circle cx="12" cy="12" r="10" />
                                  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                                  <line x1="9" x2="9.01" y1="9" y2="9" />
                                  <line x1="15" x2="15.01" y1="9" y2="9" />
                                </svg>
                              </button>
                              <button
                                onClick={() => {
                                  setEditing(m);
                                  setEditDraft(decryptedMap[m.id] ?? m.content);
                                  setReplyTo(null);
                                }}
                                className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20 transition"
                                title="Edit"
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                </svg>
                              </button>
                              {user?.role === "admin" && m.editedAt && (
                                <button
                                  onClick={() => void openHistory(m)}
                                  className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20 transition"
                                  title="Edit history"
                                >
                                  🕘
                                </button>
                              )}
                              <button
                                onClick={() => setActionFor(m.id)}
                                className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20 transition"
                                title="More"
                              >
                                <DotsIcon size={13} />
                              </button>
                            </div>
                          )}

                          {/* Block affordance */}
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
                          {showActions && (
                            <button
                              onClick={() => setActionFor(null)}
                              className="absolute -bottom-8 right-0 z-10 px-2 py-1 rounded-lg bg-white/10 border border-white/10 text-gray-400 hover:text-white transition text-[11px]"
                            >
                              Close
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>

            {error && (
              <p className="text-red-400 text-sm text-center py-1.5 px-4 bg-red-950/40 border-t border-red-900/50">{error}</p>
            )}

            {/* Composer */}
            <div className="border-t border-white/10 p-3 sm:p-4 bg-[#0d0d0f]/90 backdrop-blur">
              <div className="max-w-2xl w-full mx-auto">
                {/* Editing chip */}
                {editing && (
                  <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2">
                    <span className="text-xs text-amber-300 font-medium">Editing message</span>
                    <button
                      onClick={() => {
                        setEditing(null);
                        setEditDraft("");
                      }}
                      className="ml-auto text-gray-500 hover:text-white transition"
                      title="Cancel edit"
                    >
                      <XIcon size={13} />
                    </button>
                  </div>
                )}

                {/* Reply chip */}
                {replyTo && !editing && (
                  <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 shrink-0">
                      <polyline points="9 17 4 12 9 7" />
                      <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                    </svg>
                    <span className="text-xs text-gray-400 truncate min-w-0">
                      Replying to <span className="text-gray-200 font-medium">{replyTo.senderUsername}</span>:{" "}
                      {replyTo.mediaRef ? "📎 Media" : (decryptedMap[replyTo.id] ?? replyTo.content)}
                    </span>
                    <button
                      onClick={() => setReplyTo(null)}
                      className="ml-auto text-gray-500 hover:text-white transition shrink-0"
                      title="Cancel reply"
                    >
                      <XIcon size={13} />
                    </button>
                  </div>
                )}

                {/* Pending image/video previews */}
                {pendingFiles.length > 0 && (
                  <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                    {pendingFiles.map((f, i) => (
                      <div key={`${f.name}-${i}`} className="relative shrink-0">
                        {f.type.startsWith("video/") ? (
                          <div className="w-20 h-20 rounded-lg bg-black/60 border border-white/10 flex items-center justify-center text-2xl">
                            🎬
                          </div>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={previewUrls[i]} alt={f.name} className="w-20 h-20 object-cover rounded-lg border border-white/10" />
                        )}
                        <button
                          onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black border border-white/25 text-white flex items-center justify-center hover:bg-red-600 transition"
                          title="Remove"
                        >
                          <XIcon size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2.5">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/avif,video/mp4,video/webm,video/quicktime"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      pickFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    title="Send images or videos (or paste / drag & drop)"
                    className="shrink-0 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition flex items-center justify-center disabled:opacity-40 disabled:active:scale-100"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="m21 15-5-5L5 21" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setPickerFor(pickerFor === 0 ? null : 0)}
                    className="shrink-0 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition flex items-center justify-center"
                    title="Emoji & GIFs"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                      <line x1="9" x2="9.01" y1="9" y2="9" />
                      <line x1="15" x2="15.01" y1="9" y2="9" />
                    </svg>
                  </button>
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      value={editing ? editDraft : draft}
                      onChange={(e) => (editing ? setEditDraft(e.target.value) : setDraft(e.target.value))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (editing) void saveEdit();
                          else void sendText();
                        }
                      }}
                      onPaste={(e) => {
                        const file = e.clipboardData.files?.[0];
                        if (file && (file.type.startsWith("image/") || file.type.startsWith("video/"))) {
                          e.preventDefault();
                          pickFiles([file]);
                        }
                      }}
                      placeholder={editing ? "Edit message…" : `Message ${room.peer}…`}
                      className="w-full px-4 py-3 pr-12 bg-white/5 border border-white/10 rounded-full text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400/50 focus:bg-white/8 focus:shadow-[0_0_0_4px_rgba(99,102,241,0.14)] transition"
                      maxLength={4000}
                    />
                    {(sending || uploading) && (
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                    )}
                  </div>
                  <button
                    onClick={() => (editing ? void saveEdit() : pendingFiles.length > 0 ? void sendPendingFiles() : void sendText())}
                    disabled={
                      sending ||
                      uploading ||
                      (!editing && !draft.trim() && pendingFiles.length === 0) ||
                      (editing ? !editDraft.trim() : false)
                    }
                    className="shrink-0 px-5 sm:px-6 py-3 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-600 text-white font-medium shadow-lg shadow-indigo-950/50 hover:brightness-110 active:scale-95 transition disabled:opacity-40 disabled:shadow-none disabled:active:scale-100"
                  >
                    {sending || uploading ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                        {pendingFiles.length > 0 ? "Sending…" : editing ? "Saving…" : "Sending…"}
                      </span>
                    ) : (
                      editing ? "Save" : "Send"
                    )}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Emoji picker popover (composer) */}
      {room && pickerFor === 0 && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40" onClick={(e) => e.stopPropagation()}>
          <EmojiPicker
            onPick={(e) => {
              setDraft((d) => d + e);
              setPickerFor(null);
            }}
            onPickGif={(url) => void sendGif(url)}
          />
        </div>
      )}

      {/* Add friend modal */}
      {friendModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setFriendModal(false)}>
          <div className="w-full max-w-sm bg-[#141416] border border-white/10 rounded-2xl p-6 animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-1">Add a friend</h2>
            <p className="text-sm text-gray-400 mb-4">Enter their username — they&apos;ll get a request they can accept.</p>
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
              <button onClick={() => setFriendModal(false)} className="flex-1 py-2.5 rounded-full border border-white/15 text-sm text-gray-300 hover:bg-white/5 transition">
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
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setReportFor(null)}>
          <div className="w-full max-w-sm bg-[#141416] border border-white/10 rounded-2xl p-6 animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
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
              <button onClick={() => setReportFor(null)} className="flex-1 py-2.5 rounded-full border border-white/15 text-sm text-gray-300 hover:bg-white/5 transition">
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

      {/* Edit history modal (admin / sender) */}
      {historyFor && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setHistoryFor(null)}>
          <div className="w-full max-w-md bg-[#141416] border border-white/10 rounded-2xl p-6 animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Edit history</h2>
              <button onClick={() => setHistoryFor(null)} className="text-gray-500 hover:text-white transition">
                <XIcon size={16} />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              From <span className="text-gray-300 font-medium">{historyFor.senderUsername}</span>
            </p>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {historyItems.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-6">No edit history found.</p>
              )}
              {historyItems.map((h, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <div className="text-[10px] text-gray-600 mb-1">{dayLabel(h.editedAt)} {timeLabel(h.editedAt)} — previous version</div>
                  <p className="text-sm text-gray-200 break-words">{h.content.startsWith(E2E_PREFIX) ? "🔒 (encrypted)" : h.content}</p>
                </div>
              ))}
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
                <div className="text-[10px] text-gray-600 mb-1">Current version</div>
                <p className="text-sm text-gray-100 break-words">
                  {(decryptedMap[historyFor.id] ?? historyFor.content).startsWith(E2E_PREFIX) ? "🔒 (encrypted)" : (decryptedMap[historyFor.id] ?? historyFor.content)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom image viewer */}
      {lightbox && (
        <ImageViewer srcs={lightbox.srcs} index={lightbox.index} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
