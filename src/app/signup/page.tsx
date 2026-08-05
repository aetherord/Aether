"use client";
import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Turnstile from "@/components/Turnstile";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Custom agreement checkbox: animated square + check, keyboard accessible. */
function CustomCheckbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-start gap-3 text-left cursor-pointer select-none"
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-200 ${
          checked
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
            checked ? "scale-100" : "scale-0"
          }`}
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <span className="text-sm leading-snug text-gray-300 transition-colors group-hover:text-gray-200">
        {children}
      </span>
    </button>
  );
}

type Step = "form" | "code" | "2fa" | "done";

export default function Signup() {
  const [step, setStep] = useState<Step>("form");

  // Form fields
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [dobMonth, setDobMonth] = useState("");
  const [dobDay, setDobDay] = useState("");
  const [dobYear, setDobYear] = useState("");
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
  const [secretRevealed, setSecretRevealed] = useState(false);
  const [codePhase, setCodePhase] = useState(false);
  const secretRef = useRef<HTMLParagraphElement | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const nowYear = new Date().getFullYear();
  const daysInMonth =
    dobMonth && dobYear ? new Date(Number(dobYear), Number(dobMonth), 0).getDate() : 31;
  const dobValue =
    dobYear && dobMonth && dobDay
      ? `${dobYear}-${String(dobMonth).padStart(2, "0")}-${String(dobDay).padStart(2, "0")}`
      : "";

  const formValid =
    email.trim() !== "" &&
    username.trim() !== "" &&
    password.length >= 8 &&
    dobValue !== "" &&
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
          dob: dobValue,
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
    setShowManualSecret(false);
    setSecretRevealed(false);
    setCodePhase(false);
  };

  const revealSecret = () => {
    setSecretRevealed(true);
    // Select the key so the user can copy it straight into their authenticator app.
    const el = secretRef.current;
    if (el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
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
  const selectClass =
    "w-full px-3 py-3 bg-black/30 border border-white/10 rounded-xl text-sm cursor-pointer focus:outline-none focus:border-white/30 transition";
  const primaryBtn =
    "w-full py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition disabled:opacity-40";
  const ghostBtn =
    "px-5 py-3 rounded-full border border-white/20 text-gray-300 hover:text-white hover:border-white/50 transition";

  const ChevronDown = () => (
    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 flex items-center text-gray-500">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );

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
                <div className="grid grid-cols-3 gap-2">
                  <div className="relative">
                    <select
                      value={dobMonth}
                      onChange={(e) => {
                        setDobMonth(e.target.value);
                        setDobDay("");
                      }}
                      className={`${selectClass} appearance-none pr-8 ${
                        dobMonth ? "text-white" : "text-gray-500"
                      }`}
                    >
                      <option value="" disabled>
                        Month
                      </option>
                      {MONTH_NAMES.map((m, i) => (
                        <option key={m} value={i + 1} className="text-white bg-[#141416]">
                          {m}
                        </option>
                      ))}
                    </select>
                    <ChevronDown />
                  </div>
                  <div className="relative">
                    <select
                      value={dobDay}
                      onChange={(e) => setDobDay(e.target.value)}
                      className={`${selectClass} appearance-none pr-8 ${
                        dobDay ? "text-white" : "text-gray-500"
                      }`}
                    >
                      <option value="" disabled>
                        Day
                      </option>
                      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d} className="text-white bg-[#141416]">
                          {d}
                        </option>
                      ))}
                    </select>
                    <ChevronDown />
                  </div>
                  <div className="relative">
                    <select
                      value={dobYear}
                      onChange={(e) => {
                        setDobYear(e.target.value);
                        setDobDay("");
                      }}
                      className={`${selectClass} appearance-none pr-8 ${
                        dobYear ? "text-white" : "text-gray-500"
                      }`}
                    >
                      <option value="" disabled>
                        Year
                      </option>
                      {Array.from({ length: 120 }, (_, i) => nowYear - i).map((y) => (
                        <option key={y} value={y} className="text-white bg-[#141416]">
                          {y}
                        </option>
                      ))}
                    </select>
                    <ChevronDown />
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-1">
                <CustomCheckbox checked={agreedTos} onChange={setAgreedTos}>
                  I accept the{" "}
                  <Link href="/terms" className="text-white underline decoration-white/40 underline-offset-2 hover:decoration-white">
                    Terms of Service
                  </Link>
                </CustomCheckbox>
                <CustomCheckbox checked={agreedPrivacy} onChange={setAgreedPrivacy}>
                  I accept the{" "}
                  <Link href="/privacy" className="text-white underline decoration-white/40 underline-offset-2 hover:decoration-white">
                    Privacy Policy
                  </Link>
                </CustomCheckbox>
                <CustomCheckbox checked={agreedRules} onChange={setAgreedRules}>
                  I accept the{" "}
                  <Link href="/rules" className="text-white underline decoration-white/40 underline-offset-2 hover:decoration-white">
                    Community Rules
                  </Link>
                </CustomCheckbox>
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
          {step === "2fa" && !codePhase && (
            <div className="space-y-4 animate-in fade-in duration-500">
              {!showManualSecret ? (
                <>
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
                    {secret}
                  </p>
                  <p className="mt-2 text-xs text-gray-500">
                    {secretRevealed
                      ? "Key selected — copy it or type it into your app."
                      : "Click the key above to reveal it."}
                  </p>
                </div>
              )}

              <button onClick={() => setCodePhase(true)} className={primaryBtn}>
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

          {/* Step 3b — 2FA code entry */}
          {step === "2fa" && codePhase && (
            <div className="space-y-4 animate-in fade-in duration-500">
              <p className="text-sm text-gray-300 text-center">
                Enter the 6-digit code from your authenticator app.
              </p>
              <input
                type="text"
                inputMode="numeric"
                placeholder="Enter 6-digit code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && enableTwoFactor()}
                maxLength={6}
                autoFocus
                className={`${inputClass} tracking-[0.5em] text-center`}
              />
              <button
                onClick={enableTwoFactor}
                disabled={loading || totpCode.length !== 6}
                className={primaryBtn}
              >
                {loading ? "Verifying..." : "Finish setup"}
              </button>
              <button
                onClick={() => setCodePhase(false)}
                className="mx-auto block text-sm text-gray-400 underline underline-offset-2 hover:text-white transition-colors"
              >
                ← Back
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
