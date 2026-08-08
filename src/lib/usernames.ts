/**
 * Usernames that impersonate companies/brands are not allowed — no taking
 * "Apple", "Google", "Microsoft" etc. as a handle. Matching is
 * case-insensitive, strips underscores, and also catches plural/suffix
 * variants ("googleofficial", "microsoft_").
 *
 * This module is client-safe (no server imports) so the signup form can show
 * the error before the request; the server enforces the same rule.
 */
const RESERVED_BRAND_NAMES = [
  "apple",
  "google",
  "microsoft",
  "windows",
  "meta",
  "facebook",
  "instagram",
  "whatsapp",
  "amazon",
  "netflix",
  "spotify",
  "tiktok",
  "snapchat",
  "discord",
  "telegram",
  "x",
  "twitter",
  "openai",
  "chatgpt",
  "nvidia",
  "intel",
  "amd",
  "samsung",
  "sony",
  "playstation",
  "xbox",
  "nintendo",
  "tesla",
  "spacex",
  "uber",
  "airbnb",
  "paypal",
  "visa",
  "mastercard",
  "cloudflare",
  "github",
  "reddit",
  "linkedin",
  "youtube",
  "wikipedia",
  "aether",
  "admin",
  "moderator",
  "support",
  "system",
  "official",
];

/** True when a username collides with a reserved brand/role name. */
export function isReservedUsername(username: string): boolean {
  const normalized = username.toLowerCase().replace(/_/g, "");
  return RESERVED_BRAND_NAMES.some(
    (name) =>
      normalized === name ||
      normalized.startsWith(`${name}official`) ||
      normalized.startsWith(`${name}team`)
  );
}
