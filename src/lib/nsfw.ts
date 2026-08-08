/**
 * Automated NSFW screening for uploaded images, powered by Cloudflare
 * Workers AI (`@cf/microsoft/resnet-50` image classification). This runs
 * server-side at upload time — before the media is ever visible — so explicit
 * content is quarantined (hidden from everyone but admins) and queued for
 * the moderation panel, instead of waiting for a human report.
 *
 * resnet-50 is a general 1000-class classifier, not a purpose-built NSFW
 * model, so we use a conservative heuristic: when the DOMINANT subject of an
 * image is recognized as underwear/swimwear/lingerie with high confidence,
 * it's flagged. Anything else (including all video) passes through; gore and
 * subtle cases still rely on reports → the same quarantine pipeline.
 *
 * The scan is strictly best-effort: if the AI binding is absent, inference
 * errors, or quota is exhausted, uploads proceed untouched.
 */

export interface NsfwVerdict {
  /** Whether a scan actually ran. */
  scanned: boolean;
  /** Quarantine-worthy. */
  flagged: boolean;
  /** 0..1 — highest confidence among NSFW-classified labels. */
  score: number;
  /** Human-readable reason for the admin review queue (null = clean). */
  reason: string | null;
}

const NSFW_KEYWORDS = [
  "brassiere",
  "bra,",
  "bathing trunks",
  "swimming trunks",
  "bikini",
  "maillot",
  "miniskirt",
  "mini skirt",
  "sarong",
  "lingerie",
  "underwear",
  "swimwear",
  "negligee",
  "panties",
  "slip",
];

/** Above this, the image is quarantined immediately. */
const HARD_THRESHOLD = 0.55;
/** Between here and hard, it's queued for human review but stays visible. */
const BORDERLINE_THRESHOLD = 0.3;

type AiRunner = { run: (model: string, input: unknown) => Promise<unknown> };

export async function classifyImage(
  ai: unknown,
  bytes: Uint8Array<ArrayBuffer>
): Promise<NsfwVerdict> {
  const runner = ai as AiRunner | null;
  if (!runner || typeof runner.run !== "function") {
    return { scanned: false, flagged: false, score: 0, reason: null };
  }
  try {
    const out = (await runner.run("@cf/microsoft/resnet-50", {
      image: Array.from(bytes),
    })) as {
      results?: { label: string; score: number }[];
      result?: { top?: { label: string; score: number }[] };
    };
    const results = out?.results ?? out?.result?.top ?? [];

    let maxScore = 0;
    let matchLabel: string | null = null;
    for (const r of results) {
      const label = String(r?.label ?? "").toLowerCase();
      if (NSFW_KEYWORDS.some((k) => label.includes(k))) {
        const score = Number(r?.score ?? 0);
        if (score > maxScore) {
          maxScore = score;
          matchLabel = label;
        }
      }
    }

    if (maxScore >= HARD_THRESHOLD) {
      return {
        scanned: true,
        flagged: true,
        score: maxScore,
        reason: `Automatically flagged as explicit by AI screening (${matchLabel})`,
      };
    }
    if (maxScore >= BORDERLINE_THRESHOLD) {
      return {
        scanned: true,
        flagged: false,
        score: maxScore,
        reason: `Possible explicit content — auto-queued for review (${matchLabel})`,
      };
    }
    return { scanned: true, flagged: false, score: maxScore, reason: null };
  } catch {
    // Inference failures (quota, model unavailable, bad bytes) never break uploads.
    return { scanned: false, flagged: false, score: 0, reason: null };
  }
}
