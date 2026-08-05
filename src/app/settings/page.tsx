"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface SessionUser {
  id: number;
  email: string;
  username: string;
  role?: string;
}

type Privacy = "everyone" | "friends" | "nobody";

export default function Settings() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [privacy, setPrivacy] = useState<Privacy>("everyone");
  const [backupCodeCount, setBackupCodeCount] = useState(0);

  const [setup, setSetup] = useState<{
    secret: string;
    otpauthUrl: string;
    qrDataUrl: string | null;
  } | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showManualSecret, setShowManualSecret] = useState(false);
  const [secretRevealed, setSecretRevealed] = useState(false);
  const [codePhase, setCodePhase] = useState(false);
  const secretRef = useRef<HTMLParagraphElement | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  // Account forms
  const [emailForm, setEmailForm] = useState({ email: "", currentPassword: "" });
  const [passForm, setPassForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [formBusy, setFormBusy] = useState<"email" | "password" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const [mediaStats, setMediaStats] = useState<{
    configured: boolean;
    pending?: number;
    synced?: number;
    total?: number;
  } | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadMediaStats();
    fetch("/api/auth/session")
      .then((r) => r.json() as Promise<{
        authenticated?: boolean;
        user?: { id: number; email: string; username: string; role?: string };
        twoFactorEnabled?: boolean;
      }>)
      .then(async (data) => {
        if (!alive) return;
        if (!data.authenticated || !data.user) {
          router.replace("/login");
          return;
        }
        setUser(data.user);
        setTwoFactorEnabled(Boolean(data.twoFactorEnabled));
        setChecking(false);
        try {
          const p = await fetch("/api/settings/privacy");
          if (p.ok) {
            const pd = (await p.json()) as { messagePrivacy?: Privacy };
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
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      return data as Record<string, unknown>;
    },
    []
  );

  const loadMediaStats = useCallback(async () => {
    try {
      const res = await fetch("/api/media/status");
      if (!res.ok) return;
      const data = (await res.json()) as {
        configured?: boolean;
        pending?: number;
        synced?: number;
        total?: number;
      };
      setMediaStats({
        configured: Boolean(data.configured),
        pending: data.pending,
        synced: data.synced,
        total: data.total,
      });
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
        const d = (await res.json()) as { count?: number };
        setBackupCodeCount(d.count ?? 0);
      }
    } catch {
      /* ignore */
    }
  }, [twoFactorEnabled]);

  useEffect(() => {
    void refreshBackupCount();
  }, [refreshBackupCount, twoFactorEnabled]);

  const startSetup = async () => {
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const data = (await api("/api/auth/2fa/setup")) as {
        secret: string;
        otpauthUrl: string;
        qrDataUrl?: string | null;
      };
      setSetup({
        secret: data.secret,
        otpauthUrl: data.otpauthUrl,
        qrDataUrl: data.qrDataUrl ?? null,
      });
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
      const data = (await api("/api/auth/2fa/enable", { code })) as {
        backupCodes?: string[];
      };
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
      await api("/api/settings/email", {
        email: emailForm.email,
        currentPassword: emailForm.currentPassword,
      });
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
      await api("/api/settings/password", {
        currentPassword: passForm.currentPassword,
        newPassword: passForm.newPassword,
      });
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

  const logout = async () => {
    await fetch("/api/auth/session", { method: "POST" });
    router.replace("/");
  };

  const inputCls =
    "w-full px-3.5 py-2.5 bg-black/30 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition";

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-4">
        <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <Link href="/chat" className="text-sm text-gray-400 hover:text-white transition-colors">
          ← Back to chat
        </Link>

        <div className="mt-4 flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-2xl font-bold">
            {user?.username.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-semibold">@{user?.username}</h1>
            <p className="text-sm text-gray-400 break-all">{user?.email}</p>
          </div>
          {user?.role === "admin" && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5">
              Admin
            </span>
          )}
        </div>

        <div className="h-px bg-white/10 my-6" />

        {/* Who can message you */}
        <section className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="font-medium">Who can message you</h2>
          <p className="text-sm text-gray-400 mt-0.5 mb-4">
            Control who can send you direct messages.
          </p>
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
                  privacy === opt.value
                    ? "border-white/40 bg-white/10"
                    : "border-white/10 bg-black/20 hover:border-white/25"
                }`}
              >
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{opt.desc}</div>
              </button>
            ))}
          </div>
        </section>

        {/* Account */}
        <section className="mt-5 rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="font-medium mb-4">Account</h2>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Email address</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={emailForm.email}
                  onChange={(e) => setEmailForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="new@example.com"
                  className={inputCls}
                />
                <input
                  type="password"
                  value={emailForm.currentPassword}
                  onChange={(e) => setEmailForm((f) => ({ ...f, currentPassword: e.target.value }))}
                  placeholder="Current password"
                  className={inputCls}
                />
              </div>
              <button
                onClick={() => void changeEmail()}
                disabled={formBusy !== null || !emailForm.email || !emailForm.currentPassword}
                className="mt-2 px-5 py-2.5 rounded-full bg-white text-black text-sm font-medium hover:bg-gray-200 transition disabled:opacity-40"
              >
                {formBusy === "email" ? "Saving…" : "Update email"}
              </button>
            </div>

            <div className="h-px bg-white/10" />

            <div>
              <label className="block text-xs text-gray-400 mb-1">Password</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={passForm.currentPassword}
                  onChange={(e) => setPassForm((f) => ({ ...f, currentPassword: e.target.value }))}
                  placeholder="Current password"
                  className={inputCls}
                />
                <input
                  type="password"
                  value={passForm.newPassword}
                  onChange={(e) => setPassForm((f) => ({ ...f, newPassword: e.target.value }))}
                  placeholder="New password"
                  className={inputCls}
                />
                <input
                  type="password"
                  value={passForm.confirm}
                  onChange={(e) => setPassForm((f) => ({ ...f, confirm: e.target.value }))}
                  placeholder="Confirm new"
                  className={inputCls}
                />
              </div>
              <button
                onClick={() => void changePassword()}
                disabled={formBusy !== null || !passForm.currentPassword || !passForm.newPassword}
                className="mt-2 px-5 py-2.5 rounded-full bg-white text-black text-sm font-medium hover:bg-gray-200 transition disabled:opacity-40"
              >
                {formBusy === "password" ? "Saving…" : "Update password"}
              </button>
            </div>
          </div>
        </section>

        {/* 2FA + backup codes */}
        <section className="mt-5 rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium">Two-factor authentication</h2>
              <p className="text-sm text-gray-400 mt-0.5">
                {twoFactorEnabled
                  ? `Enabled — ${backupCodeCount} backup code${backupCodeCount === 1 ? "" : "s"} remaining.`
                  : "Off — add an extra layer of security with TOTP."}
              </p>
            </div>
            <span
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium ${
                twoFactorEnabled ? "bg-green-500/15 text-green-400" : "bg-white/10 text-gray-400"
              }`}
            >
              {twoFactorEnabled ? "ON" : "OFF"}
            </span>
          </div>

          {!twoFactorEnabled && !setup && (
            <button
              onClick={startSetup}
              disabled={loading}
              className="mt-5 w-full py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition disabled:opacity-50"
            >
              {loading ? "Generating..." : "Set up 2FA"}
            </button>
          )}

          {!twoFactorEnabled && setup && !codePhase && (
            <div className="mt-5 space-y-4 animate-in fade-in duration-500">
              {!showManualSecret ? (
                <>
                  {setup.qrDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={setup.qrDataUrl}
                      alt="2FA QR code"
                      className="mx-auto h-44 w-44 rounded-lg bg-white p-2"
                    />
                  ) : (
                    <p className="text-center text-xs text-gray-500 break-all">
                      {setup.otpauthUrl}
                    </p>
                  )}
                  <button
                    onClick={() => {
                      setShowManualSecret(true);
                      setSecretRevealed(false);
                    }}
                    className="mx-auto block text-sm text-gray-400 underline underline-offset-2 hover:text-white transition-colors"
                  >
                    Can&apos;t scan the code? Enter it manually
                  </button>
                </>
              ) : (
                <div className="text-center">
                  <p className="text-sm text-gray-300 mb-2">
                    Open your authenticator app and add this key:
                  </p>
                  <p
                    ref={secretRef}
                    role="button"
                    tabIndex={0}
                    onClick={revealSecret}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        revealSecret();
                      }
                    }}
                    title={secretRevealed ? "Click to select the key" : "Click to reveal the key"}
                    className={`mx-auto break-all rounded-lg border px-3 py-2.5 font-mono text-sm tracking-widest transition-all duration-300 ${
                      secretRevealed
                        ? "border-white/30 bg-black/40 text-white select-all cursor-text"
                        : "border-white/10 bg-black/30 text-white blur-[5px] cursor-pointer select-none hover:border-white/30"
                    }`}
                  >
                    {setup.secret}
                  </p>
                  <p className="mt-2 text-xs text-gray-500">
                    {secretRevealed
                      ? "Key selected — copy it or type it into your app."
                      : "Click the key above to reveal it."}
                  </p>
                </div>
              )}

              <button
                onClick={() => setCodePhase(true)}
                className="w-full py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition"
              >
                Next
              </button>
              {showManualSecret && (
                <button
                  onClick={() => setShowManualSecret(false)}
                  className="mx-auto block text-sm text-gray-400 underline underline-offset-2 hover:text-white transition-colors"
                >
                  ← Back to QR code
                </button>
              )}
            </div>
          )}

          {!twoFactorEnabled && setup && codePhase && (
            <div className="mt-5 space-y-4 animate-in fade-in duration-500">
              <p className="text-sm text-gray-300">
                Enter the 6-digit code from your authenticator app.
              </p>
              <input
                type="text"
                inputMode="numeric"
                placeholder="Enter 6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                autoFocus
                className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition tracking-[0.5em] text-center"
              />
              <div className="flex gap-3">
                <button
                  onClick={enable}
                  disabled={loading || code.length !== 6}
                  className="flex-1 py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition disabled:opacity-40"
                >
                  {loading ? "Verifying..." : "Enable"}
                </button>
                <button
                  onClick={() => setCodePhase(false)}
                  disabled={loading}
                  className="px-5 py-3 rounded-full border border-white/20 text-gray-300 hover:text-white hover:border-white/50 transition"
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {twoFactorEnabled && !backupCodes && (
            <div className="mt-5 space-y-3">
              <p className="text-sm text-gray-400">
                To disable, enter the current code from your authenticator app (or a backup code).
              </p>
              <input
                type="text"
                inputMode="numeric"
                placeholder="Enter 6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition"
              />
              <button
                onClick={disable}
                disabled={loading || code.length !== 6}
                className="w-full py-3 rounded-full border border-red-500/40 text-red-400 hover:bg-red-500/10 transition disabled:opacity-40"
              >
                {loading ? "Verifying..." : "Disable 2FA"}
              </button>
            </div>
          )}

          {/* Backup codes — shown exactly once, right after enabling */}
          {backupCodes && (
            <div className="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/5 p-5 animate-in fade-in duration-500">
              <h3 className="font-medium text-amber-300">Backup codes</h3>
              <p className="text-sm text-gray-400 mt-1">
                Save these now. Each works once in place of your authenticator code, and they
                won&apos;t be shown again.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {backupCodes.map((c) => (
                  <code
                    key={c}
                    className="rounded-lg bg-black/40 border border-white/10 px-3 py-2 font-mono text-sm text-white text-center select-all"
                  >
                    {c}
                  </code>
                ))}
              </div>
              <button
                onClick={() => setBackupCodes(null)}
                className="mt-4 w-full py-2.5 rounded-full bg-amber-400 text-black text-sm font-medium hover:bg-amber-300 transition"
              >
                I saved my codes
              </button>
            </div>
          )}

          {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
          {message && <p className="text-green-400 text-sm mt-4">{message}</p>}
        </section>

        {/* Media archive */}
        <section className="mt-5 rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium">Media archive</h2>
              <p className="text-sm text-gray-400 mt-0.5">
                Images and videos you share are stored in the cloud, then mirrored to your D: drive.
              </p>
            </div>
            <span
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium ${
                mediaStats?.configured ? "bg-green-500/15 text-green-400" : "bg-white/10 text-gray-400"
              }`}
            >
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
            <p className="mt-4 text-sm text-gray-500">
              {mediaError ?? "Media storage is not configured yet (set TURSO_URL and TURSO_AUTH_TOKEN)."}
            </p>
          )}

          <p className="mt-4 text-xs text-gray-600 leading-relaxed">
            To pull queued media onto your PC, run{" "}
            <code className="text-gray-400">npm run sync-media</code> while your D: SSD is online, or{" "}
            <code className="text-gray-400">npm run install-auto-sync</code> once to have it happen
            automatically every 5 minutes. It sorts everything into{" "}
            <code className="text-gray-400">sender/recipient</code> folders with an 80 GB cap.
          </p>
        </section>

        {formError && <p className="text-red-400 text-sm mt-4">{formError}</p>}
        {formMessage && <p className="text-green-400 text-sm mt-4">{formMessage}</p>}

        <button
          onClick={logout}
          className="mt-6 w-full py-3 rounded-full border border-white/20 text-gray-300 hover:text-white hover:border-white/50 transition"
        >
          Log out
        </button>
      </div>
    </div>
  );
}
