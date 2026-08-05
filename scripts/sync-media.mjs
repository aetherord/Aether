#!/usr/bin/env node
/**
 * Aether media sync
 * -----------------
 * Downloads images/videos that are sitting in the Turso media queue into the
 * local archive:
 *
 *   D:\Aether-Images-and-media\{senderUsername}\{recipientUsername}\{file}
 *
 * This is the "PC is on and the D: SSD is online" path. If the SSD is not
 * available, the script exits cleanly and leaves everything queued in Turso —
 * nothing is lost, it will be drained on the next run.
 *
 * Run it while your PC is on:
 *
 *   node --env-file=.env.local scripts/sync-media.mjs
 *
 * Env vars:
 *   TURSO_URL              required (https://<db>.turso.io or libsql://<db>.turso.io)
 *   TURSO_AUTH_TOKEN       required
 *   MEDIA_ROOT             default: D:\Aether-Images-and-media
 *   MEDIA_MAX_GB           default: 80  (hard cap on the archive size)
 *   MEDIA_PURGE_AFTER_SYNC "true" deletes the cloud copy after a successful
 *                          write. WARNING: the web chat serves media from
 *                          the cloud copy, so purging removes it from chat.
 *                          Default "false" keeps a copy in the cloud.
 */

import { access, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, basename, sep } from "node:path";

const ROOT = process.env.MEDIA_ROOT || "D:\\Aether-Images-and-media";
const MAX_GB = Number(process.env.MEDIA_MAX_GB || 80);
const PURGE = (process.env.MEDIA_PURGE_AFTER_SYNC || "").toLowerCase() === "true";
const MAX_BYTES = MAX_GB * 1024 * 1024 * 1024;

const TURSO_URL = process.env.TURSO_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error("ERROR: TURSO_URL and TURSO_AUTH_TOKEN are required.");
  process.exit(1);
}

/* ── SSD availability check ──────────────────────────────────────────────── */

async function driveAvailable() {
  try {
    await access(ROOT, constants.W_OK);
    return true;
  } catch {
    // MEDIA_ROOT itself may not exist yet on a first run, so probe the drive root.
    const driveRoot = ROOT.split(sep)[0] + sep;
    try {
      await access(driveRoot, constants.F_OK | constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

/* ── Turso (tagged wire format) ──────────────────────────────────────────── */

function tagArg(v) {
  if (v === null || v === undefined) return { type: "null", value: null };
  if (typeof v === "number") return { type: "integer", value: String(v) };
  return { type: "text", value: v };
}

function untag(v) {
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

async function turso(requests) {
  const base = TURSO_URL.replace(/^libsql:\/\//, "https://").replace(/\/+$/, "");
  const url = `${base}/v2/pipeline`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${TURSO_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      requests: requests.map((r) => ({
        type: "execute",
        stmt: { sql: r.sql, args: (r.args ?? []).map(tagArg) },
      })),
    }),
  });
  if (!res.ok) throw new Error(`Turso HTTP ${res.status}`);
  const data = await res.json();
  // A statement-level failure (e.g. SQL error) returns type "error" — surface
  // it instead of silently treating the result as empty.
  if (!(data.results ?? []).every((r) => r.type === "ok")) {
    throw new Error("Turso statement failed");
  }
  return data;
}

async function ensureSchema() {
  await turso([
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
  ]);
}

async function fetchPending() {
  const data = await turso([
    {
      sql: "SELECT id, sender_username, recipient_username, filename, size, b64, created_at FROM media_queue WHERE synced = 0 ORDER BY created_at ASC",
      args: [],
    },
  ]);
  const rows = data.results?.[0]?.response?.result?.rows ?? [];
  return rows.map((r) => ({
    id: String(untag(r[0]) ?? ""),
    sender: String(untag(r[1]) ?? ""),
    recipient: untag(r[2]) == null ? null : String(untag(r[2])),
    filename: String(untag(r[3]) ?? ""),
    size: Number(untag(r[4]) ?? 0),
    b64: String(untag(r[5]) ?? ""),
    createdAt: Number(untag(r[6]) ?? 0),
  }));
}

async function dirSize(dir) {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else total += (await stat(full)).size;
  }
  return total;
}

function sanitize(part) {
  return part.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 40) || "unknown";
}

async function main() {
  console.log(`Aether media sync — root: ${ROOT}, cap: ${MAX_GB} GB, purge: ${PURGE}`);

  if (!(await driveAvailable())) {
    console.warn(
      `D: SSD is not available right now (cannot write to ${ROOT}). ` +
        `Leaving everything queued in Turso — run this again when the PC is on.`
    );
    process.exit(0);
  }

  await ensureSchema();

  const pending = await fetchPending();
  if (pending.length === 0) {
    console.log("Nothing to sync. ✔");
    return;
  }
  console.log(`${pending.length} media item(s) queued.`);

  let used = await dirSize(ROOT);
  console.log(`Archive currently uses ${(used / 1024 ** 3).toFixed(2)} GB.`);

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of pending) {
    const sizeBytes = item.size || item.b64.length * 0.75; // byte estimate
    if (used + sizeBytes > MAX_BYTES) {
      console.warn(
        `SKIP  ${item.id} — would exceed the ${MAX_GB} GB cap (need ~${(sizeBytes / 1024 ** 3).toFixed(2)} GB more).`
      );
      skipped++;
      continue;
    }

    const senderDir = sanitize(item.sender);
    const recipientDir = sanitize(item.recipient ?? "general");
    const dir = join(ROOT, senderDir, recipientDir);
    const safeName = basename(item.filename).replace(/[^\w.\- ]/g, "_").slice(0, 120) || "media";
    const filePath = join(dir, `${item.createdAt}-${safeName}`);

    try {
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, Buffer.from(item.b64, "base64"));
      used += sizeBytes;
      synced++;

      if (PURGE) {
        await turso([{ sql: "DELETE FROM media_queue WHERE id = ?1", args: [item.id] }]);
      } else {
        await turso([{ sql: "UPDATE media_queue SET synced = 1 WHERE id = ?1", args: [item.id] }]);
      }
      console.log(`SAVED ${filePath}`);
    } catch (err) {
      failed++;
      console.error(`FAIL  ${item.id}: ${err.message}`);
    }
  }

  console.log(`\nDone: ${synced} synced, ${skipped} skipped (cap), ${failed} failed.`);
  if (!PURGE) {
    console.log(
      "Cloud copies were kept (MEDIA_PURGE_AFTER_SYNC=false) so the web chat can still serve them."
    );
  }
}

main().catch((err) => {
  console.error("Sync failed:", err.message);
  process.exit(1);
});
