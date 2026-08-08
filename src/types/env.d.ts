/**
 * Environment augmentations. These merge with the generated
 * `cloudflare-env.d.ts` (which is overwritten by `npm run cf-typegen`).
 */

interface CloudflareEnv {
  DB: D1Database;
  JWT_SECRET?: string;
  BREVO_API_KEY?: string;
  BREVO_SENDER_EMAIL?: string;
  BREVO_SENDER_NAME?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURSO_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  AI?: unknown;
}

declare namespace NodeJS {
  interface ProcessEnv {
    JWT_SECRET?: string;
    BREVO_API_KEY?: string;
    BREVO_SENDER_EMAIL?: string;
    BREVO_SENDER_NAME?: string;
    TURNSTILE_SECRET_KEY?: string;
    NEXT_PUBLIC_TURNSTILE_SITE_KEY?: string;
    TURSO_URL?: string;
    TURSO_AUTH_TOKEN?: string;
    TURN_KEY_ID?: string;
    TURN_KEY_API_TOKEN?: string;
    MEDIA_ROOT?: string;
    MEDIA_MAX_GB?: string;
    MEDIA_PURGE_AFTER_SYNC?: string;
  }
}
