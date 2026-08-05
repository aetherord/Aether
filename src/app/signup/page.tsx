"use client";
import { useState } from "react";
import Link from "next/link";
import Turnstile from "@/components/Turnstile";

type Step = "form" | "code" | "2fa" | "done";

export default function Signup() {
  const [step, setStep] = useState<Step>("form");

  // Form fields
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [dob, setDob] = useState("");
  const [agreedTos, setAgreedTos] = useState(false);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);
  const [agreedRules, setAgreedRules] = useState(false);

  // Flow state
  const [code, setCode] = useState("");
  const [cfToken, setCfToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [showManualSecret, setShowManualSecret] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const formValid =
    email.trim() !== "" &&
    username.trim() !== "" &&
    password.length >= 8 &&
    dob !== "" &&
    agreedTos &&
    agreedPrivacy &&
    agreedRules;

  const signup = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          username,
          password,
          dob,
          agreedTos,
          agreedPrivacy,
          agreedRules,
          turnstileToken: cfToken ?? undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to create account");
      setCode("");
      setStep("code");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setLoading(false);
    }
  };

  const resendCode = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken: cfToken ?? undefined }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to resend code");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to resend code");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (code.length !== 6) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Invalid code");
      await startTwoFactorSetup();
      setStep("2fa");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  const startTwoFactorSetup = async () => {
    const res = await fetch("/api/auth/2fa/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = (await res.json()) as {
      error?: string;
      secret?: string;
      qrDataUrl?: string | null;
    };
    if (!res.ok) throw new Error(data.error || "Failed to start 2FA setup");
    setSecret(data.secret ?? null);
    setQrDataUrl(data.qrDataUrl ?? null);
  };

  const enableTwoFactor = async () => {
    if (totpCode.length !== 6) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: totpCode }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Invalid code");
      setStep("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition";
  const primaryBtn =
    "w-full py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition disabled:opacity-40";
  const ghostBtn =
    "px-5 py-3 rounded-full border border-white/20 text-gray-300 hover:text-white hover:border-white/50 transition";

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
          ← Back to Aether
        </Link>

        <div className="mt-4 bg-white/5 border border-white/10 rounded-2xl p-8 animate-in fade-in duration-700">
          <div className="text-center mb-6">
            <div className="text-3xl font-serif italic font-bold text-white/90 mb-2">A</div>
            <h1 className="text-2xl font-medium">
              {step === "form" && "Create an account"}
              {step === "code" && "Check your email"}
              {step === "2fa" && "Set up two-factor authentication"}
              {step === "done" && "You&apos;re in!"}
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              {step === "form" && "Join Aether. It takes a minute."}
              {step === "code" && `We sent a 6-digit code to ${email}`}
              {step === "2fa" &&
                "Scan the QR code with your authenticator app, then enter the 6-digit code."}
              {step === "done" && "Your account is verified and protected."}
            </p>
          </div>

          {/* Step 1 — account form */}
          {step === "form" && (
            <div className="space-y-4">
              <input
                type="email"
                placeholder="Aether@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className={inputClass}
              />
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                maxLength={20}
                className={inputClass}
              />
              <input
                type="password"
                placeholder="Password (8+ characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className={inputClass}
              />
              <div>
                <label className="block text-sm text-gray-400 mb-1">Date of birth</label>
                <input
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div className="space-y-2 text-sm">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreedTos}
                    onChange={(e) => setAgreedTos(e.target.checked)}
                    className="mt-0.5 accent-white"
                  />
                  <span className="text-gray-300">
                    I accept the{" "}
                    <Link href="/terms" className="text-white underline">
                      Terms of Service
                    </Link>
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreedPrivacy}
                    onChange={(e) => setAgreedPrivacy(e.target.checked)}
                    className="mt-0.5 accent-white"
                  />
                  <span className="text-gray-300">
                    I accept the{" "}
                    <Link href="/privacy" className="text-white underline">
                      Privacy Policy
                    </Link>
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreedRules}
                    onChange={(e) => setAgreedRules(e.target.checked)}
                    className="mt-0.5 accent-white"
                  />
                  <span className="text-gray-300">
                    I accept the{" "}
                    <Link href="/rules" className="text-white underline">
                      Community Rules
                    </Link>
                  </span>
                </label>
              </div>

              <Turnstile onToken={setCfToken} />

              <button onClick={signup} disabled={loading || !formValid} className={primaryBtn}>
                {loading ? "Creating account..." : "Confirm"}
              </button>
            </div>
          )}

          {/* Step 2 — email code */}
          {step === "code" && (
            <div className="space-y-4 animate-in fade-in duration-500">
              <input
                type="text"
                inputMode="numeric"
                placeholder="Enter 6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && verifyCode()}
                maxLength={6}
                autoFocus
                className={`${inputClass} tracking-[0.5em] text-center`}
              />
              <button
                onClick={verifyCode}
                disabled={loading || code.length !== 6}
                className={primaryBtn}
              >
                {loading ? "Verifying..." : "Verify email"}
              </button>
              <div className="flex items-center justify-between text-sm">
                <button
                  onClick={() => setStep("form")}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ← Edit details
                </button>
                <button
                  onClick={resendCode}
                  disabled={loading}
                  className="text-gray-400 hover:text-white transition-colors disabled:opacity-40"
                >
                  Resend
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — 2FA setup */}
          {step === "2fa" && (
            <div className="space-y-4 animate-in fade-in duration-500">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt="2FA QR code"
                  className="mx-auto h-44 w-44 rounded-lg bg-white p-2"
                />
              ) : (
                <div className="h-44 flex items-center justify-center">
                  <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                </div>
              )}

              {secret && (
                <div className="text-center">
                  {!showManualSecret ? (
                    <button
                      onClick={() => setShowManualSecret(true)}
                      className="text-sm text-gray-400 underline underline-offset-2 hover:text-white transition-colors"
                    >
                      Can&apos;t scan the code? Enter it manually
                    </button>
                  ) : (
                    <div className="text-sm text-gray-300 space-y-1">
                      <p>Open your authenticator app and add this key:</p>
                      <p className="select-all break-all bg-black/30 border border-white/10 rounded-lg px-3 py-2 font-mono text-xs text-white">
                        {secret}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <input
                type="text"
                inputMode="numeric"
                placeholder="Enter 6-digit code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && enableTwoFactor()}
                maxLength={6}
                className={`${inputClass} tracking-[0.5em] text-center`}
              />
              <button
                onClick={enableTwoFactor}
                disabled={loading || totpCode.length !== 6}
                className={primaryBtn}
              >
                {loading ? "Verifying..." : "Finish setup"}
              </button>
            </div>
          )}

          {/* Step 4 — done */}
          {step === "done" && (
            <div className="text-center py-4 animate-in fade-in duration-500">
              <div className="text-4xl mb-4">✅</div>
              <p className="text-gray-400 mt-2 text-sm">
                Your account is verified, 2FA is on, and you&apos;re signed in.
              </p>
              <Link
                href="/chat"
                className="inline-block mt-6 px-8 py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition"
              >
                Enter the chat
              </Link>
            </div>
          )}

          {error && <p className="text-red-400 text-sm mt-4 text-center">{error}</p>}

          {step === "form" && (
            <p className="text-center text-sm text-gray-400 mt-6">
              Already have an account?{" "}
              <Link href="/login" className="text-white hover:underline">
                Log in
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
