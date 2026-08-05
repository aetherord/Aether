import { getSecret } from "./env";
import { generateToken, sha256Hex } from "./crypto";

/**
 * Media pipeline: uploaded images/videos land in a Turso queue and are
 * mirrored to the local drive (D:\Aether-Images-and-media) by
 * scripts/sync-media.mjs when the machine is on. The cloud copy also serves
 * the media inside the chat.
 *
 * NOTE: Turso's HTTP pipeline API requires every argument AND every returned
 * value to be tagged — e.g. {"type":"text","value":"..."} — raw values are
 * rejected with a 400. All helpers here handle that wire format.
 */

export const MEDIA_NOT_CONFIGURED =
  "Media storage is not configured (set TURSO_URL and TURSO_AUTH_TOKEN)";

export interface MediaRecord {
  id: string;
  senderUsername: string;
  recipientUsername: string | null;
  filename: string;
  mime: string;
  size: number;
  b64: string;
  createdAt: number;
}

/* ── Turso wire format (tagged values) ───────────────────────────────────── */

type TursoValue = { type: "null"; value: null } | { type: "text"; value: string } | { type: "integer"; value: string } | { type: "real"; value: string } | { type: "blob"; value: string };

function tagArg(v: string | number | null): TursoValue {
  if (v === null || v === undefined) return { type: "null", value: null };
  if (typeof v === "number") return { type: "integer", value: String(v) };
  return { type: "text", value: v };
}

function untag(v: TursoValue | null | undefined): string | number | null {
  if (!v) return null;
  switch (v.type) {
    case "null":
      return null;
    case "integer":
    case "real":
      return Number(v.value);
    case "text":
    case "blob":
      return v.value;
    default:
      return null;
  }
}

interface TursoArgs {
  sql: string;
  args?: (string | number | null)[];
}

/** Accepts either https:// or libsql:// database URLs. */
function tursoEndpoint(): { url: string; token: string } {
  const raw = getSecret("TURSO_URL");
  const token = getSecret("TURSO_AUTH_TOKEN");
  if (!raw || !token) throw new Error(MEDIA_NOT_CONFIGURED);
  const url = raw.replace(/^libsql:\/\//, "https://").replace(/\/+$/, "");
  return { url, token };
}

export function mediaConfigured(): boolean {
  return Boolean(getSecret("TURSO_URL") && getSecret("TURSO_AUTH_TOKEN"));
}

/** Runs one or more SQL statements via the Turso HTTP pipeline API. */
async function tursoExec(requests: TursoArgs[]): Promise<void> {
  const { url, token } = tursoEndpoint();
  const res = await fetch(`${url}/v2/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      requests: requests.map((r) => ({
        type: "execute",
        stmt: { sql: r.sql, args: (r.args ?? []).map(tagArg) },
      })),
    }),
  });
  if (!res.ok) throw new Error("Media storage request failed");
  const data = (await res.json()) as { results?: { type: string }[] };
  if (!(data.results ?? []).every((r) => r.type === "ok")) {
    throw new Error("Media storage request failed");
  }
}

/** Runs a SELECT and returns the raw row arrays with tagged values unwrapped. */
async function tursoSelect(
  sql: string,
  args: (string | number | null)[] = []
): Promise<unknown[][]> {
  const { url, token } = tursoEndpoint();
  const res = await fetch(`${url}/v2/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          type: "execute",
          stmt: { sql, args: args.map(tagArg) },
        },
      ],
    }),
  });
  if (!res.ok) throw new Error("Media storage request failed");
  const data = (await res.json()) as {
    results?: {
      type: string;
      response?: { result?: { rows?: TursoValue[][] } };
    }[];
  };
  const first = data.results?.[0];
  if (!first || first.type !== "ok") throw new Error("Media storage request failed");
  // Turso returns each row as a plain array of tagged values.
  return (first.response?.result?.rows ?? []).map((r) => r.map((v) => untag(v)));
}

/* ── at-rest encryption (AES-256-GCM) ────────────────────────────────────── */

// Media payloads are encrypted before they touch Turso. The key is derived
// from JWT_SECRET with a distinct context string so it can never collide with
// the TOTP key. The local sync script decrypts with the same derivation and
// writes plaintext files to the D: drive.
//
// ⚠ WARNING: rotating JWT_SECRET makes every stored `encv1:` payload
// permanently undecryptable (same as TOTP secrets). Never rotate it without
// re-encrypting the media queue first.

