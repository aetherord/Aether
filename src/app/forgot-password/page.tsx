"use client";
import { useState } from "react";
import Link from "next/link";
import Turnstile from "@/components/Turnstile";
import Background from "@/components/Background";
import { safeJson } from "@/lib/safeJson";

type Step = "email" | "reset" | "done";

export default function ForgotPassword() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [cfToken, setCfToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    if (!email) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken: cfToken ?? undefined }),
      });
      const data = await safeJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to send reset code");
      setStep("reset");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send reset code");
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    if (code.length !== 6 || password.length < 8) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, password, turnstileToken: cfToken ?? undefined }),
      });
      const data = await safeJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Invalid reset code");
      setStep("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid reset code");
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition";
  const primaryBtn =
    "w-full py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition disabled:opacity-40";

  return (
    <div className="min-h-screen flex items-center justify-center text-white px-4 relative">
      <Background />
      <div className="relative z-10 w-full max-w-md">
        <Link href="/login" className="text-sm text-gray-400 hover:text-white transition-colors">
          ← Back to login
        </Link>

        <div className="mt-4 glass-strong rounded-3xl p-8 animate-in fade-in duration-700">
          <div className="text-center mb-6">
            <div className="text-3xl font-serif italic font-bold text-white/90 mb-2">A</div>
            <h1 className="text-2xl font-medium">
              {step === "email" && "Reset your password"}
              {step === "reset" && "Enter the reset code"}
              {step === "done" && "Password updated"}
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              {step === "email" && "Enter your account email and we'll send a reset code."}
              {step === "reset" && `We sent a 6-digit code to ${email}`}
              {step === "done" && "Your password has been changed."}
            </p>
          </div>

          {step === "email" && (
            <div className="space-y-4">
              <input
                type="email"
                placeholder="Aether@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendCode()}
                autoComplete="email"
                autoFocus
                className={inputClass}
              />
              <Turnstile onToken={setCfToken} />
              <button
                onClick={sendCode}
                disabled={loading || !email}
                className={primaryBtn}
              >
                {loading ? "Sending..." : "Send reset code"}
              </button>
            </div>
          )}

          {step === "reset" && (
            <div className="space-y-4 animate-in fade-in duration-500">
              <input
                type="text"
                inputMode="numeric"
                placeholder="Enter 6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                autoFocus
                className={`${inputClass} tracking-[0.5em] text-center`}
              />
              <input
                type="password"
                placeholder="New password (8+ characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && resetPassword()}
                autoComplete="new-password"
                className={inputClass}
              />
              <Turnstile onToken={setCfToken} />
              <button
                onClick={resetPassword}
                disabled={loading || code.length !== 6 || password.length < 8}
                className={primaryBtn}
              >
                {loading ? "Resetting..." : "Update password"}
              </button>
              <div className="flex items-center justify-between text-sm">
                <button
                  onClick={() => setStep("email")}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ← Change email
                </button>
                <button
                  onClick={sendCode}
                  disabled={loading}
                  className="text-gray-400 hover:text-white transition-colors disabled:opacity-40"
                >
                  Resend
                </button>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="text-center py-4 animate-in fade-in duration-500">
              <div className="text-4xl mb-4">✅</div>
              <p className="text-gray-400 mt-2 text-sm">
                All old sessions were signed out for your security.
              </p>
              <Link
                href="/login"
                className="inline-block mt-6 px-8 py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition"
              >
                Back to login
              </Link>
            </div>
          )}

          {error && <p className="text-white text-sm mt-4 text-center">{error}</p>}
        </div>
      </div>
    </div>
  );
}
