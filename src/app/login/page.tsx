"use client";
import { useState } from "react";
import Link from "next/link";
import Background from "@/components/Background";
import { safeJson } from "@/lib/safeJson";

type Step = "credentials" | "totp";

export default function Login() {
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const login = async () => {
    if (!email || !password) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember }),
      });
      const data = await safeJson<{ error?: string; requires2FA?: boolean }>(res);
      if (!res.ok) throw new Error(data.error || "Invalid credentials");
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
              {step === "totp" ? "Two-factor authentication" : "Log in to Aether"}
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              {step === "credentials" && "Welcome back. Enter your details to continue."}
              {step === "totp" && "Enter the 6-digit code from your authenticator app."}
            </p>
          </div>

          {step === "credentials" && (
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

              <button
                onClick={login}
                disabled={loading || !email || !password}
                className="btn-glow w-full py-3 rounded-full bg-white text-black font-medium hover:brightness-110 transition disabled:opacity-40 disabled:shadow-none"
              >
                {loading ? "Logging in..." : "Log in"}
              </button>
            </div>
          )}

          {step === "totp" && (
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
