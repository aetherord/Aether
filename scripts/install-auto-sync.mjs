#!/usr/bin/env node
/**
 * Aether auto-sync installer (Windows only)
 * -----------------------------------------
 * Registers a Task Scheduler task that runs the media sync every 5 minutes
 * while this PC is on. Each run:
 *   - checks the D: SSD is available,
 *   - drains everything queued in Turso into D:\Aether-Images-and-media,
 *   - DELETES the cloud copy from Turso after each item is safely on disk
 *     (sync-media.mjs purges by default now).
 *
 * If the SSD is offline or the PC is off, nothing is lost — the items stay
 * queued in Turso and get drained on the next run.
 *
 * The task points at scripts\auto-sync.cmd (a generated batch wrapper)
 * instead of an inline `cmd /c ...` string, because schtasks mangles nested
 * quotes in /TR values.
 *
 * Usage:
 *   node scripts/install-auto-sync.mjs            # create or update the task
 *   node scripts/install-auto-sync.mjs --remove   # delete the task
 *
 * Output log: D:\aether\sync-media.log
 */

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TASK_NAME = "Aether Media Sync";
const MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES || 5);

if (process.platform !== "win32") {
  console.error("This installer only runs on Windows (Task Scheduler).");
  process.exit(1);
}

function runSchTasks(args) {
  const res = spawnSync("schtasks", args, { encoding: "utf8", shell: false });
  if (res.status !== 0) {
    console.error("schtasks failed:");
    console.error(res.stderr || res.stdout || "no output");
    process.exit(1);
  }
  return res.stdout;
}

const args = process.argv.slice(2);

if (args.includes("--remove")) {
  runSchTasks(["/Delete", "/TN", TASK_NAME, "/F"]);
  console.log(`Removed scheduled task "${TASK_NAME}".`);
  process.exit(0);
}

const root = process.cwd();
const node = process.execPath;
const script = join(root, "scripts", "sync-media.mjs");
const cmdFile = join(root, "scripts", "auto-sync.cmd");
const envFile = join(root, ".env.local");
const logFile = join(root, "sync-media.log");

if (!existsSync(script)) {
  console.error(`Not found: ${script}`);
  process.exit(1);
}
if (!existsSync(envFile)) {
  console.error(
    `Not found: ${envFile} — create it with your TURSO_URL / TURSO_AUTH_TOKEN / MEDIA_ROOT values first.`
  );
  process.exit(1);
}

// Generate the batch wrapper with the resolved Node path baked in.
const cmd = [
  "@echo off",
  "rem Aether media sync — run by the \"Aether Media Sync\" scheduled task.",
  `cd /d "${root}"`,
  `"${node}" --env-file="${envFile}" "${script}" >> "${logFile}" 2>&1`,
  "",
].join("\r\n");
writeFileSync(cmdFile, cmd, "utf8");

console.log(`Installing task "${TASK_NAME}" — every ${MINUTES} minute(s).`);
console.log(`Wrapper:    ${cmdFile}`);
console.log(`Sync log:   ${logFile}`);

runSchTasks([
  "/Create",
  "/F", // overwrite an existing task with this name
  "/TN",
  TASK_NAME,
  "/SC",
  "MINUTE",
  "/MO",
  String(MINUTES),
  "/TR",
  `"${cmdFile}"`,
]);

console.log("\nDone. The sync now runs automatically every 5 minutes while this PC is on.");
console.log("Items are drained to the D: drive and removed from Turso once safely on disk.");
console.log(`To stop it: node scripts/install-auto-sync.mjs --remove`);
