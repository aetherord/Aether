/**
 * Aether client-side end-to-end encryption for direct messages.
 *
 * Scheme: ECDH (P-256) key agreement + HKDF-SHA256 key derivation + AES-256-GCM.
 *   - Every user generates an ECDH keypair in their browser. The private key
 *     is stored as PKCS8 in localStorage and NEVER leaves the device.
 *   - The public key (raw uncompressed point, 65 bytes) is uploaded to the
 *     server and is public by design.
 *   - For a DM, both sides derive the SAME shared secret via ECDH, then a
 *     per-conversation AES key via HKDF with a salt derived from both public
 *     keys (so re-derivation is deterministic on either side).
 *   - Message bodies are stored server-side as `e2e:v1:<iv>.<ciphertext>` —
 *     the server and any observer only ever see ciphertext.
 */

const E2E_STORAGE_KEY = "aether_e2e_keys_v1";
const HKDF_INFO = new TextEncoder().encode("aether-dm-v1");
const HKDF_SALT_PREFIX = "aether-e2e";

interface E2EKeyPair {
  pub: string; // base64 raw public point (65 bytes)
  priv: string; // base64 PKCS8 private key
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const u8 = new Uint8Array<ArrayBuffer>(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function generateKeyPair(): Promise<E2EKeyPair> {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const priv = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  return { pub: b64(pub), priv: b64(priv) };
}

async function deriveShared(privPkcs8B64: string, peerPubRawB64: string): Promise<ArrayBuffer> {
  const privKey = await crypto.subtle.importKey(
    "pkcs8",
    unb64(privPkcs8B64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );
  const pubKey = await crypto.subtle.importKey(
    "raw",
    unb64(peerPubRawB64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  return crypto.subtle.deriveBits({ name: "ECDH", public: pubKey }, privKey, 256);
}

async function hkdfKey(shared: ArrayBuffer, myPub: string, peerPub: string): Promise<CryptoKey> {
  // Deterministic salt from both public keys so both sides derive the same key.
  const saltText = `${HKDF_SALT_PREFIX}:${[myPub, peerPub].sort().join(":")}`;
  const baseKey = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode(saltText),
      info: HKDF_INFO,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Loads (or creates + persists) the browser's E2E keypair. */
export async function ensureKeyPair(): Promise<E2EKeyPair> {
  try {
    const stored = localStorage.getItem(E2E_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as E2EKeyPair;
      if (parsed?.pub && parsed?.priv) return parsed;
    }
  } catch {
    /* regenerate below */
  }
  const kp = await generateKeyPair();
  try {
    localStorage.setItem(E2E_STORAGE_KEY, JSON.stringify(kp));
  } catch {
    /* private mode — the keypair lives for this session only */
  }
  return kp;
}

/** Encrypts a plaintext message for a peer; returns the `e2e:v1:` payload. */
export async function encryptForPeer(
  kp: E2EKeyPair,
  peerPub: string,
  plaintext: string
): Promise<string> {
  const shared = await deriveShared(kp.priv, peerPub);
  const key = await hkdfKey(shared, kp.pub, peerPub);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext))
  );
  return `e2e:v1:${b64(iv)}.${b64(ct)}`;
}

/**
 * Decrypts an `e2e:v1:` payload using the peer's public key. Returns the
 * plaintext, or null when the payload is malformed / the key no longer fits.
 * Legacy plaintext messages pass through untouched.
 */
export async function decryptFromPeer(
  kp: E2EKeyPair,
  peerPub: string,
  payload: string
): Promise<string | null> {
  if (!payload.startsWith("e2e:v1:")) return payload;
  try {
    const body = payload.slice(7);
    const dot = body.indexOf(".");
    if (dot === -1) return null;
    const shared = await deriveShared(kp.priv, peerPub);
    const key = await hkdfKey(shared, kp.pub, peerPub);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(body.slice(0, dot)) },
      key,
      unb64(body.slice(dot + 1))
    );
    return dec.decode(plain);
  } catch {
    return null;
  }
}

export const E2E_PREFIX = "e2e:v1:";
export type { E2EKeyPair };
