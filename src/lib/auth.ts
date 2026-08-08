import { authenticator } from "otplib";
import bcrypt from "bcryptjs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getSecret } from "./env";
import {
  generateNumericCode,
  generateToken,
  hashToken,
  hashVerificationCode,
  timingSafeEqualHex,
} from "./crypto";
import { SESSION_COOKIE, readCookie } from "./http";
import { sendVerificationCodeEmail } from "./email";
import { getStore, type AuthStore, type SessionRow, type UserRow } from "./store";

/* ── lifetimes & limits ───────────────────────────────────────────────────── */

export const CODE_TTL_MS = 10 * 60 * 1000; // verification codes: 10 minutes
export const PENDING_TTL_MS = 10 * 60 * 1000; // pending-2FA login step: 10 minutes
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // "remember me" sessions: 30 days
export const SESSION_TTL_NO_REMEMBER_MS = 24 * 60 * 60 * 1000; // private sessions: 24 hours
export const SESSION_ROTATE_MS = 24 * 60 * 60 * 1000; // rotate cookies older than 24h
export const MAX_CODE_ATTEMPTS = 5; // wrong guesses before a code is invalidated

// Allow ±1 TOTP step of clock skew.
(authenticator as unknown as { options: Record<string, unknown> }).options = { window: 1 };

/* ── validation ───────────────────────────────────────────────────────────── */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

export function isValidCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

export { isReservedUsername } from "./usernames";

export function isValidPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 128;
}

export function isValidDob(dob: string): boolean {
  const parsed = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = Date.now();
  if (parsed.getTime() >= now) return false;
  const age = (now - parsed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return age >= 13 && age <= 120;
}

/* ── passwords (PBKDF2-SHA256 via Web Crypto) ────────────────────────────── */

// Pure-JS bcrypt blows the Cloudflare free-tier CPU limit (10ms), so passwords
// use PBKDF2-SHA256 from the platform-native Web Crypto API instead. 100k is
// the maximum iteration count Cloudflare's Web Crypto accepts, runs in well
// under the CPU limit, and is the standard OWASP-recommended baseline. Legacy
// bcrypt hashes ($2a/$2b$) are still accepted so old accounts keep working.
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN = 32; // 256-bit derived key
const passwordEncoder = new TextEncoder();

async function pbkdf2Derive(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  // Copy the salt so `.buffer` is exactly the salt bytes (a Node Buffer may
  // share a larger pool buffer, which would silently change the derivation).
  const saltCopy = new Uint8Array(salt);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltCopy.buffer, iterations },
    keyMaterial,
    PBKDF2_KEYLEN * 8
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await pbkdf2Derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${Buffer.from(salt).toString("base64")}$${Buffer.from(key).toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) return false;

  // Legacy bcrypt hash — verify with bcryptjs for backward compatibility.
  if (stored.startsWith("$2")) {
    try {
      return await bcrypt.compare(password, stored);
    } catch {
      return false;
    }
  }

  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = Buffer.from(parts[2], "base64");
  const expected = Buffer.from(parts[3], "base64");
  if (!Number.isFinite(iterations) || iterations <= 0 || salt.length === 0) return false;
  if (expected.length !== PBKDF2_KEYLEN) return false;

  const actual = Buffer.from(await pbkdf2Derive(password, salt, iterations));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* ── verification codes ───────────────────────────────────────────────────── */

export function generateVerificationCode(): string {
  return generateNumericCode(6);
}

/**
 * Sends the code by email. The code is never logged or returned in any API
 * response — the email is the only channel it travels on.
 */
export async function sendCode(email: string, code: string): Promise<void> {
  await sendVerificationCodeEmail(email, code);
}

/**
 * Validates a submitted code against the stored salted hash using a
 * constant-time comparison. Consumes the code on success and invalidates it
 * after MAX_CODE_ATTEMPTS failures.
 */
export async function verifyEmailCode(
  store: AuthStore,
  email: string,
  code: string
): Promise<boolean> {
  const row = await store.getCode(email);
  if (!row) return false;

  const now = Date.now();
  if (row.expiresAt < now) {
    await store.clearCode(email);
    return false;
  }
  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    await store.clearCode(email);
    return false;
  }

  const candidate = hashVerificationCode(code, row.salt);
  if (!timingSafeEqualHex(candidate, row.codeHash)) {
    await store.incrementCodeAttempts(email);
    if (row.attempts + 1 >= MAX_CODE_ATTEMPTS) {
      await store.clearCode(email);
    }
    return false;
  }

  await store.clearCode(email);
  return true;
}

/* ── TOTP 2FA ─────────────────────────────────────────────────────────────── */

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpUri(secret: string, accountName: string): string {
  return authenticator.keyuri(accountName, "Aether", secret);
}

export function verifyTotp(secret: string, token: string): boolean {
  if (!isValidCode(token)) return false;
  try {
    return authenticator.check(token, secret);
  } catch {
    return false;
  }
}

/* ── sessions ─────────────────────────────────────────────────────────────── */

/**
 * Issues a session. With `remember` set the session lasts SESSION_TTL_MS
 * (30 days, browser cookie); without it the session lasts 24 hours and the
 * cookie is session-scoped so it dies when the browser closes.
 */
export async function issueSession(store: AuthStore, user: UserRow, remember = true): Promise<string> {
  const token = generateToken();
  const now = Date.now();
  await store.createSession({
    tokenHash: hashToken(token),
    userId: user.id,
    email: user.email,
    remember,
    expiresAt: now + (remember ? SESSION_TTL_MS : SESSION_TTL_NO_REMEMBER_MS),
    createdAt: now,
    lastUsedAt: now,
  });
  return token;
}

/** Resolves the session cookie to a live session + user, or null. */
export async function resolveSession(
  req: Request
): Promise<{ session: SessionRow; user: UserRow } | null> {
  const store = await getStore();
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;

  const row = await store.getSession(hashToken(token));
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    await store.deleteSession(row.tokenHash);
    return null;
  }
  const user = await store.getUserById(row.userId);
  if (!user) return null;

  // Defense in depth: a suspended account must never hold a live session,
  // even if a race let one survive the ban (admin bans revoke sessions too).
  if (user.bannedUntil && user.bannedUntil > Date.now()) {
    await store.deleteSession(row.tokenHash);
    return null;
  }

  await store.touchSession(row.tokenHash);
  return { session: row, user };
}

/* ── Cloudflare Turnstile (bot protection, optional) ──────────────────────── */

/**
 * Verifies a Turnstile token. Enforced only when BOTH the secret key and the
 * public site key are configured — if either is missing, the client widget
 * wouldn't render a token anyway, so enforcing with only the secret would
 * break every login/signup. This keeps dev and a partially-configured deploy
 * working while turning on bot protection the moment both keys exist.
 */
export async function verifyTurnstile(token: string | undefined): Promise<boolean> {
  const secret = getSecret("TURNSTILE_SECRET_KEY");
  const siteKey = getSecret("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  if (!secret || !siteKey) return true;
  if (!token) return false;

  const form = new URLSearchParams({ secret, response: token });
  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      }
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
