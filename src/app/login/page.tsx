"use client";
import { useState } from "react";
import Link from "next/link";
import Turnstile from "@/components/Turnstile";
import Background from "@/components/Background";
import { safeJson } from "@/lib/safeJson";

type Step = "credentials" | "totp";

export default function Login() {
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [cfToken, setCfToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [suspended, setSuspended] = useState<{ until: number; reason: string } | null>(null);
  const [appealText, setAppealText] = useState("");
  const [appealSent, setAppealSent] = useState(false);
  const [appealBusy, setAppealBusy] = useState(false);
  const [appealError, setAppealError] = useState<string | null>(null);

  const login = async () => {
    if (!email || !password) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember, turnstileToken: cfToken ?? undefined }),
      });
      const data = await safeJson<{ error?: string; requires2FA?: boolean; code?: string; bannedUntil?: number; banReason?: string }>(res);
      if (!res.ok) {
        if (data.code === "banned") {
          setSuspended({ until: data.bannedUntil ?? 0, reason: data.banReason ?? "No reason was provided." });
          return;
        }
        throw new Error(data.error || "Invalid credentials");
      }
      if (data.requires2FA) {
        setTotpCode("");
        setStep("totp");
      } else {
        window.location.href = "/chat";
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  const submitAppeal = async () => {
    if (!appealText.trim() || appealBusy) return;
    setAppealBusy(true);
    setAppealError(null);
    try {
      const res = await fetch("/api/moderation/appeal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account: email,
          reason: appealText.trim(),
          turnstileToken: cfToken ?? undefined,
        }),
      });
      const data = await safeJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to submit appeal");
      setAppealSent(true);
    } catch (err: unknown) {
      setAppealError(err instanceof Error ? err.message : "Failed to submit appeal");
    } finally {
      setAppealBusy(false);
    }
  };

  const verifyTotp = async () => {
    if (totpCode.length !== 6) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: totpCode }),
      });
      const data = await safeJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Invalid code");
      window.location.href = "/chat";
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-white/50 focus:shadow-[0_0_0_4px_rgba(255,255,255,0.12)] transition";

  return (
    <div className="min-h-screen flex items-center justify-center text-white px-4 relative">
      <Background />
      <div className="relative z-10 w-full max-w-md">
        <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
          ← Back to Aether
        </Link>

        <div className="mt-4 glass-strong rounded-3xl p-8">
          <div className="text-center mb-6">
            <div className="mx-auto mb-3 w-12 h-12 rounded-2xl bg-black border border-white/30 flex items-center justify-center text-2xl font-serif italic font-bold text-white shadow-lg shadow-black/50">
              A
            </div>
            <h1 className="text-2xl font-medium">
              {suspended ? "Account suspended" : step === "totp" ? "Two-factor authentication" : "Log in to Aether"}
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              {suspended && "This account can't sign in right now."}
              {!suspended && step === "credentials" && "Welcome back. Enter your details to continue."}
              {!suspended && step === "totp" && "Enter the 6-digit code from your authenticator app."}
            </p>
          </div>

          {suspended && (
            <div className="space-y-4 animate-in fade-in duration-500">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-lg" aria-hidden>
                  🚫
                </span>
                <div>
                  <div className="text-sm font-semibold">Your account is suspended</div>
                  <div className="text-[11px] text-gray-400">
                    {suspended.until > 0
                      ? `Suspended until ${new Date(suspended.until).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : "Suspended indefinitely"}
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 px-3.5 py-3 text-sm text-gray-300">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Reason</div>
                {suspended.reason}
              </div>

              {appealSent ? (
                <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-3 text-sm text-gray-200">
                  ✓ Your appeal has been submitted. An admin will review it — you&apos;ll be able to log in again if it&apos;s approved.
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">Appeal this suspension</div>
                    <textarea
                      value={appealText}
                      onChange={(e) => setAppealText(e.target.value)}
                      placeholder="Tell us what happened — you'll get a fair review."
                      rows={4}
                      maxLength={1000}
                      className="w-full px-3.5 py-3 bg-black/30 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/50 transition resize-none"
                    />
                  </div>
                  <Turnstile onToken={setCfToken} />
                  {appealError && <p className="text-sm text-red-300">{appealError}</p>}
                  <button
                    onClick={() => void submitAppeal()}
                    disabled={appealBusy || !appealText.trim()}
                    className="btn-glow w-full py-3 rounded-full bg-white text-black text-sm font-medium hover:brightness-110 transition disabled:opacity-40 disabled:shadow-none"
                  >
                    {appealBusy ? "Submitting…" : "Submit appeal"}
                  </button>
                </div>
              )}
            </div>
          )}

          {!suspended && step === "credentials" && (
            <div className="space-y-4">
              <input
                type="text"
                inputMode="email"
                placeholder="Email or username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && login()}
                autoComplete="username"
                className={inputClass}
              />
              <div className="relative">
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && login()}
                  autoComplete="current-password"
                  className={inputClass}
                />
                <Link
                  href="/forgot-password"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  Forgot?
                </Link>
              </div>

              <button
                type="button"
                role="checkbox"
                aria-checked={remember}
                onClick={() => setRemember(!remember)}
                className="group flex w-full items-center gap-2.5 text-left cursor-pointer select-none"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-200 ${
                    remember
                      ? "border-white bg-white shadow-[0_0_12px_rgba(255,255,255,0.35)]"
                      : "border-white/25 bg-black/30 group-hover:border-white/50 group-hover:bg-white/5 group-active:scale-90"
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#0a0a0a"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${
                      remember ? "scale-100" : "scale-0"
                    }`}
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <span className="text-sm text-gray-300 transition-colors group-hover:text-gray-200">
                  Remember me for 30 days
                </span>
              </button>

              <Turnstile onToken={setCfToken} />

              <button
                onClick={login}
                disabled={loading || !email || !password}
                className="btn-glow w-full py-3 rounded-full bg-white text-black font-medium hover:brightness-110 transition disabled:opacity-40 disabled:shadow-none"
              >
                {loading ? "Logging in..." : "Log in"}
              </button>
            </div>
          )}

          {!suspended && step === "totp" && (
            <div className="space-y-4 animate-in fade-in duration-500">
              <input
                type="text"
                inputMode="numeric"
                placeholder="Enter 6-digit code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && verifyTotp()}
                maxLength={6}
                autoFocus
                className={`${inputClass} tracking-[0.5em] text-center`}
              />
              <button
                onClick={verifyTotp}
                disabled={loading || totpCode.length !== 6}
                className="btn-glow w-full py-3 rounded-full bg-white text-black font-medium hover:brightness-110 transition disabled:opacity-40 disabled:shadow-none"
              >
                {loading ? "Verifying..." : "Log in"}
              </button>
              <p className="text-center text-sm text-gray-400">
                Lost your authenticator app?{" "}
                <Link href="/settings" className="text-white hover:underline">
                  Manage 2FA
                </Link>
              </p>
            </div>
          )}

          {error && <p className="text-white text-sm mt-4 text-center">{error}</p>}

          {step === "credentials" && (
            <p className="text-center text-sm text-gray-400 mt-6">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="text-white hover:underline">
                Create one
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
