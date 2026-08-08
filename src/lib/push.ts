import { getSecret } from "./env";

/**
 * Web Push (RFC 8030 + RFC 8291) support for Cloudflare Workers, using only
 * platform WebCrypto — no npm package needed.
 *
 * Push lets the server deliver a notification even when the chat tab is
 * closed, as long as the browser itself is running and the user granted
 * permission. It activates only when VAPID keys are configured:
 *
 *   VAPID_PUBLIC_KEY  (base64url, 65-byte uncompressed P-256 point)
 *   VAPID_PRIVATE_KEY (base64url, 32-byte P-256 private scalar)
 *
 * Generate them with:
 *   npx web-push generate-vapid-keys
 *
 * Without the keys this module is inert (sendPush returns 0 sent) and the
 * client never asks for push permission — the in-tab notifications still work.
 */

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Bytes = Uint8Array<ArrayBuffer>;

function b64urlDecode(str: string): Bytes {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...arrays: Uint8Array[]): Bytes {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/** HKDF via WebCrypto. */
async function hkdf(
  ikm: Bytes,
  salt: Bytes,
  info: Bytes,
  length: number
): Promise<Bytes> {
  const key = await crypto.subtle.importKey(
    "raw",
    ikm,
    { name: "HKDF" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

/** Decode a base64url-encoded VAPID public key into its raw 65-byte point. */
function vapidPublicBytes(pub: string): Bytes {
  const bytes = b64urlDecode(pub);
  if (bytes.length === 65) return bytes;
  // Some generators emit only the 32-byte X coordinate — rebuild the point
  // with the standard compressed-point prefix for P-256.
  if (bytes.length === 32) {
    return concat(new Uint8Array([0x04]), bytes, new Uint8Array(32));
  }
  throw new Error("VAPID_PUBLIC_KEY must be a 65-byte (or 32-byte) base64url P-256 point");
}

/** Builds and signs the VAPID Authorization JWT (ES256). */
async function makeVapidJwt(
  audience: string,
  subject: string
): Promise<{ jwt: string; publicKeyB64: string }> {
  const publicB64 = getSecret("VAPID_PUBLIC_KEY");
  const privateB64 = getSecret("VAPID_PRIVATE_KEY");
  if (!publicB64 || !privateB64) throw new Error("VAPID keys not configured");

  const privateBytes = b64urlDecode(privateB64);
  const publicBytes = vapidPublicBytes(publicB64);
  // The private key is the raw 32-byte scalar; extract X/Y from the public point.
  const x = publicBytes.slice(1, 33);
  const y = publicBytes.slice(33, 65);

  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const claims = { aud: audience, exp: now + 12 * 3600, sub: subject };
  const signingInput = `${b64urlEncode(encoder.encode(JSON.stringify(header)))}.${b64urlEncode(
    encoder.encode(JSON.stringify(claims))
  )}`;

  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(x),
    y: b64urlEncode(y),
    d: b64urlEncode(privateBytes),
  };
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      encoder.encode(signingInput)
    )
  );
  // WebCrypto gives raw r||s (64 bytes) — Web Push wants DER… but the spec
  // (RFC 8292 §3.2) actually expects raw r||s for the JWT compact form.
  return {
    jwt: `${signingInput}.${b64urlEncode(sig)}`,
    publicKeyB64: b64urlEncode(publicBytes),
  };
}

/** Encrypts a payload for a subscription (RFC 8291 aes128gcm). */
async function encryptPayload(
  payload: Uint8Array,
  sub: PushSubscriptionRow
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);

  const ecdh = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const asPublic = new Uint8Array(
    await crypto.subtle.exportKey("raw", ecdh.publicKey)
  );
  const peerKey = await crypto.subtle.importKey(
    "raw",
    uaPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: peerKey }, ecdh.privateKey, 256)
  );

  // HKDF chain (RFC 8291 §3.3)
  const prk = await hkdf(ecdhSecret, authSecret, new Uint8Array(0), 32);
  const keyInfo = concat(
    encoder.encode("WebPush: info"),
    new Uint8Array([0]),
    uaPublic,
    asPublic
  );
  const ikm = await hkdf(prk, new Uint8Array(0), keyInfo, 32);
  const cek = await hkdf(
    ikm,
    new Uint8Array(0),
    concat(encoder.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])),
    16
  );
  const nonce = await hkdf(
    ikm,
    new Uint8Array(0),
    concat(encoder.encode("Content-Encoding: nonce"), new Uint8Array([0])),
    12
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const record = concat(new Uint8Array([0x02]), payload); // 2-byte padding delimiter + data

  const aesKey = await crypto.subtle.importKey(
    "raw",
    cek as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, tagLength: 128 },
      aesKey,
      record as BufferSource
    )
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const keyIdLen = new Uint8Array([asPublic.length]);

  return concat(salt, recordSize, keyIdLen, asPublic, cipher);
}

/**
 * Sends a push notification to every subscription belonging to a user.
 * Returns the number of subscriptions that accepted the message, and prunes
 * subscriptions that are permanently gone (410) from the store.
 */
export async function sendPush(
  subscriptions: PushSubscriptionRow[],
  payload: Record<string, unknown>,
  removeSubscription: (endpoint: string) => Promise<void>
): Promise<number> {
  const publicB64 = getSecret("VAPID_PUBLIC_KEY");
  const privateB64 = getSecret("VAPID_PRIVATE_KEY");
  if (!publicB64 || !privateB64) return 0; // push not configured — silently inert

  const body = JSON.stringify(payload);
  let sent = 0;
  for (const sub of subscriptions) {
    try {
      const url = new URL(sub.endpoint);
      const audience = url.origin;
      const subject = getSecret("VAPID_SUBJECT") || "mailto:admin@aether.app";
      const { jwt, publicKeyB64 } = await makeVapidJwt(audience, subject);
      const encrypted = await encryptPayload(encoder.encode(body), sub);

      const res = await fetch(sub.endpoint, {
        method: "POST",
        headers: {
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: "86400",
          Authorization: `vapid t=${jwt}, k=${publicKeyB64}`,
        },
        body: encrypted as unknown as BodyInit,
      });
      if (res.status === 201 || res.status === 202 || res.status === 200) {
        sent += 1;
      } else if (res.status === 404 || res.status === 410) {
        // Subscription is dead — drop it so we never hammer it again.
        await removeSubscription(sub.endpoint).catch(() => {});
      }
    } catch {
      // Transient network/encode failure for one subscription — keep going.
    }
  }
  return sent;
}

/** Small helper so server routes share the same payload shape. */
export function pushPayload(
  senderUsername: string,
  preview: string,
  isMedia: boolean
): Record<string, unknown> {
  return {
    title: senderUsername,
    body: isMedia ? "📎 Sent you media" : preview,
    tag: "aether-dm",
    url: "/chat",
  };
}
