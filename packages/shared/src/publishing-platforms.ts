import { z } from "zod";

/**
 * PD-042 — Campaign / Business Profile Publishing Platforms.
 * Fixed dictionary for Default Publishing Platforms and Campaign Target Platforms.
 */
export const PUBLISHING_PLATFORM_IDS = [
  "tiktok",
  "instagram",
  "facebook",
  "linkedin",
  "xiaohongshu",
  "googleBusiness",
] as const;

export type PublishingPlatformId = (typeof PUBLISHING_PLATFORM_IDS)[number];

export const PUBLISHING_PLATFORM_LABELS: Record<PublishingPlatformId, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  xiaohongshu: "Xiaohongshu",
  googleBusiness: "Google Business",
};

export const PublishingPlatformIdSchema = z.enum(PUBLISHING_PLATFORM_IDS);

export const PublishingPlatformsSchema = z.array(PublishingPlatformIdSchema);

export function isPublishingPlatformId(value: unknown): value is PublishingPlatformId {
  return (
    typeof value === "string" &&
    (PUBLISHING_PLATFORM_IDS as readonly string[]).includes(value)
  );
}

/** Keep known ids, drop unknowns, preserve first-seen order. */
export function sanitizePublishingPlatforms(values: unknown): PublishingPlatformId[] {
  if (!Array.isArray(values)) return [];
  const out: PublishingPlatformId[] = [];
  for (const value of values) {
    if (!isPublishingPlatformId(value)) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

export function publishingPlatformLabel(id: string): string {
  return isPublishingPlatformId(id) ? PUBLISHING_PLATFORM_LABELS[id] : id;
}

export function formatPublishingPlatforms(platforms: readonly string[]): string {
  return sanitizePublishingPlatforms(platforms)
    .map((id) => PUBLISHING_PLATFORM_LABELS[id])
    .join(", ");
}

/**
 * Configurable platform → language preference rules (PD-042 / PD-038).
 * Not a hardcoded UI matrix — rules live here for inference consumers.
 */
export const PUBLISHING_PLATFORM_LANGUAGE_RULES: Partial<
  Record<PublishingPlatformId, "en" | "zh" | "ms">
> = {
  xiaohongshu: "zh",
};
