import type { ContentLocale } from "./content-locale";
import {
  BrandProfileSchema,
  type BrandProfile,
  type VisionAnalysis,
} from "./types/index";
import type { StrategyPlan } from "./types/marketing-os";

/**
 * AD-001 / PD-044 — canonical Campaign AI Context.
 *
 * Every Campaign AI module receives this object from the Orchestrator (or
 * Auto Clip pipeline entry). Modules must not construct their own context.
 * Prompt implementations may ignore unused fields.
 */
export interface CampaignAIContextAssetRef {
  id: string;
  type: string;
}

export interface CampaignAIContext {
  /** Core — always present */
  businessProfile: BrandProfile;
  campaignObjective: string;
  publishingPlatforms: string[];
  /** Structured Target Audience (not free-text Campaign Brief). */
  targetAudience: string | null;
  /** Sole free-text Campaign context. */
  campaignBrief: string | null;
  workspaceLanguage: ContentLocale | string;

  /** Optional enrichment */
  assets?: CampaignAIContextAssetRef[];
  vision?: VisionAnalysis | null;
  transcript?: string | null;
  strategy?: StrategyPlan | null;
  generatedOutputs?: Record<string, unknown> | null;
  workflowMetadata?: Record<string, unknown> | null;
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
  strategy?: StrategyPlan | null;
  generatedOutputs?: Record<string, unknown> | null;
  workflowMetadata?: Record<string, unknown> | null;
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
    strategy: input.strategy ?? null,
    generatedOutputs: input.generatedOutputs ?? null,
    workflowMetadata: input.workflowMetadata ?? null,
  };
}

const CORE_KEYS = [
  "businessProfile",
  "campaignObjective",
  "publishingPlatforms",
  "targetAudience",
  "campaignBrief",
  "workspaceLanguage",
] as const;

/** Patch enrichment fields without dropping required Campaign context core. */
export function withCampaignAIContext(
  base: CampaignAIContext,
  patch: Partial<
    Pick<
      CampaignAIContext,
      | "assets"
      | "vision"
      | "transcript"
      | "businessProfile"
      | "strategy"
      | "generatedOutputs"
      | "workflowMetadata"
    >
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

/** True when an object has the AD-001 core Campaign AI Context fields. */
export function isCampaignAIContext(value: unknown): value is CampaignAIContext {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return CORE_KEYS.every((k) => k in o);
}

export function workspaceLanguageAsContentLocale(
  language: ContentLocale | string
): ContentLocale {
  if (language === "zh" || language === "en" || language === "ms") return language;
  if (/^zh/i.test(language)) return "zh";
  if (/^ms/i.test(language)) return "ms";
  return "en";
}
