import { z } from "zod";

/** PD-042 canonical persistence identifiers, in deterministic display order. */
export const PUBLISHING_PLATFORM_IDS = [
  "tiktok",
  "instagram",
  "facebook",
  "linkedin",
  "xiaohongshu",
  "googleBusiness",
] as const;

export type PublishingPlatformId = (typeof PUBLISHING_PLATFORM_IDS)[number];

export const PublishingPlatformIdSchema = z.enum(PUBLISHING_PLATFORM_IDS);
export const PublishingPlatformsSchema = z
  .array(PublishingPlatformIdSchema)
  .transform((values) => canonicalizePublishingPlatforms(values));

const PLATFORM_ALIASES: Readonly<Record<string, PublishingPlatformId>> = {
  tiktok: "tiktok",
  instagram: "instagram",
  facebook: "facebook",
  linkedin: "linkedin",
  "linked-in": "linkedin",
  xiaohongshu: "xiaohongshu",
  rednote: "xiaohongshu",
  "red-note": "xiaohongshu",
  xhs: "xiaohongshu",
  googlebusiness: "googleBusiness",
  "google-business": "googleBusiness",
  google_business: "googleBusiness",
};

export function canonicalizePublishingPlatforms(
  values: readonly PublishingPlatformId[]
): PublishingPlatformId[] {
  const selected = new Set(values);
  return PUBLISHING_PLATFORM_IDS.filter((id) => selected.has(id));
}

export function normalizeStoredPublishingPlatforms(value: unknown): {
  recognized: PublishingPlatformId[];
  unrecognized: string[];
} {
  if (!Array.isArray(value)) return { recognized: [], unrecognized: [] };

  const recognized = new Set<PublishingPlatformId>();
  const unrecognized = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const raw = candidate.trim();
    const canonical = PLATFORM_ALIASES[raw.toLowerCase()];
    if (canonical) recognized.add(canonical);
    else unrecognized.add(raw);
  }

  return {
    recognized: PUBLISHING_PLATFORM_IDS.filter((id) => recognized.has(id)),
    unrecognized: [...unrecognized].sort((a, b) => a.localeCompare(b)),
  };
}
