import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { getSecret } from "./env";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ── hashing & randomness ─────────────────────────────────────────────────── */

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Hash a session / pending token before it is stored at rest. */
export function hashToken(token: string): string {
  return sha256Hex(token);
}

/** Cryptographically-random opaque token (base64url). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

/** 6-digit code from the cryptographic RNG, zero-padded. */
export function generateNumericCode(digits = 6): string {
  return randomInt(0, 10 ** digits)
    .toString()
    .padStart(digits, "0");
}

/**
 * Salted hash of a verification code. The plaintext code is only ever kept in
 * memory for the instant it takes to send it by email — it is never stored or
 * logged, so a database leak cannot be used to forge codes.
 */
export function hashVerificationCode(code: string, salt: string): string {
  return sha256Hex(`${salt}:${code}`);
}

/* ── constant-time comparison ─────────────────────────────────────────────── */

/** Constant-time compare of two hex digests (32 bytes for SHA-256). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/* ── AES-256-GCM at-rest encryption (for TOTP secrets) ────────────────────── */

let encryptionKey: CryptoKey | null = null;

async function getEncryptionKey(): Promise<CryptoKey> {
  if (encryptionKey) return encryptionKey;
  const secret = getSecret("JWT_SECRET");
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  const raw = Uint8Array.from(Buffer.from(sha256Hex(`aether-totp:${secret}`), "hex"));
  encryptionKey = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  return encryptionKey;
}

export async function encryptString(plain: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plain))
  );
  return `${Buffer.from(iv).toString("base64")}.${Buffer.from(ciphertext).toString("base64")}`;
}

export async function decryptString(payload: string): Promise<string | null> {
  const parts = payload.split(".");
  if (parts.length !== 2) return null;
  try {
    const key = await getEncryptionKey();
    const iv = Buffer.from(parts[0], "base64");
    const ciphertext = Buffer.from(parts[1], "base64");
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    return decoder.decode(plain);
  } catch {
    return null; // tampered ciphertext or wrong key
  }
}
