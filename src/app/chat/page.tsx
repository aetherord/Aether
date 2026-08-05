"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Message {
  id: number;
  senderUsername: string;
  content: string;
  mediaRef: string | null;
  createdAt: number;
}

const POLL_MS = 4000;

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Chat() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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
      if (data.messages) setMessages(data.messages);
    } catch {
      /* keep last known messages on transient errors */
    }
  }, [router]);

  useEffect(() => {
    if (checking) return;
    loadMessages();
    const timer = setInterval(loadMessages, POLL_MS);
    return () => clearInterval(timer);
  }, [checking, loadMessages]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

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
      const upData = (await up.json()) as { error?: string; mediaRef?: string };
      if (!up.ok) throw new Error(upData.error || "Upload failed");
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaRef: upData.mediaRef }),
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

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white">
        <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-serif italic font-bold text-white/90">A</span>
          <span className="text-sm text-gray-400">Community chat</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-300">@{username}</span>
          <Link href="/settings" className="text-sm text-gray-400 hover:text-white transition-colors">
            Settings
          </Link>
          <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
            Home
          </Link>
        </div>
      </header>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-4 max-w-3xl w-full mx-auto"
      >
        {messages.length === 0 && (
          <p className="text-center text-gray-500 text-sm mt-12">
            No messages yet. Say hello — it&apos;s all Aether in here.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="flex gap-3 items-start">
            <div className="shrink-0 w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">
              {m.senderUsername.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{m.senderUsername}</span>
                <span className="text-xs text-gray-500">{timeLabel(m.createdAt)}</span>
              </div>
              {m.mediaRef ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/media/${m.mediaRef}`}
                  alt={`Image from ${m.senderUsername}`}
                  className="mt-1 max-w-72 rounded-xl border border-white/10"
                />
              ) : (
                <p className="text-gray-200 text-sm leading-relaxed break-words">{m.content}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="text-red-400 text-sm text-center pb-2 px-4">{error}</p>
      )}

      <div className="border-t border-white/10 p-4">
        <div className="max-w-3xl w-full mx-auto flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void sendMedia(file);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Send an image"
            className="shrink-0 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 transition flex items-center justify-center text-lg disabled:opacity-40"
          >
            {uploading ? (
              <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            ) : (
              "🖼"
            )}
          </button>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendText()}
            placeholder="Message the community..."
            className="flex-1 px-4 py-3 bg-black/30 border border-white/10 rounded-full text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition"
          />
          <button
            onClick={sendText}
            disabled={sending || !draft.trim()}
            className="shrink-0 px-6 py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
