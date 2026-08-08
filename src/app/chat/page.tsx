"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import MediaBubble from "@/components/MediaBubble";
import ImageViewer from "@/components/ImageViewer";
import EmojiPicker from "@/components/EmojiPicker";
import CallOverlay from "@/components/CallOverlay";
import Background from "@/components/Background";
import {
  ChatIcon,
  CheckIcon,
  DotsIcon,
  FlagIcon,
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
import { formatText, plainText } from "@/lib/formatText";
import { playChime, playRingtone, primeAudio, ringtoneEnabled } from "@/lib/audio";
import { setupPushSubscription } from "@/lib/pushClient";

/** A user is "really online" when their last heartbeat is < 2 minutes old. */
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

interface Message {
  id: number;
  senderId: number;
  senderUsername: string;
  senderAvatar?: string | null;
  senderDisplayName?: string | null;
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
  avatar?: string | null;
  displayName?: string | null;
  myLastReadId?: number | null;
  unread?: number;
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
  displayName?: string | null;
  role?: string;
  avatar?: string | null;
  status?: string;
}

/** Shows the display name when set, otherwise @username. */
function displayLabel(username: string, displayName?: string | null): string {
  const d = displayName?.trim();
  return d ? d : `@${username}`;
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

function lastSeenText(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// Monochrome avatar gradients — dark slate through black so the white
// letter keeps contrast. Black & white only.
const GRADIENTS = [
  "from-zinc-600 to-zinc-900",
  "from-neutral-500 to-zinc-800",
  "from-gray-700 to-black",
  "from-zinc-500 to-zinc-900",
  "from-gray-600 to-zinc-950",
  "from-neutral-600 to-zinc-900",
  "from-gray-500 to-neutral-900",
];

function avatarGradient(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

/** Presence statuses — the user picks one; friends see it as a shaded dot.
 *  Monochrome: brightness encodes the state, the label spells it out. */
const STATUS_META: Record<string, { label: string; dot: string }> = {
  online: { label: "Online", dot: "bg-white" },
  idle: { label: "Idle", dot: "bg-gray-300" },
  away: { label: "Away", dot: "bg-gray-400" },
  busy: { label: "Busy", dot: "bg-gray-500" },
  dnd: { label: "Do not disturb", dot: "bg-gray-600" },
  offline: { label: "Offline", dot: "bg-gray-700" },
};
const STATUS_OPTIONS = Object.keys(STATUS_META);


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
  // Highest message id we currently have in the open room — sent to the stream
  // as `after=` so its initial catch-up only delivers genuinely new messages.
  const lastMsgIdRef = useRef(0);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [connected, setConnected] = useState(true);
  const [scrollLocked, setScrollLocked] = useState(true);
  const [brokenMedia, setBrokenMedia] = useState<Set<string>>(new Set());
  const [flaggedMedia, setFlaggedMedia] = useState<Set<string>>(new Set());
  const [typers, setTypers] = useState<string[]>([]);
  const [peerReadUntil, setPeerReadUntil] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  // "texting" = bubbles (default); "stacked" = Discord-style rows.
  const [chatStyle] = useState<"texting" | "stacked">(() =>
    typeof window !== "undefined" && window.localStorage.getItem("aether_chat_style") === "stacked" ? "stacked" : "texting"
  );
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
  // Right-side profile panel + media gallery for the open conversation.
  const [profileOpen, setProfileOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  // "Ignore" = hide the conversation + silence its notifications (local).
  const [ignored, setIgnored] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("aether_ignored") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const [requestSentTo, setRequestSentTo] = useState<string | null>(null);

  // Replies / edits / reactions
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [historyFor, setHistoryFor] = useState<Message | null>(null);
  const [historyItems, setHistoryItems] = useState<{ content: string; editedAt: number }[]>([]);

  // Voice calls (WebRTC, D1-relayed signaling)
  const [call, setCall] = useState<{
    direction: "outgoing" | "incoming";
    peer: string;
    callId?: string | null;
  } | null>(null);
  const [incomingCall, setIncomingCall] = useState<{ callId: string; caller: string } | null>(null);
  // Mirrors of call state for the poller (avoids stale-closure re-prompts).
  const callActiveRef = useRef(false);
  const incomingCallRef = useRef<string | null>(null);

  // Pending file previews before sending
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  // E2E
  const [e2eKeys, setE2eKeys] = useState<E2EKeyPair | null>(null);
  const [peerPub, setPeerPub] = useState<string | null>(null);
  const [peerProfile, setPeerProfile] = useState<{
    username: string;
    displayName?: string | null;
    avatar: string | null;
    timezone: string | null;
    status: string;
    lastSeenAt: number | null;
    createdAt: number;
    isOnline?: boolean;
    isFriend?: boolean | null;
    isBlocked?: boolean;
  } | null>(null);
  const [decryptedMap, setDecryptedMap] = useState<Record<number, string>>({});
  const [clock, setClock] = useState<Date>(new Date());

  const listRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Throttle typing pings + read receipts so the D1 writes stay minimal.
  const typingSentAtRef = useRef(0);
  const lastReportedReadRef = useRef(0);
  const loadingOlder = useRef<{ room: string; active: boolean }>({ room: "", active: false });
  const e2eReady = useRef(false);
  // Mirror of `ignored` so the stream effect's closure never goes stale.
  const ignoredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    ignoredRef.current = ignored;
  }, [ignored]);
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
    const load = async () => {
      const [profileRes, keyRes] = await Promise.all([
        fetch(`/api/users/profile?username=${encodeURIComponent(room!.peer)}`),
        fetch(`/api/keys/pubkey?username=${encodeURIComponent(room!.peer)}`),
      ]);
      if (!alive) return;
      if (profileRes.ok) {
        const d = await safeJson<{ profile?: {
          username: string; avatar: string | null; timezone: string | null; status: string;
          lastSeenAt: number | null; createdAt: number; isOnline?: boolean; isFriend?: boolean | null; isBlocked?: boolean;
        } }>(profileRes);
        if (alive && d?.profile) setPeerProfile(d.profile);
      }
      if (keyRes.ok) {
        const d = await safeJson<{ pubkey?: string | null }>(keyRes);
        if (alive) setPeerPub(d?.pubkey ?? null);
      }
    };
    setPeerProfile(null);
    setPeerPub(null);
    setRequestSentTo(null);
    setProfileOpen(false);
    void load();
    // Refresh every 30s so presence + timezone stay live without a WebSocket.
    const t = setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      clearInterval(t);
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

  /* ── real presence: heartbeat while the app is open ────────────────── */
  useEffect(() => {
    if (checking || !user) return;
    const beat = () => {
      void fetch("/api/users/presence", { method: "POST" }).catch(() => {});
    };
    beat();
    const t = setInterval(beat, 30_000);
    const onVis = () => {
      if (!document.hidden) {
        beat();
        void loadFriends();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [checking, user, loadFriends]);

  /* ── Web Push: register once notifications are granted ────────────── */
  useEffect(() => {
    if (checking || !user) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    void setupPushSubscription();
  }, [checking, user]);

  /* ── ring the incoming-call prompt ─────────────────────────────────── */
  useEffect(() => {
    if (!incomingCall) return;
    if (!ringtoneEnabled()) return;
    const stop = playRingtone();
    return () => stop();
  }, [incomingCall]);

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
          const maxId = data.messages.reduce((mx, m) => Math.max(mx, m.id), 0);
          if (maxId > lastMsgIdRef.current) lastMsgIdRef.current = maxId;
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
      lastMsgIdRef.current = 0;
      return;
    }
    setMessages([]);
    setHasMore(false);
    lastMsgIdRef.current = 0;
    setBrokenMedia(new Set());
    setFlaggedMedia(new Set());
    setTypers([]);
    setPeerReadUntil(0);
    setDecryptedMap({});
    // Anything older than this was here before we opened the room.
    roomOpenedAtRef.current = Date.now();
    // Load the newest page first, then attach the live stream with `after=`
    // set to our highest loaded id — the stream must never replay old messages.
    loadMessages().then(() => {
      if (!stopped) connect();
    });

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
    // Poll fallback must APPEND only new messages (never replace the list,
    // which would wipe loaded history and jump the scroll position).
    const loadNew = async () => {
      try {
        const params = new URLSearchParams();
        if (room) {
          params.set("room", "dm");
          params.set("peer", room.peer);
        }
        params.set("after", String(Math.max(0, lastMsgIdRef.current)));
        const res = await fetch(`/api/chat/messages?${params.toString()}`);
        if (!res.ok) return;
        const data = await safeJson<{ messages?: Message[] }>(res);
        if (data.messages?.length) {
          setMessages((prev) => {
            const have = new Set(prev.map((p) => p.id));
            const fresh = data.messages!.filter((m) => !have.has(m.id));
            if (!fresh.length) return prev;
            return [...prev, ...fresh];
          });
          const maxId = data.messages.reduce((mx, m) => Math.max(mx, m.id), 0);
          if (maxId > lastMsgIdRef.current) lastMsgIdRef.current = maxId;
        }
      } catch {
        /* transient */
      }
    };
    const startPolling = () => {
      if (!pollTimer) pollTimer = setInterval(() => void loadNew(), POLL_MS);
    };

    const maybeNotify = (m: Message) => {
      try {
        if (m.senderUsername === user?.username) return;
        // Ignored peers are silenced — no sound, no popup.
        if (room && ignoredRef.current.has(room.peer)) return;
        // Skip old/replayed messages (initial catch-up, reconnect replays) so
        // opening a room or a flaky connection never floods notifications.
        if (m.createdAt < roomOpenedAtRef.current) return;
        const perm =
          typeof Notification === "undefined" ? "unsupported" : Notification.permission;
        // Background = hidden tab OR the window simply isn't focused. Notify in
        // both cases — you shouldn't miss a message because the tab is visible
        // but you're in another window.
        const inBackground =
          typeof document !== "undefined" && (document.hidden || !document.hasFocus());
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
          void Notification.requestPermission().then((p) => {
            if (p === "granted") void setupPushSubscription();
          });
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
        // Only deliver messages newer than what we already have.
        if (lastMsgIdRef.current > 0) params.set("after", String(lastMsgIdRef.current));
        es = new EventSource(`/api/chat/stream?${params.toString()}`);
        es.onopen = () => {
          if (stopped) return;
          esFailures = 0;
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
            if (m.id > lastMsgIdRef.current) lastMsgIdRef.current = m.id;
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

  /* ── typing indicators + read receipts ─────────────────────────────── */
  const notifyTyping = () => {
    if (!room || !draft.trim()) return;
    const now = Date.now();
    if (now - typingSentAtRef.current < 2500) return;
    typingSentAtRef.current = now;
    void fetch("/api/chat/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: "dm", peer: room.peer, typing: true }),
    }).catch(() => {});
  };

  const stopTyping = () => {
    if (!room) return;
    typingSentAtRef.current = 0;
    void fetch("/api/chat/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: "dm", peer: room.peer, typing: false }),
    }).catch(() => {});
  };

  // Leaving a room: clear our typing flag for that thread.
  useEffect(() => {
    return () => {
      stopTyping();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  // Report the highest incoming message id I've seen (throttled to one write
  // per new batch — the server upserts, so this is cheap).
  useEffect(() => {
    if (!room || !user) return;
    const maxIncoming = messages
      .filter((m) => m.senderUsername !== user.username)
      .reduce((mx, m) => Math.max(mx, m.id), 0);
    if (maxIncoming > 0 && maxIncoming !== lastReportedReadRef.current) {
      lastReportedReadRef.current = maxIncoming;
      void fetch("/api/chat/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: "dm", peer: room.peer, messageId: maxIncoming }),
      }).catch(() => {});
    }
  }, [messages, room, user]);

  // Poll the peer's typing state + read receipts while a room is open.
  useEffect(() => {
    if (!room || !user) return;
    let alive = true;
    const poll = async () => {
      try {
        const [typingRes, readRes] = await Promise.all([
          fetch("/api/chat/typing?room=dm"),
          fetch("/api/chat/read?room=dm"),
        ]);
        if (!alive) return;
        if (typingRes.ok) {
          const td = await safeJson<{ typers?: string[] }>(typingRes);
          if (alive) setTypers((td?.typers ?? []).filter((t) => t !== user.username));
        }
        if (readRes.ok) {
          const rd = await safeJson<{ receipts?: { username: string; userId: number; messageId: number }[] }>(readRes);
          if (alive) {
            const mine = (rd?.receipts ?? []).find((r) => r.username === room.peer);
            setPeerReadUntil(mine?.messageId ?? 0);
          }
        }
      } catch {
        /* transient */
      }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, user?.username]);

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
      stopTyping();
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
      const upData = await safeJson<{ error?: string; mediaRef?: string; mime?: string; flagged?: boolean }>(up);
      if (!up.ok) throw new Error(upData.error || "Upload failed");
      // Auto-flagged media stays hidden behind a placeholder — the sender sees
      // it is under review instead of a broken image.
      if (upData.flagged && upData.mediaRef) {
        setFlaggedMedia((prev) => new Set(prev).add(upData.mediaRef!));
      }
      stopTyping();
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

  /* ── search: decrypted local content + server-side across the thread ─ */
  const runSearch = async (q: string) => {
    const query = q.trim().toLowerCase();
    if (!query) {
      setSearchResults(null);
      return;
    }
    if (!room) {
      setSearchResults([]);
      return;
    }
    const local = messages.filter((m) => {
      const text = (decryptedMap[m.id] ?? m.content).toLowerCase();
      return text.includes(query);
    });
    // Server search reaches messages we haven't loaded yet (plaintext ones —
    // E2E ciphertext is unreadable server-side, which is the point).
    let server: Message[] = [];
    try {
      const params = new URLSearchParams({ q: q.trim() });
      params.set("room", "dm");
      params.set("peer", room.peer);
      const res = await fetch(`/api/chat/search?${params.toString()}`);
      if (res.ok) {
        const d = await safeJson<{ messages?: Message[] }>(res);
        server = d?.messages ?? [];
      }
    } catch {
      /* offline — local results only */
    }
    const byId = new Map<number, Message>();
    for (const m of [...server, ...local]) byId.set(m.id, m);
    setSearchResults([...byId.values()].sort((a, b) => a.createdAt - b.createdAt));
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

  /* ── profile-panel actions ────────────────────────────────────────── */
  const toggleIgnore = (username: string) => {
    setIgnored((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      try {
        localStorage.setItem("aether_ignored", JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
    // Ignoring the active conversation closes it.
    if (room?.peer === username) {
      const willIgnore = !ignored.has(username);
      if (willIgnore) {
        setRoom(null);
        setProfileOpen(false);
      }
    }
  };

  const unfriendPeer = async () => {
    if (!room) return;
    setError(null);
    try {
      await fetch(`/api/friends?username=${encodeURIComponent(room.peer)}`, { method: "DELETE" });
      await loadFriends();
      setPeerProfile((p) => (p ? { ...p, isFriend: false } : p));
    } catch {
      /* ignore */
    }
  };

  const sendRequestToPeer = async () => {
    if (!room) return;
    setError(null);
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: room.peer }),
      });
      const data = await safeJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to send request");
      setRequestSentTo(room.peer);
      await loadFriends();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send request");
    }
  };


  const toggleBlockPeer = async () => {
    if (!room) return;
    const blocked = Boolean(peerProfile?.isBlocked);
    setError(null);
    try {
      const res = await fetch("/api/moderation/block", {
        method: blocked ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: room.peer }),
      });
      const data = await safeJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Failed");
      setPeerProfile((p) => (p ? { ...p, isBlocked: !blocked } : p));
      if (!blocked) {
        // Blocking hides their messages from view immediately.
        setMessages((prev) => prev.filter((m) => m.senderUsername !== room.peer));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
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

  /* ── voice calls ──────────────────────────────────────────────────── */
  const startCall = (peer: string) => {
    if (call || incomingCall) return;
    setCall({ direction: "outgoing", peer, callId: null });
  };

  // Keep refs in sync so the poller never re-prompts while a call is up.
  useEffect(() => {
    callActiveRef.current = call != null;
  }, [call]);
  useEffect(() => {
    incomingCallRef.current = incomingCall?.callId ?? null;
  }, [incomingCall]);

  // Poll for incoming calls while logged in (every ~4s). Ringing calls aimed
  // at me surface as an "incoming call" prompt.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/calls?poll=1");
        if (!res.ok) return;
        const data = await safeJson<{ calls?: { id: string; caller: string; callee: string; state: string }[] }>(res);
        if (!alive) return;
        for (const c of data.calls ?? []) {
          if (c.callee === user.username && c.state === "ringing") {
            if (!callActiveRef.current && !incomingCallRef.current) {
              setIncomingCall({ callId: c.id, caller: c.caller });
            }
            break;
          }
        }
      } catch {
        /* ignore */
      }
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.username]);

  /* ── derived ───────────────────────────────────────────────────────── */
  const grouped = useMemo(() => {
    const out: { message: Message; first: boolean; last: boolean }[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const prev = messages[i - 1];
      const next = messages[i + 1];
      const sameSender = prev && prev.senderUsername === m.senderUsername;
      const sameDay = prev && dayLabel(prev.createdAt) === dayLabel(m.createdAt);
      // A "run" is the same sender talking repeatedly; the name reappears after
      // a pause of roughly a day (or on a new day) — like most group chats.
      const close = prev && sameDay && m.createdAt - prev.createdAt < 24 * 60 * 60 * 1000;
      out.push({
        message: m,
        first: !(sameSender && sameDay && close),
        last: !(
          next &&
          next.senderUsername === m.senderUsername &&
          dayLabel(next.createdAt) === dayLabel(m.createdAt) &&
          next.createdAt - m.createdAt < 24 * 60 * 60 * 1000
        ),
      });
    }
    return out;
  }, [messages]);

  const roomTitle = room
    ? displayLabel(room.peer, peerProfile?.displayName)
    : "Messages";
  const e2eActive = Boolean(room && e2eKeys && peerPub);
  // Only working images go into the lightbox — flagged/gone media is excluded.
  const mediaSrcs = useMemo(
    () =>
      messages
        .filter(
          (m) =>
            m.mediaRef &&
            isImage(m.mediaMime) &&
            !flaggedMedia.has(m.mediaRef) &&
            !brokenMedia.has(m.mediaRef)
        )
        .map((m) => `/api/media/${m.mediaRef}`),
    [messages, flaggedMedia, brokenMedia]
  );

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

  const peerTzName = useMemo(() => {
    if (!peerProfile?.timezone) return null;
    try {
      const part = new Intl.DateTimeFormat([], {
        timeZone: peerProfile.timezone,
        timeZoneName: "longOffset",
      })
        .formatToParts(clock)
        .find((p) => p.type === "timeZoneName");
      return part?.value ?? peerProfile.timezone;
    } catch {
      return peerProfile.timezone;
    }
  }, [peerProfile, clock]);

  // Real presence: online only when their heartbeat is fresh.
  const peerOnline = peerProfile?.isOnline ?? false;
  const peerLastSeen = lastSeenText(peerProfile?.lastSeenAt);
  const peerPresenceText = peerOnline
    ? "Online now"
    : peerLastSeen
      ? `Last seen ${peerLastSeen}`
      : STATUS_META[peerProfile?.status ?? "offline"].label;

  // Media grouped by day, for the in-chat gallery.
  const mediaGroups = useMemo(() => {
    const groups: { day: string; items: Message[] }[] = [];
    for (const m of messages) {
      if (!m.mediaRef) continue;
      if (flaggedMedia.has(m.mediaRef) || brokenMedia.has(m.mediaRef)) continue;
      const day = dayLabel(m.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(m);
      else groups.push({ day, items: [m] });
    }
    return groups;
  }, [messages, flaggedMedia, brokenMedia]);

  const openAdmin = () => {
    // The admin panel takes over this window (no popup).
    router.push("/admin");
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white relative">
        <Background />
        <div className="relative z-10 h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-dvh text-white flex overflow-hidden relative">
      <Background />
      {/* ══ Sidebar ══ */}
      <aside className="w-48 sm:w-64 shrink-0 border-r border-white/10 flex flex-col bg-[#050506]/75 backdrop-blur-xl">
        <div className="p-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-black border border-white/30 flex items-center justify-center text-base font-serif italic font-bold text-white shadow-lg shadow-black/50">
              A
            </div>
            <span className="text-sm font-semibold">Aether</span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setFriendModal(true)}
              title="Add a friend"
              className="text-gray-500 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5"
            >
              <PlusIcon size={15} />
            </button>
            <button
              onClick={() => {
                setSearchOpen((v) => !v);
                setSearchResults(null);
              }}
              title="Search messages"
              className={`p-1.5 rounded-lg transition-colors ${
                searchOpen ? "text-white bg-white/10" : "text-gray-500 hover:text-white hover:bg-white/5"
              }`}
            >
              <SearchIcon size={15} />
            </button>
          </div>
        </div>

        {searchOpen && (
          <div className="mx-3 mb-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                void runSearch(e.target.value);
              }}
              placeholder="Search this conversation…"
              autoFocus
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition"
            />
          </div>
        )}

        {/* Friend requests — a small banner instead of a full friends list */}
        {incoming.length > 0 && (
          <button
            onClick={() => setFriendModal(true)}
            className="mx-3 mb-2 px-3 py-2 rounded-xl text-left text-xs bg-white/5 border border-white/15 hover:bg-white/10 transition flex items-center gap-2"
          >
            <span className="flex -space-x-1.5">
              {incoming.slice(0, 3).map((r) => (
                <Avatar key={r.username} name={r.username} avatar={r.avatar} size={18} />
              ))}
            </span>
            <span className="text-white/80 font-medium">
              {incoming.length} friend request{incoming.length === 1 ? "" : "s"}
            </span>
            <span className="ml-auto text-gray-500">View</span>
          </button>
        )}

        <div className="mt-1 px-4 pb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">Direct messages</span>
          {conversations.length > 0 && (
            <span className="text-[10px] text-gray-700">{conversations.length}</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto pb-2">
          {conversations.filter((c) => !ignored.has(c.peer)).length === 0 && (
            <p className="px-4 py-2 text-xs text-gray-600">
              {conversations.length > 0 ? "No visible conversations — ignored ones are hidden." : "No DMs yet — add a friend and say hi."}
            </p>
          )}
          {conversations.filter((c) => !ignored.has(c.peer)).map((c) => {
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
                <Avatar name={c.peer} avatar={c.avatar} size={28} />
                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate flex items-center gap-1.5 ${
                      (c.unread ?? 0) > 0 ? "text-xs font-semibold text-white" : "text-xs font-medium text-gray-300"
                    }`}
                  >
                    <span className="truncate">{displayLabel(c.peer, c.displayName)}</span>
                    {(c.unread ?? 0) > 0 && (
                      <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-black text-[10px] font-bold flex items-center justify-center">
                        {c.unread! > 99 ? "99+" : c.unread}
                      </span>
                    )}
                  </div>
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
                    <div
                      className={`text-[11px] truncate min-w-0 ${
                        (c.unread ?? 0) > 0 ? "text-gray-200" : "text-gray-500"
                      }`}
                    >
                      {c.lastSender === user?.username ? "You: " : ""}
                      {c.mediaRef ? (
                        <span className="inline-flex items-center gap-1">
                          <PaperclipIcon size={11} /> Media
                        </span>
                      ) : (
                        plainText(c.content || "")
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
            <div className="text-xs font-medium truncate">{displayLabel(user?.username ?? "", user?.displayName)}</div>
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
                <div className="absolute bottom-full left-0 z-30 mb-2 w-44 rounded-xl glass-strong p-1.5">
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
            <button
              onClick={openAdmin}
              title="Open the moderation console"
              className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-white bg-white/10 border border-white/20 rounded-full px-1.5 py-0.5 hover:bg-white/25 transition"
            >
              Admin
            </button>
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
            <header className="border-b border-white/10 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 bg-[#050506]/60 backdrop-blur-xl z-10">
              <button
                onClick={() => setProfileOpen((v) => !v)}
                className="flex items-center gap-3 min-w-0 text-left group"
                title="View profile"
              >
                <Avatar name={room.peer} avatar={peerProfile?.avatar} size={36} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-tight truncate flex items-center gap-2 group-hover:text-white/80 transition-colors">
                    <span className="truncate">{roomTitle}</span>
                  </div>
                  {/* Real presence — under their name */}
                  <div className="flex items-center gap-1.5 text-xs mt-0.5">
                    <span
                      className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                        peerOnline ? "bg-white pulse-dot" : "bg-gray-600"
                      }`}
                    />
                    <span className={peerOnline ? "text-white/80" : "text-gray-400"}>
                      {peerPresenceText}
                    </span>
                    {!connected && <span className="text-gray-500">· reconnecting…</span>}
                  </div>
                  {/* Their time — fixed, with the real timezone */}
                  {peerTime && peerProfile?.timezone && (
                    <div
                      className="text-[10px] text-gray-500 font-mono mt-0.5 truncate"
                      title={`${peerProfile.timezone}${peerTzName ? ` (${peerTzName})` : ""}`}
                    >
                      Their time · {peerTime}
                      {peerTzName ? ` · ${peerTzName}` : ""}
                    </div>
                  )}
                  {typers.length > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-300 mt-1">
                      <span className="flex items-center gap-0.5">
                        {[0, 1, 2].map((i) => (
                          <span key={i} className="typing-dot" style={{ animationDelay: `${i * 0.15}s` }} />
                        ))}
                      </span>
                      <span className="truncate">
                        {typers.join(", ")} {typers.length === 1 ? "is" : "are"} typing…
                      </span>
                    </div>
                  )}
                </div>
              </button>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  onClick={() => setMediaOpen(true)}
                  title="Media"
                  className={`shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full transition flex items-center justify-center ${
                    mediaOpen ? "bg-white/20 text-white" : "bg-white/10 hover:bg-white/20 text-white/80"
                  }`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                </button>
                <button
                  onClick={() => setProfileOpen((v) => !v)}
                  title="Profile"
                  className={`shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full transition flex items-center justify-center ${
                    profileOpen ? "bg-white/20 text-white" : "bg-white/10 hover:bg-white/20 text-white/80"
                  }`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </button>
                <button
                  onClick={() => startCall(room.peer)}
                  disabled={!!call || !!incomingCall}
                  title={`Voice call ${room.peer}`}
                  className="shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition flex items-center justify-center disabled:opacity-40"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </button>
              </div>
            </header>

            {room && !e2eActive && e2eKeys && (
              <div className="px-4 py-1.5 text-[11px] text-white/70 bg-white/5 border-b border-white/15 flex items-center gap-1.5">
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
                        <div className="text-sm text-gray-200">
                          {m.mediaRef && !m.content ? (
                            <span className="inline-flex items-center gap-1.5">
                              <PaperclipIcon size={12} /> Media
                            </span>
                          ) : (
                            formatText(decryptedMap[m.id] ?? m.content)
                          )}
                        </div>
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
                        <div className="w-14 h-14 mx-auto rounded-2xl bg-white/5 border border-white/20 flex items-center justify-center mb-4">
                          <ChatIcon size={24} className="text-white/70" />
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

                      const actionsRow = (
                        <div
                          className={`flex items-center gap-1 text-[11px] transition-all duration-150 ${
                            mine ? "justify-end" : "justify-start"
                          } ${showActions ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
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
                          {mine ? (
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
                          ) : (
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
                          )}
                          {!mine && (
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
                          )}
                          {mine && user?.role === "admin" && m.editedAt && (
                            <button
                              onClick={() => void openHistory(m)}
                              className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20 transition"
                              title="Edit history"
                            >
                              🕘
                            </button>
                          )}
                          <button
                            onClick={() => setActionFor(showActions ? null : m.id)}
                            className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20 transition"
                            title="More"
                          >
                            <DotsIcon size={13} />
                          </button>
                        </div>
                      );

                      // Discord-style layout: every message is a full-width row.
                      if (chatStyle === "stacked") {
                        return (
                          <div
                            key={m.id}
                            className={`flex gap-3 px-1 py-1 rounded-lg hover:bg-white/[0.04] transition ${
                              first ? "mt-3" : ""
                            }`}
                            onMouseLeave={() => setActionFor(null)}
                          >
                            <div
                              className={`shrink-0 w-9 h-9 rounded-full overflow-hidden flex items-center justify-center mt-0.5 ${
                                m.senderAvatar ? "" : `bg-gradient-to-br ${avatarGradient(m.senderUsername)}`
                              }`}
                            >
                              {m.senderAvatar ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={`/api/media/${m.senderAvatar}`} alt={m.senderUsername} className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-sm font-bold text-white">{m.senderUsername.slice(0, 1).toUpperCase()}</span>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-2 text-xs px-1">
                                {first ? (
                                  <>
                                    <button
                                      onClick={() => setProfileOpen(true)}
                                      className="font-medium text-gray-200 hover:text-white transition cursor-pointer"
                                      title="View profile"
                                    >
                                      {displayLabel(m.senderUsername, m.senderDisplayName)}
                                    </button>
                                    <span className="text-gray-600">{timeLabel(m.createdAt)}</span>
                                  </>
                                ) : null}
                                {m.editedAt && <span className="text-[10px] text-gray-500">(edited)</span>}
                                {mine && last && room && peerReadUntil >= m.id && (
                                  <span className="text-[10px] text-gray-400" title={`Read by ${room.peer}`}>
                                    Read
                                  </span>
                                )}
                              </div>
                              {actionsRow}
                              {m.replyTo && (
                                <div
                                  className="mb-1 rounded-lg border-l-2 border-white/25 bg-white/5 px-2.5 py-1.5 text-[11px] text-gray-400 cursor-pointer hover:bg-white/10 transition"
                                  onClick={() => {
                                    const el = document.getElementById(`msg-${m.replyTo!.id}`);
                                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                                  }}
                                >
                                  <span className="font-medium text-gray-300">{m.replyTo.senderUsername}</span>
                                  <span className="ml-1.5 truncate block max-w-[24ch] sm:max-w-[36ch]">
                                    {m.replyTo.mediaRef ? "📎 Media" : plainText(m.replyTo.content)}
                                  </span>
                                </div>
                              )}
                              {m.mediaRef && (
                                <MediaBubble
                                  mediaRef={m.mediaRef}
                                  mime={m.mediaMime}
                                  onFlagged={(ref) => setFlaggedMedia((prev) => new Set(prev).add(ref))}
                                  onError={(ref) => setBrokenMedia((prev) => new Set(prev).add(ref))}
                                  onOpen={(url, ref) => {
                                    const idx = mediaSrcs.indexOf(`/api/media/${ref}`);
                                    setLightbox({ srcs: mediaSrcs, index: Math.max(0, idx) });
                                  }}
                                />
                              )}
                              {displayContent !== "" && displayContent != null ? (
                                <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
                                  {formatText(displayContent)}
                                  {encrypted && (
                                    <span className="ml-1 text-gray-500" title="End-to-end encrypted">🔒</span>
                                  )}
                                </p>
                              ) : null}
                              {reactions.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {reactions.map((r) => (
                                    <button
                                      key={r.emoji}
                                      onClick={() => void toggleReaction(m, r.emoji)}
                                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                                        r.mine
                                          ? "border-white/60 bg-white/20"
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
                                <div className="relative z-20 mt-1">
                                  <EmojiPicker
                                    onPick={(e) => void toggleReaction(m, e)}
                                    onPickGif={(url) => void sendGif(url)}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      }

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
                            className={`shrink-0 w-8 h-8 rounded-full overflow-hidden flex items-center justify-center ${
                              first ? "opacity-100" : "opacity-0"
                            } transition-opacity ${
                              m.senderAvatar ? "" : `bg-gradient-to-br ${avatarGradient(m.senderUsername)}`
                            }`}
                          >
                            {m.senderAvatar ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={`/api/media/${m.senderAvatar}`} alt={m.senderUsername} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-xs font-bold text-white">{m.senderUsername.slice(0, 1).toUpperCase()}</span>
                            )}
                          </div>

                          {/* Bubble */}
                          <div className={`max-w-[75%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                            {first && (
                              <div className={`flex items-baseline gap-2 px-1 mb-1 text-xs ${mine ? "flex-row-reverse" : ""}`}>
                                <button
                                  onClick={() => setProfileOpen(true)}
                                  className="font-medium text-gray-300 hover:text-white transition cursor-pointer"
                                  title="View profile"
                                >
                                  {displayLabel(m.senderUsername, m.senderDisplayName)}
                                </button>
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
                                  {m.replyTo.mediaRef ? "📎 Media" : plainText(m.replyTo.content)}
                                </span>
                              </div>
                            )}

                            {actionsRow}

                            <div
                              id={`msg-${m.id}`}
                              className={`px-3 py-2.5 text-sm leading-relaxed break-words shadow-sm ${
                                m.mediaRef
                                  ? "bg-black border border-white/10 rounded-2xl"
                                  : mine
                                    ? "bg-white text-black shadow-xl shadow-black/40 rounded-2xl rounded-br-md"
                                    : "bg-white/8 border border-white/10 text-gray-100 rounded-2xl rounded-bl-md"
                              }`}
                            >
                              {m.mediaRef ? (
                                <MediaBubble
                                  mediaRef={m.mediaRef}
                                  mime={m.mediaMime}
                                  onFlagged={(ref) => setFlaggedMedia((prev) => new Set(prev).add(ref))}
                                  onError={(ref) => setBrokenMedia((prev) => new Set(prev).add(ref))}
                                  onOpen={(url, ref) => {
                                    const idx = mediaSrcs.indexOf(`/api/media/${ref}`);
                                    setLightbox({ srcs: mediaSrcs, index: Math.max(0, idx) });
                                  }}
                                />
                              ) : null}

                              {displayContent !== "" && displayContent != null ? (
                                <p className={m.mediaRef ? "mt-1.5 flex items-start gap-1.5 flex-wrap" : "flex items-start gap-1.5 flex-wrap"}>
                                  <span className="break-words whitespace-pre-wrap">{formatText(displayContent)}</span>
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

                            {showActions && (
                              <div
                                className={`flex flex-wrap items-center gap-1.5 text-[11px] animate-in fade-in duration-150 ${
                                  mine ? "justify-end" : "justify-start"
                                }`}
                              >
                                {!mine && (
                                  <button
                                    onClick={() => void blockUser(m.senderUsername)}
                                    className="px-2.5 py-1.5 rounded-lg bg-white/10 border border-white/30 text-white hover:bg-white/20 transition"
                                  >
                                    Block @{m.senderUsername}
                                  </button>
                                )}
                                {mine && user?.role === "admin" && (
                                  <button
                                    onClick={() => void adminDelete(m.id)}
                                    className="px-2.5 py-1.5 rounded-lg bg-red-600/20 border border-red-500/30 text-red-300 hover:bg-red-600/30 transition"
                                  >
                                    Delete (admin)
                                  </button>
                                )}
                                <button
                                  onClick={() => setActionFor(null)}
                                  className="px-2.5 py-1.5 rounded-lg bg-white/10 border border-white/10 text-gray-400 hover:text-white transition"
                                >
                                  Close
                                </button>
                              </div>
                            )}

                            {/* Read status on the last own message */}
                            {mine && last && room && peerReadUntil >= m.id && (
                              <div className="flex items-center gap-1 self-end mt-0.5 pr-1 text-[10px] leading-none">
                                <span className="text-gray-400" title={`Read by ${room.peer}`}>
                                  Read
                                </span>
                              </div>
                            )}

                            {/* Reactions */}
                            {reactions.length > 0 && (
                              <div className={`flex flex-wrap gap-1 mt-1 ${mine ? "self-end" : "self-start"}`}>
                                {reactions.map((r) => (
                                  <button
                                    key={r.emoji}
                                    onClick={() => void toggleReaction(m, r.emoji)}
                                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                                      r.mine
                                        ? "border-white/60 bg-white/20"
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

                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>

            {error && (
              <p className="text-white text-sm text-center py-1.5 px-4 bg-white/10 border-t border-white/20">{error}</p>
            )}

            {/* Composer */}
            <div className="border-t border-white/10 p-3 sm:p-4 bg-[#050506]/60 backdrop-blur-xl">
              <div className="max-w-2xl w-full mx-auto">
                {/* Editing chip */}
                {editing && (
                  <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2">
                    <span className="text-xs text-white font-medium">Editing message</span>
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
                      {replyTo.mediaRef ? "📎 Media" : plainText(decryptedMap[replyTo.id] ?? replyTo.content)}
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
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black border border-white/25 text-white flex items-center justify-center hover:bg-white/20 transition"
                          title="Remove"
                        >
                          <XIcon size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 sm:gap-2.5">
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
                    className="shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition flex items-center justify-center disabled:opacity-40 disabled:active:scale-100"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] sm:h-5 sm:w-5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="m21 15-5-5L5 21" />
                    </svg>
                  </button>
                  <div className="flex-1 relative min-w-0">
                    <input
                      type="text"
                      value={editing ? editDraft : draft}
                      onChange={(e) => {
                        if (editing) setEditDraft(e.target.value);
                        else {
                          setDraft(e.target.value);
                          notifyTyping();
                        }
                      }}
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
                      className="w-full px-3.5 py-2.5 sm:px-4 sm:py-3 pr-10 sm:pr-12 bg-white/5 border border-white/10 rounded-full text-white placeholder-gray-500 focus:outline-none focus:border-white/60 focus:bg-white/8 focus:shadow-[0_0_0_4px_rgba(255,255,255,0.12)] transition"
                      maxLength={4000}
                    />
                    {(sending || uploading) && (
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                    )}
                  </div>
                  <button
                    onClick={() => setPickerFor(pickerFor === 0 ? null : 0)}
                    className="shrink-0 w-10 h-10 sm:w-11 sm:h-11 ml-1 sm:ml-1.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition flex items-center justify-center"
                    title="Emoji & GIFs"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] sm:h-5 sm:w-5">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                      <line x1="9" x2="9.01" y1="9" y2="9" />
                      <line x1="15" x2="15.01" y1="9" y2="9" />
                    </svg>
                  </button>
                  <button
                    onClick={() => (editing ? void saveEdit() : pendingFiles.length > 0 ? void sendPendingFiles() : void sendText())}
                    disabled={
                      sending ||
                      uploading ||
                      (!editing && !draft.trim() && pendingFiles.length === 0) ||
                      (editing ? !editDraft.trim() : false)
                    }
                    className="shrink-0 px-4 py-2.5 sm:px-6 sm:py-3 rounded-full bg-white text-black text-sm font-medium shadow-lg shadow-black/50 hover:brightness-110 active:scale-95 transition disabled:opacity-40 disabled:shadow-none disabled:active:scale-100"
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

      {/* ══ Right-side profile panel ══ */}
      {room && profileOpen && (
        <aside className="w-72 shrink-0 border-l border-white/10 flex flex-col bg-[#050506]/70 backdrop-blur-xl">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Profile</span>
            <button
              onClick={() => setProfileOpen(false)}
              className="text-gray-500 hover:text-white transition p-1 rounded-lg hover:bg-white/5"
              title="Close panel"
            >
              <XIcon size={15} />
            </button>
          </div>

          <div className="p-5 flex flex-col items-center text-center">
            <Avatar name={room.peer} avatar={peerProfile?.avatar} size={76} />                            <div className="mt-3 text-base font-semibold break-all">
                              {displayLabel(room.peer, peerProfile?.displayName)}
                            </div>
            <div className="flex items-center gap-1.5 text-xs mt-1">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  peerOnline ? "bg-white pulse-dot" : "bg-gray-600"
                }`}
              />
              <span className={peerOnline ? "text-white/80" : "text-gray-400"}>
                {peerPresenceText}
              </span>
            </div>

            {/* Their time — live, with the real timezone */}
            {peerTime && peerProfile?.timezone && (
              <div className="mt-3 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 w-full">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Their time</div>
                <div className="font-mono text-sm text-white">
                  {peerTime}
                  <span className="text-gray-500 text-xs ml-2">{peerProfile.timezone}</span>
                </div>
                {peerTzName && <div className="text-[10px] text-gray-600 mt-0.5">{peerTzName}</div>}
              </div>
            )}
            <div className="mt-2 text-[11px] text-gray-600">Joined {dayLabel(peerProfile?.createdAt ?? 0)}</div>
          </div>

          <div className="px-4 pb-4 space-y-1.5">
            <button
              onClick={() => startCall(room.peer)}
                disabled={!!call || !!incomingCall}
                className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-medium transition flex items-center justify-center gap-2 disabled:opacity-40"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                Voice call
              </button>
            <button
              onClick={() => {
                setMediaOpen(true);
                setProfileOpen(false);
              }}
              className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-medium transition flex items-center justify-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              View media
            </button>

            <div className="h-px bg-white/10 my-2" />

            {peerProfile?.isFriend ? (
              <button
                onClick={() => void unfriendPeer()}
                className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-gray-200 transition"
              >
                Remove friend
              </button>
            ) : requestSentTo === room.peer ? (
              <div className="w-full py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-gray-400 text-center">
                Friend request sent
              </div>
            ) : (
              <button
                onClick={() => void sendRequestToPeer()}
                className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-gray-200 transition"
              >
                Add friend
              </button>
            )}
            <button
              onClick={() => toggleIgnore(room.peer)}
              className={`w-full py-2.5 rounded-xl text-sm transition border ${
                ignored.has(room.peer)
                  ? "bg-white/10 border-white/25 text-white"
                  : "bg-white/5 hover:bg-white/10 border-white/10 text-gray-200"
              }`}
            >
              {ignored.has(room.peer) ? "Unignore" : "Ignore"}
              <span className="block text-[10px] text-gray-500 font-normal mt-0.5">
                {ignored.has(room.peer) ? "Notifications are on again" : "Hide conversation & silence notifications"}
              </span>
            </button>
            <button
              onClick={() => void toggleBlockPeer()}
              className={`w-full py-2.5 rounded-xl text-sm transition border ${
                peerProfile?.isBlocked
                  ? "bg-white/10 border-white/25 text-white"
                  : "bg-red-600/15 hover:bg-red-600/25 border-red-500/25 text-red-300"
              }`}
            >
              {peerProfile?.isBlocked ? "Unblock" : "Block"}
              <span className="block text-[10px] opacity-70 font-normal mt-0.5">
                {peerProfile?.isBlocked ? "They can message you again" : "They can no longer message you"}
              </span>
            </button>
          </div>
        </aside>
      )}

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

      {/* Friends & requests modal */}
      {friendModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setFriendModal(false)}>
          <div className="w-full max-w-sm glass-strong rounded-2xl p-6 animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold">Friends</h2>
              <button onClick={() => setFriendModal(false)} className="text-gray-500 hover:text-white transition p-1" title="Close">
                <XIcon size={16} />
              </button>
            </div>

            {/* Incoming requests */}
            {incoming.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-600 mb-1.5">Incoming requests</div>
                <div className="space-y-1.5">
                  {incoming.map((r) => (
                    <div key={r.username} className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/15 px-2.5 py-2">
                      <Avatar name={r.username} avatar={r.avatar} size={26} />
                      <span className="text-sm font-medium text-white/90 truncate flex-1">{r.username}</span>
                      <button
                        onClick={() => void respondFriend(r.username, true)}
                        title="Accept"
                        className="w-7 h-7 rounded-full bg-white text-black flex items-center justify-center hover:bg-gray-200 transition"
                      >
                        <CheckIcon size={13} />
                      </button>
                      <button
                        onClick={() => void respondFriend(r.username, false)}
                        title="Decline"
                        className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-gray-300 flex items-center justify-center transition"
                      >
                        <XIcon size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Outgoing requests */}
            {outgoing.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-600 mb-1.5">Sent requests</div>
                <div className="space-y-1.5">
                  {outgoing.map((r) => (
                    <div key={r.username} className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-2.5 py-2">
                      <Avatar name={r.username} avatar={r.avatar} size={26} />
                      <span className="text-sm text-gray-300 truncate flex-1">{r.username} · pending</span>
                      <button
                        onClick={() => void cancelRequest(r.username)}
                        title="Cancel request"
                        className="text-[11px] text-gray-500 hover:text-white transition px-2 py-1 rounded-lg hover:bg-white/10"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {friends.length > 0 && (
              <p className="mt-3 text-[11px] text-gray-600">
                You have {friends.length} friend{friends.length === 1 ? "" : "s"} — open a conversation from the sidebar.
              </p>
            )}

            {/* Add form */}
            <div className="mt-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-600 mb-1.5">Add a friend</div>
              <p className="text-xs text-gray-500 mb-2">Enter their username — they&apos;ll get a request they can accept.</p>
              <div className="flex gap-2">
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
                  className="flex-1 min-w-0 px-3 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition"
                />
                <button
                  onClick={() => void addFriend()}
                  disabled={friendBusy || !friendName.trim()}
                  className="shrink-0 px-4 py-2.5 rounded-full bg-white text-black text-sm font-medium hover:bg-gray-200 transition disabled:opacity-40"
                >
                  {friendBusy ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Report modal */}
      {reportFor && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setReportFor(null)}>
          <div className="w-full max-w-sm glass-strong rounded-2xl p-6 animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
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
                className="flex-1 py-2.5 rounded-full bg-white text-black text-sm font-medium hover:bg-gray-200 transition disabled:opacity-40"
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
          <div className="w-full max-w-md glass-strong rounded-2xl p-6 animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
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
                  <p className="text-sm text-gray-200 break-words">
                    {h.content.startsWith(E2E_PREFIX) ? "🔒 (encrypted)" : formatText(h.content)}
                  </p>
                </div>
              ))}
              <div className="rounded-xl border border-white/20 bg-white/5 p-3">
                <div className="text-[10px] text-gray-600 mb-1">Current version</div>
                <p className="text-sm text-gray-100 break-words">
                  {(decryptedMap[historyFor.id] ?? historyFor.content).startsWith(E2E_PREFIX)
                    ? "🔒 (encrypted)"
                    : formatText(decryptedMap[historyFor.id] ?? historyFor.content)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ Media gallery — every photo/video, grouped by day ══ */}
      {mediaOpen && room && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-sm flex flex-col animate-in fade-in duration-200"
          onClick={() => setMediaOpen(false)}
        >
          <div
            className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/10 bg-black/30"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="text-sm font-semibold">Media</div>
              <div className="text-xs text-gray-500">with {room.peer} · {mediaGroups.reduce((n, g) => n + g.items.length, 0)} item(s)</div>
            </div>
            <button
              onClick={() => setMediaOpen(false)}
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 transition flex items-center justify-center"
              title="Close (Esc)"
            >
              <XIcon size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
            {mediaGroups.length === 0 && (
              <p className="text-sm text-gray-500 text-center pt-16">No media in this conversation yet.</p>
            )}
            {mediaGroups.map((g) => (
              <div key={g.day} className="mb-7">
                <div className="sticky top-0 z-10 bg-black/70 backdrop-blur-md rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 inline-block mb-3">
                  {g.day}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                  {g.items.map((m) => {
                    const ref = m.mediaRef!;
                    if (isVideo(m.mediaMime)) {
                      return (
                        <a
                          key={m.id}
                          href={`/api/media/${ref}`}
                          target="_blank"
                          rel="noreferrer"
                          className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-black/50 hover:border-white/30 transition"
                          title="Open video"
                        >
                          <video src={`/api/media/${ref}`} muted preload="metadata" className="w-full h-full object-cover" />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/10 transition">
                            <span className="w-10 h-10 rounded-full bg-white/90 text-black flex items-center justify-center">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="6 3 20 12 6 21 6 3" />
                              </svg>
                            </span>
                          </span>
                        </a>
                      );
                    }
                    return (
                      <button
                        key={m.id}
                        onClick={() => {
                          const idx = mediaSrcs.indexOf(`/api/media/${ref}`);
                          setLightbox({ srcs: mediaSrcs, index: Math.max(0, idx) });
                        }}
                        className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-black/40 hover:border-white/30 transition cursor-zoom-in"
                        title={dayLabel(m.createdAt)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/media/${ref}`}
                          alt="Shared media"
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Incoming call prompt */}
      {incomingCall && user && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl glass-strong border border-white/15 p-6 animate-pop shadow-2xl shadow-black/60">
            <div className="flex flex-col items-center">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-zinc-600 to-zinc-900 border border-white/20 flex items-center justify-center text-3xl font-bold text-white animate-pulse-ring">
                {incomingCall.caller.slice(0, 1).toUpperCase()}
              </div>
              <div className="mt-3 text-lg font-semibold">@{incomingCall.caller}</div>
              <div className="text-xs text-gray-400 mt-1">is calling you…</div>
              <div className="flex gap-4 mt-6">
                <button
                  onClick={() => {
                    setCall({ direction: "incoming", peer: incomingCall.caller, callId: incomingCall.callId });
                    setIncomingCall(null);
                  }}
                  className="w-14 h-14 rounded-full bg-green-600 hover:bg-green-500 text-white flex items-center justify-center transition active:scale-95 shadow-lg shadow-green-900/40"
                  title="Answer"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </button>
                <button
                  onClick={() => {
                    void fetch("/api/calls", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "hangup", callId: incomingCall.callId }),
                    }).catch(() => {});
                    setIncomingCall(null);
                  }}
                  className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center transition active:scale-95 shadow-lg shadow-red-900/40"
                  title="Decline"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active call overlay */}
      {call && user && (
        <CallOverlay
          me={user.username}
          peer={call.peer}
          peerAvatar={call.peer === room?.peer ? peerProfile?.avatar : null}
          direction={call.direction}
          initialCallId={call.callId}
          onEnded={() => setCall(null)}
        />
      )}

      {/* Custom image viewer */}
      {lightbox && (
        <ImageViewer srcs={lightbox.srcs} index={lightbox.index} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
