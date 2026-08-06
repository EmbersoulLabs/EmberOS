import { z } from "zod";
import { cleanOriginalFilename } from "../asset-display-name";

/**
 * Approved content-intelligence keys for PD-040 naming.
 * Opaque filenames alone are not content intelligence.
 */
export const ASSET_CONTENT_INTELLIGENCE_KEYS = [
  "contentSummary",
  "visionSummary",
  "analysisSummary",
  "contentDescription",
  "contentLabels",
  "visionLabels",
  "labels",
] as const;

export const AssetDisplayNameSkillInputSchema = z.object({
  originalFilename: z.string().trim().min(1).max(500),
  type: z.string().trim().min(1).max(64),
  mimeType: z.string().trim().max(200).nullable().optional(),
  /** Non-empty content intelligence required for AI naming. */
  contentSummary: z.string().trim().min(1).max(4000).optional(),
  contentLabels: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
});

export type AssetDisplayNameSkillInput = z.infer<typeof AssetDisplayNameSkillInputSchema>;

export const AssetDisplayNameSkillOutputSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
});

export type AssetDisplayNameSkillOutput = z.infer<typeof AssetDisplayNameSkillOutputSchema>;

export function normalizeAssetDisplayNameOutput(
  raw: unknown
): AssetDisplayNameSkillOutput {
  const parsed = AssetDisplayNameSkillOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid asset name output");
  }
  const displayName = parsed.data.displayName.replace(/\.[a-z0-9]+$/i, "").trim();
  if (displayName.length < 2) {
    throw new Error("Display name too short");
  }
  return { displayName: displayName.slice(0, 120) };
}

export type AssetContentIntelligence = {
  available: boolean;
  contentSummary: string | null;
  contentLabels: string[];
};

/** Extract approved content intelligence from asset metadata (if any). */
export function extractAssetContentIntelligence(
  metadata: Record<string, unknown> | null | undefined
): AssetContentIntelligence {
  if (!metadata || typeof metadata !== "object") {
    return { available: false, contentSummary: null, contentLabels: [] };
  }

  const summaryCandidates = [
    metadata.contentSummary,
    metadata.visionSummary,
    metadata.analysisSummary,
    metadata.contentDescription,
  ];
  let contentSummary: string | null = null;
  for (const candidate of summaryCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      contentSummary = candidate.trim().slice(0, 4000);
      break;
    }
  }

  const labelSources = [metadata.contentLabels, metadata.visionLabels, metadata.labels];
  const contentLabels: string[] = [];
  for (const source of labelSources) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      if (typeof item === "string" && item.trim()) {
        contentLabels.push(item.trim().slice(0, 80));
      }
      if (contentLabels.length >= 20) break;
    }
    if (contentLabels.length > 0) break;
  }

  return {
    available: Boolean(contentSummary) || contentLabels.length > 0,
    contentSummary,
    contentLabels,
  };
}

export function fallbackAssetDisplayName(originalFilename: string): string {
  return cleanOriginalFilename(originalFilename);
}
