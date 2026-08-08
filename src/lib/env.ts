import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Reads a secret from the environment.
 *
 * Works both in the OpenNext Cloudflare Worker (via the injected context) and
 * in plain `next dev` (via `process.env`). Never returns the empty string.
 */
export function getSecret(key: string): string | undefined {
  const fromProcess = process.env[key];
  if (fromProcess && fromProcess.length > 0) return fromProcess;

  try {
    const ctx = getCloudflareContext({ async: false });
    const value = (ctx.env as unknown as Record<string, unknown>)[key];
    if (typeof value === "string" && value.length > 0) return value;
  } catch {
    // Not running inside the Cloudflare Worker (e.g. plain `next dev`).
  }
  return undefined;
}

/** True when running inside the OpenNext Cloudflare Worker (or its dev CLI). */
export function hasCloudflareContext(): boolean {
  return Boolean(
    (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")]
  );
}

/**
 * Returns the Workers AI binding (`env.AI`) when the Worker declares one in
 * wrangler.toml — or null in plain `next dev` / accounts without Workers AI.
 * The binding is optional: NSFW screening degrades gracefully without it.
 */
export function getAiBinding(): unknown {
  try {
    const ctx = getCloudflareContext({ async: false });
    return (ctx.env as unknown as Record<string, unknown>).AI ?? null;
  } catch {
    // Not inside the Worker — no binding available.
    return null;
  }
}
