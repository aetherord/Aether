import { getSecret } from "./env";
import { generateToken } from "./crypto";

/**
 * Media pipeline: uploaded images land in a Turso queue and are mirrored to
 * the local drive (D:\Aether-Images-and-media) by scripts/sync-media.mjs when
 * the machine is on. The cloud copy also serves the images inside the chat.
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
      requests: requests.map((r) => ({ type: "execute", stmt: r })),
    }),
  });
  if (!res.ok) throw new Error("Media storage request failed");
  const data = (await res.json()) as { results?: { type: string }[] };
  if (!(data.results ?? []).every((r) => r.type === "ok")) {
    throw new Error("Media storage request failed");
  }
}

/** Runs a SELECT and returns the raw row arrays. */
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
      requests: [{ type: "execute", stmt: { sql, args } }],
    }),
  });
  if (!res.ok) throw new Error("Media storage request failed");
  const data = (await res.json()) as {
    results?: {
      type: string;
      response?: { result?: { rows?: { row: unknown[] }[] } };
    }[];
  };
  const first = data.results?.[0];
  if (!first || first.type !== "ok") throw new Error("Media storage request failed");
  return (first.response?.result?.rows ?? []).map((r) => r.row);
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

export async function enqueueMedia(input: {
  senderUsername: string;
  recipientUsername: string | null;
  filename: string;
  mime: string;
  b64: string;
}): Promise<string> {
  const id = generateToken(16);
  const size = Buffer.from(input.b64, "base64").byteLength;
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
        size,
        input.b64,
        Date.now(),
      ],
    },
  ]);
  return id;
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
