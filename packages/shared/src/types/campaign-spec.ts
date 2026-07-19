/** SPEC-002 Campaign data types and validation. */

import type { ContentLocale } from "../content-locale";
import {
  CAMPAIGN_OBJECTIVE_CUSTOM_ID,
  isCampaignObjectiveId,
  type CampaignObjectiveId,
} from "../dictionaries/campaign-objective-dictionary";

export const CAMPAIGN_BUSINESS_STATUSES = [
  "draft",
  "active",
  "completed",
  "archived",
] as const;
export type CampaignBusinessStatus = (typeof CAMPAIGN_BUSINESS_STATUSES)[number];

export const REGENERATE_ACTIONS = [
  "all",
  "strategy",
  "caption",
  "cta",
  "hashtags",
  "subtitle",
  "video",
  "report",
] as const;
export type RegenerateAction = (typeof REGENERATE_ACTIONS)[number];

export const CAMPAIGN_SOFT_DELETE_RETENTION_DAYS = 7;

export const CONTENT_LOCALES: ContentLocale[] = ["zh", "en", "ms"];

export function isCampaignBusinessStatus(value: unknown): value is CampaignBusinessStatus {
  return (
    typeof value === "string" &&
    (CAMPAIGN_BUSINESS_STATUSES as readonly string[]).includes(value)
  );
}

export function isContentLocale(value: unknown): value is ContentLocale {
  return typeof value === "string" && (CONTENT_LOCALES as readonly string[]).includes(value);
}

export interface CampaignLanguageFields {
  outputLanguage: ContentLocale;
  subtitleLanguage: ContentLocale;
  ctaLanguage: ContentLocale;
  hashtagLanguage: ContentLocale;
}

export interface CampaignSpecInput {
  name: string;
  campaignObjectiveId: CampaignObjectiveId;
  campaignObjectiveCustom?: string | null;
  description?: string | null;
  targetAudienceOverride?: string | null;
  campaignBrief?: string | null;
  outputLanguage: ContentLocale;
  subtitleLanguage: ContentLocale;
  ctaLanguage: ContentLocale;
  hashtagLanguage: ContentLocale;
  tags?: string[];
  folder?: string | null;
  isFavorite?: boolean;
  assignedTo?: string | null;
  externalAssetUrl?: string | null;
}

export function validateCampaignObjective(
  objectiveId: unknown,
  customValue?: string | null
): { ok: true; objectiveId: CampaignObjectiveId } | { ok: false; error: string } {
  if (!isCampaignObjectiveId(objectiveId)) {
    return { ok: false, error: "Invalid campaign objective" };
  }
  if (objectiveId === CAMPAIGN_OBJECTIVE_CUSTOM_ID && !customValue?.trim()) {
    return { ok: false, error: "Custom campaign objective is required" };
  }
  return { ok: true, objectiveId };
}

export function validateCampaignLanguages(
  fields: Partial<CampaignLanguageFields>
): { ok: true; languages: CampaignLanguageFields } | { ok: false; error: string } {
  const { outputLanguage, subtitleLanguage, ctaLanguage, hashtagLanguage } = fields;
  if (
    !isContentLocale(outputLanguage) ||
    !isContentLocale(subtitleLanguage) ||
    !isContentLocale(ctaLanguage) ||
    !isContentLocale(hashtagLanguage)
  ) {
    return { ok: false, error: "All four language fields are required" };
  }
  return {
    ok: true,
    languages: { outputLanguage, subtitleLanguage, ctaLanguage, hashtagLanguage },
  };
}

export function defaultCampaignLanguages(uiLocale: string): CampaignLanguageFields {
  const locale: ContentLocale =
    uiLocale === "zh" || uiLocale === "ms" ? uiLocale : "en";
  return {
    outputLanguage: locale,
    subtitleLanguage: locale,
    ctaLanguage: locale,
    hashtagLanguage: locale,
  };
}

export function canGenerateCampaign(inputs: {
  assetCount: number;
  externalAssetUrl?: string | null;
}): boolean {
  return inputs.assetCount > 0 || Boolean(inputs.externalAssetUrl?.trim());
}

export interface MarketingPackageRefs {
  strategyRef?: string | null;
  reportRef?: string | null;
  hookRef?: string | null;
  captionRef?: string | null;
  ctaRef?: string | null;
  hashtagsRef?: string[] | null;
  subtitleRef?: string | null;
  videoRef?: string | null;
  marketingScore?: number | null;
}

export type AiGenerationUiState =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "partial";
