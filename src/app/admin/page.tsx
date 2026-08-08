"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Background from "@/components/Background";
import { safeJson } from "@/lib/safeJson";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Tab = "users" | "reviews" | "reports" | "appeals" | "log";

interface SearchUser {
  id: number;
  username: string;
  email: string;
  role: string;
  bannedUntil: number | null;
  mutedUntil: number | null;
  createdAt: number;
}

interface UserAudit {
  user: {
    id: number;
    email: string;
    username: string;
    role: string;
    mutedUntil: number | null;
    bannedUntil: number | null;
    banReason: string | null;
    status: string;
    createdAt: number;
  };
  warnings: { id: number; adminUsername: string; reason: string; createdAt: number }[];
  messages: any[];
  media: { ref: string; mime: string | null; createdAt: number }[];
  calls: any[];
}

interface ReviewItem {
  id: number;
  mediaRef: string;
  mediaMime: string | null;
  senderUsername: string;
  reason: string;
  status: string;
  reporterUsername: string | null;
  createdAt: number;
}

interface ReportItem {
  id: number;
  messageId: number;
  reporterId: number;
  reason: string;
  status: string;
  createdAt: number;
}

interface LogItem {
  id: number;
  adminUsername: string;
  action: string;
  targetUsername: string;
  detail: string | null;
  createdAt: number;
}

