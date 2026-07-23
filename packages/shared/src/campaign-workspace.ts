import { z } from "zod";
import {
  PUBLISHING_PLATFORM_LANGUAGE_RULES,
  PublishingPlatformsSchema,
  sanitizePublishingPlatforms,
  type PublishingPlatformId,
} from "./publishing-platforms";

/** Interim approved Campaign Objective dictionary (Sprint 0003). */
export const CAMPAIGN_OBJECTIVES = [
  "awareness",
  "engagement",
  "sales",
  "lead_generation",
  "other",
] as const;

export type CampaignObjective = (typeof CAMPAIGN_OBJECTIVES)[number];

export const CAMPAIGN_OBJECTIVE_LABELS: Record<CampaignObjective, string> = {
  awareness: "Awareness",
  engagement: "Engagement",
  sales: "Sales",
  lead_generation: "Lead Generation",
  other: "Other",
};

export function isCampaignObjective(value: unknown): value is CampaignObjective {
  return typeof value === "string" && (CAMPAIGN_OBJECTIVES as readonly string[]).includes(value);
}

/** SPEC-002 Campaign Language fields — UI locales. */
export const CAMPAIGN_LANGUAGE_CODES = ["en", "zh", "ms"] as const;
export type CampaignLanguageCode = (typeof CAMPAIGN_LANGUAGE_CODES)[number];

export function isCampaignLanguageCode(value: unknown): value is CampaignLanguageCode {
  return typeof value === "string" && (CAMPAIGN_LANGUAGE_CODES as readonly string[]).includes(value);
}

export type CampaignLanguages = {
  outputLanguage: CampaignLanguageCode;
  subtitleLanguage: CampaignLanguageCode;
  ctaLanguage: CampaignLanguageCode;
  hashtagLanguage: CampaignLanguageCode;
};

export function defaultCampaignLanguages(uiLocale: string): CampaignLanguages {
  const code: CampaignLanguageCode = isCampaignLanguageCode(uiLocale) ? uiLocale : "en";
  return {
    outputLanguage: code,
    subtitleLanguage: code,
    ctaLanguage: code,
    hashtagLanguage: code,
  };
}

/**
 * PD-042 / PD-038 — infer Caption / Subtitle / CTA / Hashtag languages from:
 * Workspace UI Language + selected Publishing Platforms + platform rules.
 * Values are read-only in V1 (no manual override).
 */
export function inferCampaignLanguages(
  uiLocale: string,
  platforms: readonly string[] = []
): CampaignLanguages {
  const base = defaultCampaignLanguages(uiLocale);
  const selected = sanitizePublishingPlatforms(platforms);
  if (selected.length === 0) return base;

  const hints = selected
    .map((id) => PUBLISHING_PLATFORM_LANGUAGE_RULES[id as PublishingPlatformId])
    .filter((code): code is CampaignLanguageCode => isCampaignLanguageCode(code));

  // Override only when every selected platform shares one language rule.
  if (
    hints.length === selected.length &&
    hints.length > 0 &&
    hints.every((code) => code === hints[0])
  ) {
    const code = hints[0]!;
    return {
      outputLanguage: code,
      subtitleLanguage: code,
      ctaLanguage: code,
      hashtagLanguage: code,
    };
  }

  return base;
}

/** SPEC-002 Marketing Package placeholder cards (no AI). */
export const MARKETING_PACKAGE_PLACEHOLDER_ITEMS = [
  "strategy",
  "report",
  "hook",
  "caption",
  "cta",
  "hashtags",
  "subtitle",
  "video_reference",
  "marketing_score",
] as const;

export type MarketingPackagePlaceholderItem =
  (typeof MARKETING_PACKAGE_PLACEHOLDER_ITEMS)[number];

/** Non-AI Generate placeholder states (Sprint 0003). */
export const GENERATE_PLACEHOLDER_STATES = [
  "idle",
  "waiting",
  "processing",
  "completed",
  "failed",
] as const;

export type GeneratePlaceholderState = (typeof GENERATE_PLACEHOLDER_STATES)[number];

export const CampaignWorkspacePatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  objective: z.enum(CAMPAIGN_OBJECTIVES).optional(),
  objectiveCustom: z.string().trim().max(500).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  targetAudienceOverride: z.string().trim().max(2000).nullable().optional(),
  campaignBrief: z.string().trim().max(10000).nullable().optional(),
  outputLanguage: z.enum(CAMPAIGN_LANGUAGE_CODES).optional(),
  subtitleLanguage: z.enum(CAMPAIGN_LANGUAGE_CODES).optional(),
  ctaLanguage: z.enum(CAMPAIGN_LANGUAGE_CODES).optional(),
  hashtagLanguage: z.enum(CAMPAIGN_LANGUAGE_CODES).optional(),
  platforms: PublishingPlatformsSchema.optional(),
});

export const CampaignWorkspaceCreateSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  objective: z.enum(CAMPAIGN_OBJECTIVES),
  objectiveCustom: z.string().trim().max(500).optional(),
  description: z.string().trim().max(5000).optional(),
  targetAudienceOverride: z.string().trim().max(2000).optional(),
  campaignBrief: z.string().trim().max(10000).optional(),
  outputLanguage: z.enum(CAMPAIGN_LANGUAGE_CODES).optional(),
  subtitleLanguage: z.enum(CAMPAIGN_LANGUAGE_CODES).optional(),
  ctaLanguage: z.enum(CAMPAIGN_LANGUAGE_CODES).optional(),
  hashtagLanguage: z.enum(CAMPAIGN_LANGUAGE_CODES).optional(),
  platforms: PublishingPlatformsSchema.optional(),
});

export function appendUniqueId(current: string[], id: string): string[] {
  return current.includes(id) ? current : [...current, id];
}

export function directAssetsForStoryMode(
  selectedAssetIds: string[],
  storyAssetIds: string[]
): string[] {
  const storyAssets = new Set(storyAssetIds);
  return selectedAssetIds.filter((id) => !storyAssets.has(id));
}

export type GenerateValidationInput = {
  name?: string | null;
  objective?: string | null;
  objectiveCustom?: string | null;
  outputLanguage?: string | null;
  subtitleLanguage?: string | null;
  ctaLanguage?: string | null;
  hashtagLanguage?: string | null;
  assetCount: number;
  storyCount: number;
};

export type GenerateValidationResult =
  | { ok: true; summary: Record<string, string | number | boolean> }
  | { ok: false; errors: string[] };

export function validateCampaignForGenerate(
  input: GenerateValidationInput
): GenerateValidationResult {
  const errors: string[] = [];

  if (!input.name?.trim()) errors.push("Campaign Name is required");

  if (!isCampaignObjective(input.objective)) {
    errors.push("Campaign Objective is required");
  } else if (input.objective === "other" && !input.objectiveCustom?.trim()) {
    errors.push("Custom objective is required when Other is selected");
  }

  for (const [label, value] of [
    ["Output Language", input.outputLanguage],
    ["Subtitle Language", input.subtitleLanguage],
    ["CTA Language", input.ctaLanguage],
    ["Hashtag Language", input.hashtagLanguage],
  ] as const) {
    if (!isCampaignLanguageCode(value)) errors.push(`${label} is required`);
  }

  if (input.assetCount <= 0 && input.storyCount <= 0) {
    errors.push("Select at least one Asset or Ready Story before Generate");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    summary: {
      name: input.name!.trim(),
      objective:
        input.objective === "other"
          ? input.objectiveCustom!.trim()
          : CAMPAIGN_OBJECTIVE_LABELS[input.objective as CampaignObjective],
      outputLanguage: input.outputLanguage!,
      subtitleLanguage: input.subtitleLanguage!,
      ctaLanguage: input.ctaLanguage!,
      hashtagLanguage: input.hashtagLanguage!,
      assetCount: input.assetCount,
      storyCount: input.storyCount,
      aiGeneration: false,
      note: "Generate validates inputs only. AI Marketing Package generation is not run in this Sprint.",
    },
  };
}

/** Final Review and Create validation — does not invoke Marketing Package generation. */
export function validateCampaignForCreate(
  input: GenerateValidationInput
): GenerateValidationResult {
  const result = validateCampaignForGenerate(input);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors.map((error) =>
        error.replace("before Generate", "before Create Campaign")
      ),
    };
  }
  return {
    ok: true,
    summary: {
      ...result.summary,
      aiGeneration: false,
      note: "Create Campaign finalizes the reviewed Campaign. Marketing Package generation remains a separate Workspace action.",
    },
  };
}

export function resolveCampaignObjectiveLabel(campaign: {
  objective?: string | null;
  objectiveCustom?: string | null;
  goal?: string | null;
}): string {
  if (isCampaignObjective(campaign.objective)) {
    if (campaign.objective === "other") {
      return campaign.objectiveCustom?.trim() || CAMPAIGN_OBJECTIVE_LABELS.other;
    }
    return CAMPAIGN_OBJECTIVE_LABELS[campaign.objective];
  }
  return campaign.goal?.trim() || "—";
}
