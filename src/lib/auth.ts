import { authenticator } from "otplib";
import bcrypt from "bcryptjs";
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
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // sessions: 30 days
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

export function isValidPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 72; // 72 = bcrypt input limit
}

export function isValidDob(dob: string): boolean {
  const parsed = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = Date.now();
  if (parsed.getTime() >= now) return false;
  const age = (now - parsed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return age >= 13 && age <= 120;
}

/* ── passwords (bcrypt) ───────────────────────────────────────────────────── */

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
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

export async function issueSession(store: AuthStore, user: UserRow): Promise<string> {
  const token = generateToken();
  const now = Date.now();
  await store.createSession({
    tokenHash: hashToken(token),
    userId: user.id,
    email: user.email,
    expiresAt: now + SESSION_TTL_MS,
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

  await store.touchSession(row.tokenHash);
  return { session: row, user };
}

/* ── Cloudflare Turnstile (bot protection, optional) ──────────────────────── */

/**
 * Verifies a Turnstile token. When TURNSTILE_SECRET_KEY is not configured the
 * check is skipped so the flow still works in development.
 */
export async function verifyTurnstile(token: string | undefined): Promise<boolean> {
  const secret = getSecret("TURNSTILE_SECRET_KEY");
  if (!secret) return true;
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
