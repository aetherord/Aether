/**
 * Community content filter — "extreme slurs only".
 *
 * Blocks the handful of severe, hateful slurs (racist, homophobic,
 * transphobic, ableist) while leaving ordinary profanity ("fuck", "shit",
 * "bitch", …) alone. The matcher is obfuscation-tolerant — leetspeak
 * ("n1gg3r"), doubled letters ("nnigger", "niigga") and separators
 * ("n i g g a", "n*gger") are all caught — while normal words ("Nigeria",
 * "niggling", "raccoon", "cunning", "snigger") are not.
 *
 * Pure TS with no dependencies so it runs in both the Worker and the browser
 * (the client needs it too: E2E-encrypted DMs are unreadable server-side, so
 * the server filter can only catch plaintext messages).
 */

const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "6": "g",
  "7": "t",
  "8": "b",
  "9": "g",
  $: "s",
  "@": "a",
  "!": "i",
};

function decodeLeet(text: string): string {
  let out = "";
  for (const ch of text.toLowerCase()) out += LEET[ch] ?? ch;
  return out;
}

/**
 * Builds a regex for a banned word: every letter may be repeated 1–2 times
 * ("nnigger", "niigga") and any non-letter junk may sit between letters
 * ("n i g g a", "n*gger"). Word boundaries keep lookalike words clean
 * ("Niger", "cunning", "fagged").
 */
function slurPattern(word: string): RegExp {
  const core = word
    .split("")
    .map((ch) => `${ch}{1,2}`)
    .join("[^a-z]*");
  return new RegExp(`\\b${core}\\b`, "i");
}

const SLUR_PATTERNS: RegExp[] = [
  // The n-word family: nigga(s/z), nigger(s), niggah(s), niggur, nigg.
  // The "i" matches 0-2 times so doubled-vowel ("niigga") and vowel-dropped
  // ("n*gger", "n-gger") forms hit too.
  /\bn{1,2}[^a-z]*i{0,2}[^a-z]*g{1,2}[^a-z]*g{1,2}[^a-z]*[aeu]{0,2}[^a-z]*(?:[rhsz]{1,2})?\b/i,
  slurPattern("sandnigger"),

  // Homophobic — vowel may be dropped ("f*ggot") and the second g may be
  // single ("fagot"); plurals covered by the optional trailing s.
  /\bf{1,2}[^a-z]*a{0,2}[^a-z]*g{1,2}[^a-z]*(?:g{1,2})?[^a-z]*o{1,2}[^a-z]*t{1,2}(?:s{1,2})?\b/i,
  slurPattern("fag"),
  slurPattern("fags"),

  // Misogynistic (strongest tier)
  slurPattern("cunt"),
  slurPattern("cunts"),
  slurPattern("cunting"),
  slurPattern("kunt"),

  // Racist / ethnic
  slurPattern("kike"),
  slurPattern("kikes"),
  slurPattern("spic"),
  slurPattern("spics"),
  slurPattern("spick"),
  slurPattern("wetback"),
  slurPattern("wetbacks"),
  // Note: the innocent idiom "a chink in the armor" is also blocked — the
  // slur usage is far more common in chat, so we accept the tradeoff.
  slurPattern("chink"),
  slurPattern("chinks"),
  slurPattern("gook"),
  slurPattern("gooks"),
  slurPattern("beaner"),
  slurPattern("beaners"),
  slurPattern("towelhead"),
  slurPattern("towelheads"),
  slurPattern("paki"),
  slurPattern("pakis"),

  // Transphobic: tranny / trannies / tranie
  /\bt{1,2}[^a-z]*r{1,2}[^a-z]*a{1,2}[^a-z]*(?:n{1,2}){1,2}[^a-z]*(?:y{1,2}|i{1,2}e{1,2}s)\b/i,

  // Ableist: retard / retarded / retards (but not "retardation")
  /\br{1,2}[^a-z]*e{1,2}[^a-z]*t{1,2}[^a-z]*a{1,2}[^a-z]*r{1,2}[^a-z]*d{1,2}[^a-z]*(?:e{1,2}d{1,2})?(?:s{1,2})?\b/i,
  slurPattern("retarted"), // common misspelling
];

/** True when the text contains an extreme slur, in any common obfuscation. */
export function containsExtremeSlur(text: string): boolean {
  const decoded = decodeLeet(text);
  return SLUR_PATTERNS.some((re) => re.test(decoded));
}

/** Friendly, word-agnostic message shown when a message is blocked. */
export const SLUR_BLOCK_MESSAGE = "That kind of language isn't allowed here.";
