import type { NextConfig } from "next";

/**
 * NOTE: `output: "export"` was removed on purpose.
 *
 * This app is deployed with OpenNext Cloudflare, so the `/api/auth/*` route
 * handlers must run server-side inside the Cloudflare Worker (where the D1
 * `DB` binding is available). A static export would strip the API routes out
 * and silently break authentication.
 */
const nextConfig: NextConfig = {
  // OpenNext (Cloudflare) requires a standalone build so `.next/standalone`
  // exists before `opennextjs-cloudflare build` bundles the worker. Setting it
  // here (rather than only via OpenNext's internal env var) means plain
  // `npm run build` also produces everything the CI deploy step needs.
  output: "standalone",
};

export default nextConfig;
