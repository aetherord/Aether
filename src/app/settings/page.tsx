"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface SessionUser {
  id: number;
  email: string;
  username: string;
}

export default function Settings() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

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
        user?: { id: number; email: string; username: string };
        twoFactorEnabled?: boolean;
      }>)
      .then((data) => {
        if (!alive) return;
        if (!data.authenticated || !data.user) {
          router.replace("/login");
          return;
        }
        setUser(data.user);
        setTwoFactorEnabled(Boolean(data.twoFactorEnabled));
        setChecking(false);
      })
      .catch(() => {
        if (alive) router.replace("/login");
      });
    return () => {
      alive = false;
    };
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

  const enable = async () => {
    if (!code) return;
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      await api("/api/auth/2fa/enable", { code });
      setTwoFactorEnabled(true);
      setSetup(null);
      setCode("");
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
      setMessage("Two-factor authentication has been disabled.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/session", { method: "POST" });
    router.replace("/");
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-4">
        <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
          ← Back
        </Link>

        <div className="mt-4 bg-white/5 border border-white/10 rounded-2xl p-8 animate-in fade-in duration-700">
          <h1 className="text-2xl font-medium">Account settings</h1>
          <p className="text-sm text-gray-400 mt-1 break-all">
            @{user?.username} · {user?.email}
          </p>
          <div className="h-px bg-white/10 my-6" />

          {/* 2FA section */}
          <div className="rounded-xl border border-white/10 bg-black/20 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-medium">Two-factor authentication</h2>
                <p className="text-sm text-gray-400 mt-0.5">
                  {twoFactorEnabled
                    ? "Enabled — a code from your authenticator app is required to log in."
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
                      aria-hidden={!secretRevealed ? true : undefined}
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

                <button onClick={() => setCodePhase(true)} className="w-full py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition">
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

            {twoFactorEnabled && (
              <div className="mt-5 space-y-3">
                <p className="text-sm text-gray-400">
                  To disable, enter the current code from your authenticator app.
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

            {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
            {message && <p className="text-green-400 text-sm mt-4">{message}</p>}
          </div>

          {/* Media archive section */}
          <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-medium">Media archive</h2>
                <p className="text-sm text-gray-400 mt-0.5">
                  Images and videos you share are stored in the cloud, then mirrored to your D: drive.
                </p>
              </div>
              <span
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium ${
                  mediaStats?.configured
                    ? "bg-green-500/15 text-green-400"
                    : "bg-white/10 text-gray-400"
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
              <code className="text-gray-400">npm run sync-media</code> while your D: SSD is online.
              It sorts everything into <code className="text-gray-400">sender/recipient</code> folders with an 80 GB cap.
            </p>
          </div>

          <button
            onClick={logout}
            className="mt-6 w-full py-3 rounded-full border border-white/20 text-gray-300 hover:text-white hover:border-white/50 transition"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
