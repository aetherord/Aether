"use client";

import { useCallback, useEffect, useState } from "react";
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

  useEffect(() => {
    let alive = true;
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start setup");
    } finally {
      setLoading(false);
    }
  };

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

            {!twoFactorEnabled && setup && (
              <div className="mt-5 space-y-4 animate-in fade-in duration-500">
                <p className="text-sm text-gray-300">
                  Scan the QR code with your authenticator app, or enter the code manually:
                </p>
                {setup.qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={setup.qrDataUrl}
                    alt="2FA QR code"
                    className="mx-auto h-44 w-44 rounded-lg bg-white p-2"
                  />
                ) : (
                  <p className="text-center text-xs text-gray-500 break-all">{setup.otpauthUrl}</p>
                )}
                <p className="text-center text-xs text-gray-500 select-all break-all">
                  Secret: {setup.secret}
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
                <div className="flex gap-3">
                  <button
                    onClick={enable}
                    disabled={loading || code.length !== 6}
                    className="flex-1 py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition disabled:opacity-40"
                  >
                    {loading ? "Verifying..." : "Enable"}
                  </button>
                  <button
                    onClick={() => setSetup(null)}
                    disabled={loading}
                    className="px-5 py-3 rounded-full border border-white/20 text-gray-300 hover:text-white hover:border-white/50 transition"
                  >
                    Cancel
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
