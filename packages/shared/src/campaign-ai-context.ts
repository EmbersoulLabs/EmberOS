import type { ContentLocale } from "./content-locale";
import { BrandProfileSchema, type BrandProfile, type VisionAnalysis } from "./types/index";

/**
 * PD-044 — canonical Campaign AI Context.
 *
 * Every Campaign AI module receives this object.
 * Modules may ignore fields they do not use; callers must not pass partial context.
 */
export interface CampaignAIContextAssetRef {
  id: string;
  type: string;
}

export interface CampaignAIContext {
  businessProfile: BrandProfile;
  campaignObjective: string;
  publishingPlatforms: string[];
  /** Structured Target Audience (not free-text Campaign Brief). */
  targetAudience: string | null;
  /** Sole free-text Campaign context. */
  campaignBrief: string | null;
  workspaceLanguage: ContentLocale | string;
  /** Optional enrichment — still part of the same context object when known. */
  assets?: CampaignAIContextAssetRef[];
  vision?: VisionAnalysis | null;
  transcript?: string | null;
}

export type BuildCampaignAIContextInput = {
  businessProfile?: BrandProfile | null;
  campaignObjective: string;
  publishingPlatforms?: string[] | null;
  targetAudience?: string | null;
  campaignBrief?: string | null;
  workspaceLanguage: ContentLocale | string;
  assets?: CampaignAIContextAssetRef[];
  vision?: VisionAnalysis | null;
  transcript?: string | null;
};

const EMPTY_BUSINESS_PROFILE: BrandProfile = BrandProfileSchema.parse({});

/** Build a complete CampaignAIContext (empty optionals are explicit null/[] defaults). */
export function buildCampaignAIContext(
  input: BuildCampaignAIContextInput
): CampaignAIContext {
  return {
    businessProfile: input.businessProfile ?? EMPTY_BUSINESS_PROFILE,
    campaignObjective: input.campaignObjective,
    publishingPlatforms: Array.isArray(input.publishingPlatforms)
      ? input.publishingPlatforms
      : [],
    targetAudience: input.targetAudience?.trim() || null,
    campaignBrief: input.campaignBrief?.trim() || null,
    workspaceLanguage: input.workspaceLanguage,
    ...(input.assets ? { assets: input.assets } : {}),
    vision: input.vision ?? null,
    transcript: input.transcript?.trim() || null,
  };
}

/** Patch optional enrichment fields without dropping required Campaign context. */
export function withCampaignAIContext(
  base: CampaignAIContext,
  patch: Partial<
    Pick<CampaignAIContext, "assets" | "vision" | "transcript" | "businessProfile">
  >
): CampaignAIContext {
  return {
    ...base,
    ...patch,
    businessProfile: patch.businessProfile ?? base.businessProfile,
    campaignObjective: base.campaignObjective,
    publishingPlatforms: base.publishingPlatforms,
    targetAudience: base.targetAudience,
    campaignBrief: base.campaignBrief,
    workspaceLanguage: base.workspaceLanguage,
  };
}

export function workspaceLanguageAsContentLocale(
  language: ContentLocale | string
): ContentLocale {
  if (language === "zh" || language === "en" || language === "ms") return language;
  if (/^zh/i.test(language)) return "zh";
  if (/^ms/i.test(language)) return "ms";
  return "en";
}
