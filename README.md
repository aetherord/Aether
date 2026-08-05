# OpenNext Starter

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Read the documentation at https://opennext.js.org/cloudflare.

## Develop

Run the Next.js development server:

```bash
npm run dev
# or similar package manager command
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Preview

Preview the application locally on the Cloudflare runtime:

```bash
npm run preview
# or similar package manager command
```

## Deploy

Deploy the application to Cloudflare:

```bash
npm run deploy
# or similar package manager command
```

## Authentication setup

Auth is email-code based (Brevo for delivery) with optional TOTP 2FA. All logic
lives in the API routes (`src/app/api/auth/*`) backed by a shared store — D1 in
production, an in-memory fallback in plain `next dev`. Verification codes are
**never printed or returned**; they only travel by email.

Required environment (see `.env.example`):

- `JWT_SECRET` — used to derive the AES-256-GCM key that encrypts 2FA secrets
  at rest.
- `BREVO_API_KEY` — email delivery. Without it `/api/auth/code` returns 503.

Optional:

- `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — Cloudflare
  Turnstile bot protection on signup/code requests (enforced only when configured).
- `TURSO_URL` + `TURSO_AUTH_TOKEN` — media queue for chat image uploads (see below).

## Media / images

Uploaded chat images are stored in a Turso queue, served back to the web chat
from there, and mirrored to the local archive:

```bash
node --env-file=.env.local scripts/sync-media.mjs
```

The archive lives at `D:\Aether-Images-and-media` (protected on the drive —
only your Windows account and SYSTEM can read it) with an 80 GB cap and a
`sender\recipient\file` folder layout. Set `MEDIA_PURGE_AFTER_SYNC=true` to
delete the cloud copy after syncing (the image then only exists locally).

Local dev:

```bash
npm run dev            # uses the in-memory store; needs BREVO_API_KEY for codes
opennextjs-cloudflare dev  # Cloudflare runtime with local D1
```

Production secrets are set in the Cloudflare dashboard (or `.dev.vars` for
local Cloudflare runs). The D1 `DB` binding (already in `wrangler.toml`)
supplies the schema automatically on first use.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!