const MEDIA_ENC_PREFIX = "encv1:";
let mediaKey: CryptoKey | null = null;

async function getMediaKey(): Promise<CryptoKey> {
  if (mediaKey) return mediaKey;
  const secret = getSecret("JWT_SECRET");
  if (!secret) throw new Error("JWT_SECRET is not configured");
  const raw = Uint8Array.from(Buffer.from(sha256Hex(`aether-media:${secret}`), "hex"));
  mediaKey = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  return mediaKey;
}

/** Encrypts raw bytes into an `encv1:`-prefixed payload (iv.cipher, base64). */
export async function encryptMediaBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await getMediaKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes)
  );
  return `${MEDIA_ENC_PREFIX}${Buffer.from(iv).toString("base64")}.${Buffer.from(ciphertext).toString("base64")}`;
}

/**
 * Decrypts an `encv1:` payload back to the original bytes. Legacy records
 * stored as plain base64 (before encryption was added) are passed through.
 */
export async function decryptMediaPayload(payload: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!payload.startsWith(MEDIA_ENC_PREFIX)) {
    return new Uint8Array(Buffer.from(payload, "base64"));
  }
  const body = payload.slice(MEDIA_ENC_PREFIX.length);
  const dot = body.indexOf(".");
  if (dot === -1) throw new Error("Malformed encrypted media payload");
  try {
    const key = await getMediaKey();
    const iv = Buffer.from(body.slice(0, dot), "base64");
    const ciphertext = Buffer.from(body.slice(dot + 1), "base64");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new Uint8Array(plain);
  } catch {
    throw new Error("Media decryption failed");
  }
}

let schemaReady: Promise<void> | null = null;

export function ensureMediaSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = tursoExec([
      {
        sql: `CREATE TABLE IF NOT EXISTS media_queue (
          id TEXT PRIMARY KEY,
          sender_username TEXT NOT NULL,
          recipient_username TEXT,
          filename TEXT NOT NULL,
          mime TEXT NOT NULL,
          size INTEGER NOT NULL,
          b64 TEXT NOT NULL,
          synced INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        )`,
      },
    ]).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/**
 * Queues a media upload. Bytes are encrypted at rest before touching Turso;
 * `size` records the plaintext size so the local 80 GB cap math stays exact.
 */
export async function enqueueMedia(input: {
  senderUsername: string;
  recipientUsername: string | null;
  filename: string;
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
}): Promise<string> {
  const id = generateToken(16);
  const payload = await encryptMediaBytes(input.bytes);
  await ensureMediaSchema();
  await tursoExec([
    {
      sql: "INSERT INTO media_queue (id, sender_username, recipient_username, filename, mime, size, b64, synced, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)",
      args: [
        id,
        input.senderUsername,
        input.recipientUsername,
        input.filename,
        input.mime,
        input.bytes.byteLength,
        payload,
        Date.now(),
      ],
    },
  ]);
  return id;
}

export interface MediaStats {
  configured: boolean;
  total: number;
  synced: number;
  pending: number;
}

/** Aggregate counts from the media queue (total / synced / waiting). */
export async function mediaStats(): Promise<MediaStats> {
  if (!mediaConfigured()) {
    return { configured: false, total: 0, synced: 0, pending: 0 };
  }
  await ensureMediaSchema();
  const rows = await tursoSelect(
    "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN synced = 1 THEN 1 ELSE 0 END), 0) AS synced FROM media_queue"
  );
  const row = rows[0];
  const total = Number(row?.[0] ?? 0);
  const synced = Number(row?.[1] ?? 0);
  return { configured: true, total, synced, pending: Math.max(0, total - synced) };
}

export async function getMedia(id: string): Promise<MediaRecord | null> {
  await ensureMediaSchema();
  const rows = await tursoSelect(
    "SELECT id, sender_username, recipient_username, filename, mime, size, b64, created_at FROM media_queue WHERE id = ?1 LIMIT 1",
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row[0]),
    senderUsername: String(row[1]),
    recipientUsername: row[2] == null ? null : String(row[2]),
    filename: String(row[3]),
    mime: String(row[4]),
    size: Number(row[5]),
    b64: String(row[6]),
    createdAt: Number(row[7]),
  };
}