interface AppealItem {
  id: number;
  userId: number;
  username: string;
  reason: string;
  status: string;
  createdAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function timeLeft(until: number | null): string {
  if (!until) return "—";
  const ms = until - Date.now();
  if (ms <= 0) return "expired";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function isVideo(mime: string | null): boolean {
  return (mime ?? "").startsWith("video/");
}

/**
 * Admin moderation console — a floating \"external window\" over the app.
 * Only admins can open it; every action is recorded in the audit log.
 */
export default function Admin() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>("users");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<SearchUser[]>([]);
  const [audit, setAudit] = useState<UserAudit | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [appeals, setAppeals] = useState<AppealItem[]>([]);
  const [log, setLog] = useState<LogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [banMinutes, setBanMinutes] = useState(1440);
  const [muteMinutes, setMuteMinutes] = useState(60);
  const [warnReason, setWarnReason] = useState("");
  const [selectedMedia, setSelectedMedia] = useState<ReviewItem | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [scaled, setScaled] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // True when this page is a real separate window (opened via window.open).
  const isPopup = typeof window !== "undefined" && Boolean(window.opener);

  const closeAdmin = () => {
    // In a popup window, close() returns you straight to the chat window.
    if (isPopup) window.close();
    else router.push("/chat");
  };

  const notify = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2500);
  };

  const api = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/moderation/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await safeJson<{ error?: string }>(res);
    if (!res.ok) throw new Error(data.error ?? "Action failed");
    return data;
  }, []);

  /** Session guard — non-admins bounce to /chat. */
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/session")
      .then(async (r) => ({
        status: r.status,
        data: await safeJson<{ authenticated?: boolean; user?: { role?: string } }>(r),
      }))
      .then(({ status, data }) => {
        if (!alive) return;
        if (status === 429) return;
        if (!data.authenticated || !data.user || data.user.role !== "admin") {
          router.replace("/chat");
          return;
        }
        setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, [router]);

  const searchUsers = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setUsers([]);
      return;
    }
    try {
      const res = await fetch(`/api/moderation/admin?view=users&q=${encodeURIComponent(q)}`);
      const data = await safeJson<{ users?: SearchUser[] }>(res);
      setUsers(data?.users ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadAudit = useCallback(async (username: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/moderation/admin?view=user&username=${encodeURIComponent(username)}`);
      const data = await safeJson<UserAudit>(res);
      if (data && (data as any).user) {
        setAudit(data);
        setTab("users");
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }, []);

  const loadReviews = useCallback(async () => {
    try {
      const res = await fetch("/api/moderation/admin?view=reviews");
      const data = await safeJson<{ reviews?: ReviewItem[] }>(res);
      setReviews(data?.reviews ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadReports = useCallback(async () => {
    try {
      const res = await fetch("/api/moderation/admin?view=reports");
      const data = await safeJson<{ reports?: ReportItem[] }>(res);
      setReports(data?.reports ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadAppeals = useCallback(async () => {
    try {
      const res = await fetch("/api/moderation/admin?view=appeals");
      const data = await safeJson<{ appeals?: AppealItem[] }>(res);
      setAppeals(data?.appeals ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadLog = useCallback(async () => {
    try {
      const res = await fetch("/api/moderation/admin?view=log");
      const data = await safeJson<{ log?: LogItem[] }>(res);
      setLog(data?.log ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (tab === "reviews") void loadReviews();
    if (tab === "reports") void loadReports();
    if (tab === "appeals") void loadAppeals();
    if (tab === "log") void loadLog();
  }, [tab, loadReviews, loadReports, loadAppeals, loadLog]);

  const onQuery = (q: string) => {
    setQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void searchUsers(q), 250);
  };

  const act = async (body: Record<string, unknown>, msg: string, reload = true) => {
    setBusy(true);
    try {
      await api(body);
      notify(msg);
      if (reload) {
        if (audit) await loadAudit(audit.user.username);
        await loadReviews();
        await loadAppeals();
        await loadLog();
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const banUser = () =>
    void act(
      { action: "ban", username: audit!.user.username, minutes: banMinutes, reason: "Banned by admin" },
      `Banned ${audit!.user.username} for ${banMinutes}m`
    );
  const unbanUser = () => void act({ action: "unban", username: audit!.user.username }, `Unbanned ${audit!.user.username}`);
  const muteUser = () =>
    void act({ action: "mute", username: audit!.user.username, minutes: muteMinutes }, `Muted for ${muteMinutes}m`);
  const unmuteUser = () => void act({ action: "unmute", username: audit!.user.username }, "Unmuted");
  const warnUser = () => {
    if (!warnReason.trim()) return;
    void act({ action: "warn", username: audit!.user.username, reason: warnReason }, "Warning issued");
    setWarnReason("");
  };
  const removeWarning = (id: number) =>
    void act({ action: "remove-warning", username: audit!.user.username, warningId: id }, "Warning removed");
  const toggleAdmin = () =>
    void act(
      { action: audit!.user.role === "admin" ? "remove-admin" : "set-admin", username: audit!.user.username },
      audit!.user.role === "admin" ? "Admin rights removed" : "Made admin"
    );

  const deleteMessage = (messageId: number) =>
    void act({ action: "delete-message", messageId }, `Message ${messageId} deleted`, true);

  const reviewMedia = (item: ReviewItem, decision: "keep" | "delete") =>
    void act(
      { action: "review-media", mediaRef: item.mediaRef, decision },
      decision === "delete" ? "Media permanently deleted" : "Media restored",
      true
    );

  const decideAppeal = (item: AppealItem, approve: boolean) =>
    void act(
      { action: approve ? "approve-appeal" : "deny-appeal", appealId: item.id },
      approve ? `Appeal approved — ${item.username} unbanned` : `Appeal denied — ${item.username}`,
      true
    );

  /** Renames the audited user (admin-only action, recorded in the log). */
  const renameUser = () => {
    const name = newUsername.trim();
    if (!name || !audit) return;
    setBusy(true);
    api({ action: "change-username", username: audit.user.username, newUsername: name })
      .then(() => {
        notify(`Username changed to ${name}`);
        setRenameOpen(false);
        setNewUsername("");
        void loadAudit(name); // reload under the new handle
        void loadLog();
      })
      .catch((err) => notify(err instanceof Error ? err.message : "Failed to change username"))
      .finally(() => setBusy(false));
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050506] text-white">
        <div className="animate-pulse text-sm text-gray-400">Checking access…</div>
      </div>
    );
  }

  const banActive = audit && audit.user.bannedUntil && audit.user.bannedUntil > Date.now();
  const muteActive = audit && audit.user.mutedUntil && audit.user.mutedUntil > Date.now();

  return (
    <div className="min-h-screen bg-[#050506] text-white relative">
      <Background />
      <div className={`relative z-10 min-h-screen flex items-center justify-center ${scaled ? "p-0" : "p-3 sm:p-6"}`}>
        {/* ── Floating window ── */}
        {minimized ? (
          <button
            onClick={() => setMinimized(false)}
            className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 glass-strong rounded-full px-4 py-2.5 flex items-center gap-2.5 animate-pop hover:bg-white/10 transition"
            title="Restore moderation console"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/90 animate-pulse" />
            <span className="text-xs font-semibold">Aether · Moderation Console</span>
            <span className="text-[11px] text-gray-500">minimized — click to restore</span>
          </button>
        ) : (
        <div
          className={`flex flex-col animate-pop shadow-2xl shadow-black/60 ${
            scaled
              ? "w-full h-[100dvh] max-w-none rounded-none"
              : "w-full max-w-5xl h-[88vh] glass-strong rounded-2xl overflow-hidden"
          }`}
        >
          {/* Title bar — working traffic lights */}
          <div className="px-4 py-3 flex items-center gap-2 border-b border-white/10 bg-white/[0.03]">
            <button
              onClick={closeAdmin}
              title="Close — returns to chat"
              className="group w-3.5 h-3.5 rounded-full bg-red-500/80 hover:bg-red-400 transition flex items-center justify-center"
            >
              <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="4" strokeLinecap="round" className="opacity-0 group-hover:opacity-60 transition">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
            <button
              onClick={() => setMinimized(true)}
              title="Minimize"
              className="group w-3.5 h-3.5 rounded-full bg-yellow-500/80 hover:bg-yellow-400 transition flex items-center justify-center"
            >
              <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="4" strokeLinecap="round" className="opacity-0 group-hover:opacity-60 transition">
                <path d="M5 12h14" />
              </svg>
            </button>
            <button
              onClick={() => setScaled((v) => !v)}
              title={scaled ? "Restore window" : "Scale to window"}
              className="group w-3.5 h-3.5 rounded-full bg-green-500/80 hover:bg-green-400 transition flex items-center justify-center"
            >
              <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-0 group-hover:opacity-60 transition">
                <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            </button>
            <span className="ml-3 text-xs font-semibold uppercase tracking-widest text-gray-300">
              Aether · Moderation Console
            </span>
            <span className="ml-auto flex items-center gap-3">
              {flash && <span className="text-[11px] text-white/80 bg-white/10 border border-white/15 rounded-full px-2.5 py-1">{flash}</span>}
              {isPopup && (
                <button
                  onClick={closeAdmin}
                  className="text-gray-500 hover:text-white transition text-[11px] px-2 py-1 rounded-lg hover:bg-white/10"
                >
                  Close window
                </button>
              )}
            </span>
          </div>

          <div className="flex flex-1 min-h-0">
            {/* ── Left rail ── */}
            <div className="w-44 sm:w-56 shrink-0 border-r border-white/10 flex flex-col">
              <div className="p-3">
                <div className="relative">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => onQuery(e.target.value)}
                    placeholder="Search users…"
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm placeholder-gray-500 focus:outline-none focus:border-white/30 transition"
                  />
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                </div>
                {query.trim().length >= 2 && (
                  <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                    {users.length === 0 && <p className="text-xs text-gray-600 px-2 py-2">No matches.</p>}
                    {users.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => void loadAudit(u.username)}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition ${
                          audit?.user.username === u.username ? "bg-white/15" : "hover:bg-white/5"
                        }`}
                      >
                        <div className="font-medium truncate">{u.username}</div>
                        <div className="text-[10px] text-gray-500 truncate">
                          {u.role === "admin" ? "Admin · " : ""}
                          {u.bannedUntil && u.bannedUntil > Date.now() ? "Banned · " : ""}
                          {u.mutedUntil && u.mutedUntil > Date.now() ? "Muted" : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <nav className="mt-1 px-2 space-y-0.5">
                {(
                  [
                    ["users", "Users"],
                    ["reviews", "Media review"],
                    ["reports", "Reports"],
                    ["appeals", "Appeals"],
                    ["log", "Audit log"],
                  ] as [Tab, string][]
                ).map(([t, label]) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition ${
                      tab === t ? "bg-white/12 text-white" : "text-gray-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${tab === t ? "bg-white" : "bg-gray-600"}`} />
                    {label}
                    {t === "reviews" && reviews.some((r) => r.status === "pending") && (
                      <span className="ml-auto bg-red-500/20 text-red-300 border border-red-500/30 rounded-full px-1.5 text-[10px]">
                        {reviews.filter((r) => r.status === "pending").length}
                      </span>
                    )}
                    {t === "appeals" && appeals.some((a) => a.status === "pending") && (
                      <span className="ml-auto bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 rounded-full px-1.5 text-[10px]">
                        {appeals.filter((a) => a.status === "pending").length}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
              <div className="mt-auto p-3 border-t border-white/10 text-[10px] text-gray-600">
                Every action is logged.
              </div>
            </div>

            {/* ── Main pane ── */}
            <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6">
              {busy && (
                <div className="fixed top-20 right-6 z-50 animate-pulse text-[11px] text-gray-400 bg-black/60 border border-white/10 rounded-full px-3 py-1.5">
                  Working…
                </div>
              )}

              {tab === "users" && !audit && (
                <div className="h-full flex items-center justify-center text-sm text-gray-600">
                  Search for a user to open their moderation panel.
                </div>
              )}

              {tab === "users" && audit && (
                <div className="space-y-5">
                  {/* Profile card */}
                  <div className="glass rounded-2xl p-5">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-zinc-600 to-zinc-900 border border-white/20 flex items-center justify-center text-2xl font-bold">
                          {audit.user.username.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-semibold truncate">@{audit.user.username}</span>
                            {audit.user.role === "admin" && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide bg-white/10 border border-white/25 rounded-full px-2 py-0.5">Admin</span>
                            )}
                            <button
                              onClick={() => setRenameOpen((v) => !v)}
                              title="Change username"
                              className="shrink-0 text-gray-500 hover:text-white transition p-1 rounded-lg hover:bg-white/10"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                              </svg>
                            </button>
                          </div>
                          {renameOpen && (
                            <div className="mt-2.5 flex gap-2 animate-in fade-in duration-150">
                              <input
                                type="text"
                                value={newUsername}
                                onChange={(e) => setNewUsername(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") renameUser();
                                  if (e.key === "Escape") setRenameOpen(false);
                                }}
                                placeholder="New username"
                                maxLength={20}
                                autoFocus
                                className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-black/40 border border-white/15 text-sm focus:outline-none focus:border-white/30 transition"
                              />
                              <button
                                onClick={renameUser}
                                disabled={!newUsername.trim()}
                                className="shrink-0 px-3 py-1.5 rounded-lg bg-white text-black text-xs font-medium transition disabled:opacity-40"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setRenameOpen(false)}
                                className="shrink-0 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs transition"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                          <div className="text-xs text-gray-500 mt-0.5">{audit.user.email}</div>
                          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
                            <span>Joined {fmtTime(audit.user.createdAt)}</span>
                            <span>Status: {audit.user.status}</span>
                            {banActive && (
                              <span className="text-red-300">Banned · {timeLeft(audit.user.bannedUntil)} left</span>
                            )}
                            {muteActive && (
                              <span className="text-yellow-300">Muted · {timeLeft(audit.user.mutedUntil)} left</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-wrap gap-2">
                        {!banActive ? (
                          <>
                            <select
                              value={banMinutes}
                              onChange={(e) => setBanMinutes(Number(e.target.value))}
                              className="px-2 py-1.5 rounded-lg bg-black/40 border border-white/15 text-xs focus:outline-none"
                            >
                              {[60, 360, 1440, 10080, 43200, 525600].map((m) => (
                                <option key={m} value={m}>
                                  {m < 1440 ? `${m / 60}h` : `${m / 1440}d`}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={banUser}
                              className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-medium transition active:scale-95"
                            >
                              Ban
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={unbanUser}
                            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium transition active:scale-95"
                          >
                            Unban
                          </button>
                        )}

                        {!muteActive ? (
                          <>
                            <select
                              value={muteMinutes}
                              onChange={(e) => setMuteMinutes(Number(e.target.value))}
                              className="px-2 py-1.5 rounded-lg bg-black/40 border border-white/15 text-xs focus:outline-none"
                            >
                              {[10, 30, 60, 1440, 10080].map((m) => (
                                <option key={m} value={m}>
                                  {m < 60 ? `${m}m` : m < 1440 ? `${m / 60}h` : `${m / 1440}d`}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={muteUser}
                              className="px-3 py-1.5 rounded-lg bg-yellow-600/80 hover:bg-yellow-500 text-xs font-medium transition active:scale-95"
                            >
                              Timeout
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={unmuteUser}
                            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium transition active:scale-95"
                          >
                            Unmute
                          </button>
                        )}

                        <button
                          onClick={toggleAdmin}
                          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium transition active:scale-95"
                        >
                          {audit.user.role === "admin" ? "Remove admin" : "Make admin"}
                        </button>
                      </div>
                    </div>

                    {/* Warn box */}
                    <div className="mt-4 flex gap-2">
                      <input
                        type="text"
                        value={warnReason}
                        onChange={(e) => setWarnReason(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && warnUser()}
                        placeholder="Warning reason…"
                        className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm placeholder-gray-500 focus:outline-none focus:border-white/30 transition"
                      />
                      <button
                        onClick={warnUser}
                        disabled={!warnReason.trim()}
                        className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium transition disabled:opacity-40 active:scale-95"
                      >
                        Warn
                      </button>
                    </div>
                  </div>

                  {/* Warnings */}
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                      Warnings ({audit.warnings.length})
                    </h3>
                    {audit.warnings.length === 0 && (
                      <p className="text-xs text-gray-600">No warnings on record.</p>
                    )}
                    <div className="space-y-2">
                      {audit.warnings.map((w) => (
                        <div key={w.id} className="glass rounded-xl px-3 py-2.5 flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-gray-400">
                              by <span className="text-gray-200">{w.adminUsername}</span> · {fmtTime(w.createdAt)}
                            </div>
                            <div className="text-sm mt-0.5 break-words">{w.reason}</div>
                          </div>
                          <button
                            onClick={() => removeWarning(w.id)}
                            className="text-[11px] text-gray-500 hover:text-white transition"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Messages */}
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                      Recent messages ({audit.messages.length})
                    </h3>
                    {audit.messages.length === 0 && (
                      <p className="text-xs text-gray-600">No messages found.</p>
                    )}
                    <div className="space-y-2">
                      {audit.messages.map((m: any) => (
                        <div key={m.id} className="glass rounded-xl px-3 py-2.5 flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] text-gray-500">
                              → {m.recipientUsername ?? "community"} · {fmtTime(m.createdAt)}
                              {m.editedAt ? " · edited" : ""}
                            </div>
                            {m.mediaRef && (
                              <div className="mt-1.5 flex items-center gap-2">
                                <span className="text-[10px] uppercase tracking-wide bg-white/10 rounded-full px-2 py-0.5 text-gray-300">
                                  {isVideo(m.mediaMime) ? "Video" : "Image"}
                                </span>
                                {isVideo(m.mediaMime) ? (
                                  <video
                                    src={`/api/media/${m.mediaRef}`}
                                    controls
                                    preload="metadata"
                                    className="h-20 rounded-lg border border-white/10 bg-black"
                                  />
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={`/api/media/${m.mediaRef}`}
                                    alt=""
                                    loading="lazy"
                                    className="h-20 rounded-lg border border-white/10 object-cover"
                                  />
                                )}
                              </div>
                            )}
                            <p className="text-sm mt-1 break-words">
                              {m.content?.startsWith("e2e:") ? "🔒 (encrypted)" : (m.content ?? "")}
                            </p>
                          </div>
                          <button
                            onClick={() => deleteMessage(m.id)}
                            className="text-[11px] text-red-400 hover:text-red-300 transition"
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Media audit */}
                  {audit.media.length > 0 && (
                    <div>
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                        Media sent ({audit.media.length})
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {audit.media.map((md, i) => (
                          <div key={i} className="relative">
                            {isVideo(md.mime) ? (
                              <video src={`/api/media/${md.ref}`} controls preload="metadata" className="w-24 h-24 rounded-lg border border-white/10 bg-black object-cover" />
                            ) : (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={`/api/media/${md.ref}`} alt="" loading="lazy" className="w-24 h-24 rounded-lg border border-white/10 object-cover" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Media review queue ── */}
              {tab === "reviews" && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-semibold">Media review queue</h2>
                    <button
                      onClick={() => void loadReviews()}
                      className="text-[11px] text-gray-400 hover:text-white transition px-2 py-1 rounded-lg hover:bg-white/10"
                    >
                      Refresh
                    </button>
                  </div>
                  {reviews.length === 0 && (
                    <p className="text-sm text-gray-600 py-10 text-center">Nothing pending — queue is clear.</p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {reviews.map((r) => (
                      <div key={r.id} className="glass rounded-2xl p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">
                              from <span className="text-white">@{r.senderUsername}</span>
                            </div>
                            <div className="text-[10px] text-gray-500 mt-0.5">
                              reported by @{r.reporterUsername ?? "?"} · {fmtTime(r.createdAt)}
                            </div>
                            <div className="text-xs text-gray-400 mt-2 line-clamp-2">“{r.reason}”</div>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={() => setSelectedMedia(r)}
                            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium transition active:scale-95"
                          >
                            Review
                          </button>
                          <button
                            onClick={() => reviewMedia(r, "keep")}
                            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium transition active:scale-95"
                          >
                            Keep
                          </button>
                          <button
                            onClick={() => reviewMedia(r, "delete")}
                            className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-medium transition active:scale-95"
                          >
                            Delete now
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Reports ── */}
              {tab === "reports" && (
                <div>
                  <h2 className="text-base font-semibold mb-4">Open message reports</h2>
                  {reports.length === 0 && (
                    <p className="text-sm text-gray-600 py-10 text-center">No open reports.</p>
                  )}
                  <div className="space-y-2">
                    {reports.map((r) => (
                      <div key={r.id} className="glass rounded-xl px-4 py-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-gray-500">
                            message #{r.messageId} · reported by user #{r.reporterId} · {fmtTime(r.createdAt)}
                          </div>
                          <div className="text-sm mt-1">“{r.reason}”</div>
                        </div>
                        <button
                          onClick={() => deleteMessage(r.messageId)}
                          className="text-[11px] text-red-400 hover:text-red-300 transition"
                        >
                          Delete message
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Audit log ── */}
              {tab === "log" && (
                <div>
                  <h2 className="text-base font-semibold mb-4">Audit log</h2>
                  {log.length === 0 && <p className="text-sm text-gray-600 py-10 text-center">No activity yet.</p>}
                  <div className="space-y-1.5">
                    {log.map((l) => (
                      <div key={l.id} className="flex items-start gap-3 text-xs rounded-lg px-3 py-2 hover:bg-white/5">
                        <span className="text-gray-500 font-mono shrink-0">{fmtTime(l.createdAt)}</span>
                        <span className="text-gray-400 shrink-0">{l.adminUsername}</span>
                        <span className="bg-white/10 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide shrink-0">
                          {l.action}
                        </span>
                        <span className="text-gray-200 shrink-0">@{l.targetUsername}</span>
                        {l.detail && <span className="text-gray-500 truncate">— {l.detail}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Media review viewer */}
      {selectedMedia && (
        <div
          className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedMedia(null)}
        >
          <div className="w-full max-w-lg glass-strong rounded-2xl p-5 animate-pop" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold">
                Reviewing media from <span className="text-white">@{selectedMedia.senderUsername}</span>
              </div>
              <button onClick={() => setSelectedMedia(null)} className="text-gray-500 hover:text-white transition">
                ✕
              </button>
            </div>
            <div className="text-[11px] text-gray-500 mb-3">Reason: “{selectedMedia.reason}”</div>
            <div className="rounded-xl overflow-hidden border border-white/10 bg-black flex items-center justify-center max-h-80">
              {isVideo(selectedMedia.mediaMime) ? (
                <video src={`/api/media/${selectedMedia.mediaRef}`} controls autoPlay className="max-h-80 w-full" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/media/${selectedMedia.mediaRef}`} alt="" className="max-h-80 w-full object-contain" />
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  reviewMedia(selectedMedia, "keep");
                  setSelectedMedia(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-medium transition active:scale-95"
              >
                Keep
              </button>
              <button
                onClick={() => {
                  reviewMedia(selectedMedia, "delete");
                  setSelectedMedia(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-medium transition active:scale-95"
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
