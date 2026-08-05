"use client";
import { useState } from "react";
import Link from "next/link";

type Step = "credentials" | "totp";

export default function Login() {
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
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
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { error?: string; requires2FA?: boolean };
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
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Invalid code");
      window.location.href = "/chat";
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition";

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-4">
      <div className="w-full max-w-md">
        <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
          ← Back to Aether
        </Link>

        <div className="mt-4 bg-white/5 border border-white/10 rounded-2xl p-8 animate-in fade-in duration-700">
          <div className="text-center mb-6">
            <div className="text-3xl font-serif italic font-bold text-white/90 mb-2">A</div>
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
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && login()}
                autoComplete="current-password"
                className={inputClass}
              />
              <button
                onClick={login}
                disabled={loading || !email || !password}
                className="w-full py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition disabled:opacity-40"
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
                className="w-full py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition disabled:opacity-40"
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

          {error && <p className="text-red-400 text-sm mt-4 text-center">{error}</p>}

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
