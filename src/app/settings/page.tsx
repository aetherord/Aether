"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ensureKeyPair } from "@/lib/e2e";
import { safeJson } from "@/lib/safeJson";
import AvatarEditor from "@/components/AvatarEditor";

interface SessionUser {
  id: number;
  email: string;
  username: string;
  role?: string;
  avatar?: string | null;
}

type Privacy = "everyone" | "friends" | "nobody";
type Tab = "profile" | "account" | "privacy" | "security" | "notifications" | "media";

const inputCls =
  "w-full px-3.5 py-2.5 bg-black/30 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition";

export default function Settings() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("profile");

  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [privacy, setPrivacy] = useState<Privacy>("everyone");
  const [backupCodeCount, setBackupCodeCount] = useState(0);
  const [e2eReady, setE2eReady] = useState(false);

  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qrDataUrl: string | null } | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showManualSecret, setShowManualSecret] = useState(false);
  const [secretRevealed, setSecretRevealed] = useState(false);
  const [codePhase, setCodePhase] = useState(false);
  const secretRef = useRef<HTMLParagraphElement | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const [emailForm, setEmailForm] = useState({ email: "", currentPassword: "" });
  const [passForm, setPassForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [formBusy, setFormBusy] = useState<"email" | "password" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const [notifStatus, setNotifStatus] = useState<NotificationPermission | "unsupported">("unsupported");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [editorFile, setEditorFile] = useState<File | null>(null);

  const [mediaStats, setMediaStats] = useState<{ configured: boolean; pending?: number; synced?: number; total?: number } | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadMediaStats();
    fetch("/api/auth/session")
      .then(async (r) => ({
        status: r.status,
        data: await safeJson<{
          authenticated?: boolean;
          user?: SessionUser;
          twoFactorEnabled?: boolean;
        }>(r),
      }))
      .then(async ({ status, data }) => {
        if (!alive) return;
        if (status === 429) return; // rate-limited — stay put, don't log out
        if (!data.authenticated || !data.user) {
          router.replace("/login");
          return;
        }
        setUser(data.user);
        setTwoFactorEnabled(Boolean(data.twoFactorEnabled));
        setChecking(false);
        setNotifStatus(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
        try {
          const kp = await ensureKeyPair();
          setE2eReady(Boolean(kp?.pub));
        } catch {
          setE2eReady(false);
        }
        try {
          const p = await fetch("/api/settings/privacy");
          if (p.ok) {
            const pd = await safeJson<{ messagePrivacy?: Privacy }>(p);
            if (pd.messagePrivacy) setPrivacy(pd.messagePrivacy);
          }
        } catch {
          /* keep default */
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

  const api = useCallback(
    async (path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await safeJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      return data as Record<string, unknown>;
    },
    []
  );

  const loadMediaStats = useCallback(async () => {
    try {
      const res = await fetch("/api/media/status");
      if (!res.ok) return;
      const data = await safeJson<{ configured?: boolean; pending?: number; synced?: number; total?: number }>(res);
      setMediaStats({ configured: Boolean(data.configured), pending: data.pending, synced: data.synced, total: data.total });
      setMediaError(null);
    } catch {
      setMediaError("Could not reach the media archive.");
    }
  }, []);

  const refreshBackupCount = useCallback(async () => {
    if (!twoFactorEnabled) return;
    try {
      const res = await fetch("/api/auth/2fa/backup-codes/count");
      if (res.ok) {
        const d = await safeJson<{ count?: number }>(res);
        setBackupCodeCount(d.count ?? 0);
      }
    } catch {
      /* ignore */
    }
  }, [twoFactorEnabled]);

  useEffect(() => {
    void refreshBackupCount();
  }, [refreshBackupCount, twoFactorEnabled]);

  /* ── profile picture (crop/zoom/rotate in AvatarEditor) ───────────── */
  const onPickAvatar = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setEditorFile(file);
  };

  const uploadAvatar = (file: File) => {
    setAvatarBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    fetch("/api/settings/avatar", { method: "POST", body: form })
      .then(async (res) => {
        const data = await safeJson<{ error?: string; avatar?: string }>(res);
        if (!res.ok) throw new Error(data.error || "Upload failed");
        setUser((u) => (u ? { ...u, avatar: data.avatar ?? u.avatar } : u));
        setMessage("Profile picture updated.");
        setEditorFile(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Upload failed"))
      .finally(() => {
        setAvatarBusy(false);
        if (avatarInputRef.current) avatarInputRef.current.value = "";
      });
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    try {
      const res = await fetch("/api/settings/avatar", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove");
      setUser((u) => (u ? { ...u, avatar: null } : u));
      setMessage("Profile picture removed.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setAvatarBusy(false);
    }
  };

  /* ── 2FA (unchanged logic) ───────────────────────────────────────── */
  const startSetup = async () => {
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const data = (await api("/api/auth/2fa/setup")) as { secret: string; otpauthUrl: string; qrDataUrl?: string | null };
      setSetup({ secret: data.secret, otpauthUrl: data.otpauthUrl, qrDataUrl: data.qrDataUrl ?? null });
      setCode("");
      setShowManualSecret(false);
      setSecretRevealed(false);
      setCodePhase(false);
      setBackupCodes(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start setup");
    } finally {
      setLoading(false);
    }
  };

  const revealSecret = () => {
    setSecretRevealed(true);
    const el = secretRef.current;
    if (el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  };

  const enable = async () => {
    if (!code) return;
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const data = (await api("/api/auth/2fa/enable", { code })) as { backupCodes?: string[] };
      setTwoFactorEnabled(true);
      setSetup(null);
      setCode("");
      setBackupCodes(data.backupCodes ?? null);
      setBackupCodeCount(data.backupCodes?.length ?? 0);
      setMessage("Two-factor authentication is now enabled.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    if (!code) return;
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      await api("/api/auth/2fa/disable", { code });
      setTwoFactorEnabled(false);
      setCode("");
      setBackupCodeCount(0);
      setBackupCodes(null);
      setMessage("Two-factor authentication has been disabled.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  const changeEmail = async () => {
    if (!emailForm.email || !emailForm.currentPassword) return;
    setFormBusy("email");
    setFormError(null);
    setFormMessage(null);
    try {
      await api("/api/settings/email", { email: emailForm.email, currentPassword: emailForm.currentPassword });
      setUser((u) => (u ? { ...u, email: emailForm.email } : u));
      setEmailForm({ email: "", currentPassword: "" });
      setFormMessage("Email address updated. Other sessions were signed out.");
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to update email");
    } finally {
      setFormBusy(null);
    }
  };

  const changePassword = async () => {
    if (!passForm.currentPassword || !passForm.newPassword) return;
    if (passForm.newPassword !== passForm.confirm) {
      setFormError("New passwords do not match");
      return;
    }
    if (passForm.newPassword.length < 8) {
      setFormError("New password must be at least 8 characters");
      return;
    }
    setFormBusy("password");
    setFormError(null);
    setFormMessage(null);
    try {
      await api("/api/settings/password", { currentPassword: passForm.currentPassword, newPassword: passForm.newPassword });
      setPassForm({ currentPassword: "", newPassword: "", confirm: "" });
      setFormMessage("Password updated. Other sessions were signed out.");
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setFormBusy(null);
    }
  };

  const updatePrivacy = async (value: Privacy) => {
    setPrivacy(value);
    setFormError(null);
    setFormMessage(null);
    try {
      await api("/api/settings/privacy", { messagePrivacy: value });
      setFormMessage("Who can message you has been updated.");
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to update privacy");
    }
  };

  const askNotifications = async () => {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    setNotifStatus(perm);
  };

  const logout = async () => {
    await fetch("/api/auth/session", { method: "POST" });
    router.replace("/");
  };

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "profile", label: "Profile", icon: "◉" },
    { id: "account", label: "Account", icon: "◎" },
    { id: "privacy", label: "Privacy", icon: "🛡" },
    { id: "security", label: "Security", icon: "🔐" },
    { id: "notifications", label: "Notifications", icon: "🔔" },
    { id: "media", label: "Media archive", icon: "🗂" },
  ];

  const avatarUrl = user?.avatar ? `/api/media/${user.avatar}` : null;

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-4">
        <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Link href="/chat" className="text-sm text-gray-400 hover:text-white transition-colors">
            ← Back to chat
          </Link>
          <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
            Home
          </Link>
        </div>

        <div className="flex flex-col md:flex-row gap-6">
          {/* Nav */}
          <nav className="md:w-56 shrink-0">
            <div className="flex items-center gap-3 mb-5 px-1">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="avatar" className="w-10 h-10 rounded-full object-cover border border-white/10" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-lg font-bold">
                  {user?.username.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">@{user?.username}</div>
                <div className="text-[11px] text-gray-500 truncate">{user?.email}</div>
              </div>
            </div>
            <div className="flex md:flex-col gap-1 overflow-x-auto pb-2 md:pb-0">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`shrink-0 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm transition text-left ${
                    tab === t.id ? "bg-white/10 text-white" : "text-gray-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span className="w-4 text-center">{t.icon}</span>
                  <span className="font-medium">{t.label}</span>
                </button>
              ))}
            </div>
            <button
              onClick={logout}
              className="mt-4 w-full py-2.5 rounded-xl border border-white/15 text-sm text-gray-300 hover:text-white hover:border-white/40 transition"
            >
              Log out
            </button>
          </nav>

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-5">
            {(error || message || formError || formMessage) && (
              <div className="space-y-2">
                {error && <p className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-xl px-4 py-2.5">{error}</p>}
                {formError && <p className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-xl px-4 py-2.5">{formError}</p>}
                {message && <p className="text-sm text-green-400 bg-green-950/40 border border-green-900/50 rounded-xl px-4 py-2.5">{message}</p>}
                {formMessage && <p className="text-sm text-green-400 bg-green-950/40 border border-green-900/50 rounded-xl px-4 py-2.5">{formMessage}</p>}
              </div>
            )}

            {/* Profile */}
            {tab === "profile" && (
              <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h2 className="font-semibold text-lg">Profile picture</h2>
                <p className="text-sm text-gray-400 mt-0.5 mb-5">Pick a photo, then drag, zoom and rotate to frame it — everyone sees it next to your name.</p>
                <div className="flex items-center gap-5">
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt="avatar" className="w-20 h-20 rounded-full object-cover border border-white/10" />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-3xl font-bold">
                      {user?.username.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="space-y-2">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => onPickAvatar(e.target.files?.[0])}
                    />
                    <button
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={avatarBusy}
                      className="block px-5 py-2.5 rounded-full bg-white text-black text-sm font-medium hover:bg-gray-200 transition disabled:opacity-40"
                    >
                      {avatarBusy ? "Saving…" : "Change photo"}
                    </button>
                    {user?.avatar && (
                      <button
                        onClick={() => void removeAvatar()}
                        disabled={avatarBusy}
                        className="block text-sm text-gray-400 hover:text-red-400 transition disabled:opacity-40"
                      >
                        Remove photo
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-5 text-xs text-gray-600">
                  Photos are encrypted at rest and served only to you and people you chat with. PNG, JPEG, WebP or GIF, max 2 MB.
                </p>
              </section>
            )}

            {/* Account */}
            {tab === "account" && (
              <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h2 className="font-semibold text-lg mb-1">Account</h2>
                <p className="text-sm text-gray-400 mb-5">Update your email and password. Changing either signs out your other sessions.</p>
                <div className="space-y-6">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Email address</label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input type="email" value={emailForm.email} onChange={(e) => setEmailForm((f) => ({ ...f, email: e.target.value }))} placeholder="new@example.com" className={inputCls} />
                      <input type="password" value={emailForm.currentPassword} onChange={(e) => setEmailForm((f) => ({ ...f, currentPassword: e.target.value }))} placeholder="Current password" className={inputCls} />
                    </div>
                    <button
                      onClick={() => void changeEmail()}
                      disabled={formBusy !== null || !emailForm.email || !emailForm.currentPassword}
                      className="mt-2.5 px-5 py-2.5 rounded-full bg-white text-black text-sm font-medium hover:bg-gray-200 transition disabled:opacity-40"
                    >
                      {formBusy === "email" ? "Saving…" : "Update email"}
                    </button>
                  </div>
                  <div className="h-px bg-white/10" />
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Password</label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input type="password" value={passForm.currentPassword} onChange={(e) => setPassForm((f) => ({ ...f, currentPassword: e.target.value }))} placeholder="Current password" className={inputCls} />
                      <input type="password" value={passForm.newPassword} onChange={(e) => setPassForm((f) => ({ ...f, newPassword: e.target.value }))} placeholder="New password" className={inputCls} />
                      <input type="password" value={passForm.confirm} onChange={(e) => setPassForm((f) => ({ ...f, confirm: e.target.value }))} placeholder="Confirm new" className={inputCls} />
                    </div>
                    <button
                      onClick={() => void changePassword()}
                      disabled={formBusy !== null || !passForm.currentPassword || !passForm.newPassword}
                      className="mt-2.5 px-5 py-2.5 rounded-full bg-white text-black text-sm font-medium hover:bg-gray-200 transition disabled:opacity-40"
                    >
                      {formBusy === "password" ? "Saving…" : "Update password"}
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* Privacy */}
            {tab === "privacy" && (
              <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h2 className="font-semibold text-lg mb-1">Who can message you</h2>
                <p className="text-sm text-gray-400 mb-5">Control who can send you direct messages.</p>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { value: "everyone", label: "Everyone", desc: "Any verified user" },
                      { value: "friends", label: "Friends", desc: "Only your friends" },
                      { value: "nobody", label: "Nobody", desc: "Block all DMs" },
                    ] as { value: Privacy; label: string; desc: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => void updatePrivacy(opt.value)}
                      className={`rounded-xl border px-3 py-3 text-left transition ${
                        privacy === opt.value ? "border-white/40 bg-white/10" : "border-white/10 bg-black/20 hover:border-white/25"
                      }`}
                    >
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Security */}
            {tab === "security" && (
              <>
                <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-semibold text-lg">Two-factor authentication</h2>
                      <p className="text-sm text-gray-400 mt-0.5">
                        {twoFactorEnabled ? `Enabled — ${backupCodeCount} backup code${backupCodeCount === 1 ? "" : "s"} remaining.` : "Off — add an extra layer of security with TOTP."}
                      </p>
                    </div>
                    <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium ${twoFactorEnabled ? "bg-green-500/15 text-green-400" : "bg-white/10 text-gray-400"}`}>
                      {twoFactorEnabled ? "ON" : "OFF"}
                    </span>
                  </div>

                  {!twoFactorEnabled && !setup && (
                    <button onClick={startSetup} disabled={loading} className="mt-5 w-full py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition disabled:opacity-50">
                      {loading ? "Generating..." : "Set up 2FA"}
                    </button>
                  )}

                  {!twoFactorEnabled && setup && !codePhase && (
                    <div className="mt-5 space-y-4 animate-in fade-in duration-500">
                      {!showManualSecret ? (
                        <>
                          {setup.qrDataUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={setup.qrDataUrl} alt="2FA QR code" className="mx-auto h-44 w-44 rounded-lg bg-white p-2" />
                          ) : (
                            <p className="text-center text-xs text-gray-500 break-all">{setup.otpauthUrl}</p>
                          )}
                          <button onClick={() => { setShowManualSecret(true); setSecretRevealed(false); }} className="mx-auto block text-sm text-gray-400 underline underline-offset-2 hover:text-white transition-colors">
                            Can&apos;t scan the code? Enter it manually
                          </button>
                        </>
                      ) : (
                        <div className="text-center">
                          <p className="text-sm text-gray-300 mb-2">Open your authenticator app and add this key:</p>
                          <p
                            ref={secretRef}
                            role="button"
                            tabIndex={0}
                            onClick={revealSecret}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); revealSecret(); } }}
                            title={secretRevealed ? "Click to select the key" : "Click to reveal the key"}
                            className={`mx-auto break-all rounded-lg border px-3 py-2.5 font-mono text-sm tracking-widest transition-all duration-300 ${
                              secretRevealed ? "border-white/30 bg-black/40 text-white select-all cursor-text" : "border-white/10 bg-black/30 text-white blur-[5px] cursor-pointer select-none hover:border-white/30"
                            }`}
                          >
                            {setup.secret}
                          </p>
                          <p className="mt-2 text-xs text-gray-500">
                            {secretRevealed ? "Key selected — copy it or type it into your app." : "Click the key above to reveal it."}
                          </p>
                        </div>
                      )}
                      <button onClick={() => setCodePhase(true)} className="w-full py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition">
                        Next
                      </button>
                      {showManualSecret && (
                        <button onClick={() => setShowManualSecret(false)} className="mx-auto block text-sm text-gray-400 underline underline-offset-2 hover:text-white transition-colors">
                          ← Back to QR code
                        </button>
                      )}
                    </div>
                  )}

                  {!twoFactorEnabled && setup && codePhase && (
                    <div className="mt-5 space-y-4 animate-in fade-in duration-500">
                      <p className="text-sm text-gray-300">Enter the 6-digit code from your authenticator app.</p>
                      <input type="text" inputMode="numeric" placeholder="Enter 6-digit code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} autoFocus className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition tracking-[0.5em] text-center" />
                      <div className="flex gap-3">
                        <button onClick={enable} disabled={loading || code.length !== 6} className="flex-1 py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition disabled:opacity-40">
                          {loading ? "Verifying..." : "Enable"}
                        </button>
                        <button onClick={() => setCodePhase(false)} disabled={loading} className="px-5 py-3 rounded-full border border-white/20 text-gray-300 hover:text-white hover:border-white/50 transition">
                          Back
                        </button>
                      </div>
                    </div>
                  )}

                  {twoFactorEnabled && !backupCodes && (
                    <div className="mt-5 space-y-3">
                      <p className="text-sm text-gray-400">To disable, enter the current code from your authenticator app (or a backup code).</p>
                      <input type="text" inputMode="numeric" placeholder="Enter 6-digit code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition" />
                      <button onClick={disable} disabled={loading || code.length !== 6} className="w-full py-3 rounded-full border border-red-500/40 text-red-400 hover:bg-red-500/10 transition disabled:opacity-40">
                        {loading ? "Verifying..." : "Disable 2FA"}
                      </button>
                    </div>
                  )}

                  {backupCodes && (
                    <div className="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/5 p-5 animate-in fade-in duration-500">
                      <h3 className="font-medium text-amber-300">Backup codes</h3>
                      <p className="text-sm text-gray-400 mt-1">
                        Save these now. Each works once in place of your authenticator code, and they won&apos;t be shown again.
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {backupCodes.map((c) => (
                          <code key={c} className="rounded-lg bg-black/40 border border-white/10 px-3 py-2 font-mono text-sm text-white text-center select-all">
                            {c}
                          </code>
                        ))}
                      </div>
                      <button onClick={() => setBackupCodes(null)} className="mt-4 w-full py-2.5 rounded-full bg-amber-400 text-black text-sm font-medium hover:bg-amber-300 transition">
                        I saved my codes
                      </button>
                    </div>
                  )}
                </section>

                {/* E2E status */}
                <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-semibold text-lg">End-to-end encryption</h2>
                      <p className="text-sm text-gray-400 mt-0.5">
                        Direct messages are encrypted on your device before they ever reach the server. Even Aether can&apos;t read them.
                      </p>
                    </div>
                    <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium ${e2eReady ? "bg-emerald-500/15 text-emerald-400" : "bg-white/10 text-gray-400"}`}>
                      {e2eReady ? "ACTIVE" : "SETUP"}
                    </span>
                  </div>
                  <p className="mt-4 text-xs text-gray-600 leading-relaxed">
                    Your private key never leaves this device. Passwords are hashed with PBKDF2-SHA256 (100k iterations), verification codes and
                    backup codes are stored as salted SHA-256 hashes, and every image/video is encrypted at rest with AES-256-GCM.
                  </p>
                </section>
              </>
            )}

            {/* Notifications */}
            {tab === "notifications" && (
              <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h2 className="font-semibold text-lg mb-1">Desktop notifications</h2>
                <p className="text-sm text-gray-400 mb-5">Get a notification when someone messages you while the tab is in the background.</p>
                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3.5">
                  <div>
                    <div className="text-sm font-medium">
                      {notifStatus === "granted" ? "Notifications enabled" : notifStatus === "denied" ? "Notifications blocked" : notifStatus === "unsupported" ? "Not supported in this browser" : "Notifications not enabled"}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {notifStatus === "granted" ? "New messages will appear on your desktop." : "Allow notifications to get message alerts."}
                    </div>
                  </div>
                  {notifStatus !== "granted" && notifStatus !== "unsupported" && (
                    <button onClick={() => void askNotifications()} className="shrink-0 px-5 py-2.5 rounded-full bg-white text-black text-sm font-medium hover:bg-gray-200 transition">
                      Enable
                    </button>
                  )}
                </div>
              </section>
            )}

            {/* Media */}
            {tab === "media" && (
              <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-lg">Media archive</h2>
                    <p className="text-sm text-gray-400 mt-0.5">Images and videos are encrypted in the cloud, then mirrored to your D: drive.</p>
                  </div>
                  <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium ${mediaStats?.configured ? "bg-green-500/15 text-green-400" : "bg-white/10 text-gray-400"}`}>
                    {mediaStats?.configured ? "LIVE" : "SETUP"}
                  </span>
                </div>
                {mediaStats?.configured ? (
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-white/5 border border-white/10 py-3">
                      <div className="text-xl font-semibold">{mediaStats.total ?? 0}</div>
                      <div className="text-[11px] text-gray-500 uppercase tracking-wide">Total</div>
                    </div>
                    <div className="rounded-lg bg-white/5 border border-white/10 py-3">
                      <div className="text-xl font-semibold">{mediaStats.synced ?? 0}</div>
                      <div className="text-[11px] text-gray-500 uppercase tracking-wide">On drive</div>
                    </div>
                    <div className="rounded-lg bg-white/5 border border-white/10 py-3">
                      <div className="text-xl font-semibold text-amber-400">{mediaStats.pending ?? 0}</div>
                      <div className="text-[11px] text-gray-500 uppercase tracking-wide">Queued</div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-gray-500">{mediaError ?? "Media storage is not configured yet (set TURSO_URL and TURSO_AUTH_TOKEN)."}</p>
                )}
                <p className="mt-4 text-xs text-gray-600 leading-relaxed">
                  To pull queued media onto your PC, run <code className="text-gray-400">npm run sync-media</code> while your D: SSD is online, or{" "}
                  <code className="text-gray-400">npm run install-auto-sync</code> once to have it happen automatically every 5 minutes. It sorts everything
                  into <code className="text-gray-400">sender/recipient</code> folders with an 80 GB cap.
                </p>
              </section>
            )}
          </div>
        </div>
      </div>

      {editorFile && (
        <AvatarEditor
          file={editorFile}
          busy={avatarBusy}
          onCancel={() => setEditorFile(null)}
          onDone={(f) => void uploadAvatar(f)}
        />
      )}
    </div>
  );
}
