import type { NextConfig } from "next";

/**
 * NOTE: `output: "export"` was removed on purpose.
 *
 * This app is deployed with OpenNext Cloudflare, so the `/api/auth/*` route
 * handlers must run server-side inside the Cloudflare Worker (where the D1
 * `DB` binding is available). A static export would strip the API routes out
 * and silently break authentication.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
