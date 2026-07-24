/**
 * AD-001 — Orchestrator-owned Campaign AI Context provider.
 *
 * This is the ONLY application entry that may call `buildCampaignAIContext`.
 * Campaign AI modules must receive context from the Orchestrator (or pipeline
 * paths that use this provider); they must never assemble Campaign context.
 */
import {
  buildCampaignAIContext,
  effectiveCampaignGoal,
  parseCampaignCreativeBrief,
  resolvePipelineContentLocale,
  withCampaignAIContext,
  type BrandProfile,
  type BuildCampaignAIContextInput,
  type CampaignAIContext,
  type CampaignAIContextAssetRef,
  type StrategyPlan,
  type VisionAnalysis,
} from "@ceo-agent/shared";

export type ProvideCampaignAIContextInput = BuildCampaignAIContextInput;

/** Construct the canonical CampaignAIContext for a Campaign AI run. */
export function provideCampaignAIContext(
  input: ProvideCampaignAIContextInput
): CampaignAIContext {
  return buildCampaignAIContext(input);
}

/** Enrich optional fields without allowing modules to rebuild core context. */
export function enrichCampaignAIContext(
  base: CampaignAIContext,
  patch: Parameters<typeof withCampaignAIContext>[1]
): CampaignAIContext {
  return withCampaignAIContext(base, patch);
}

type CampaignRowForContext = {
  goal?: string | null;
  platforms?: string[] | null;
  targetAudienceOverride?: string | null;
  metadata?: Record<string, unknown> | null;
  campaignGoal?: string | null;
  creativeBriefJson?: unknown;
  creativeBrief?: unknown;
  [key: string]: unknown;
};

/**
 * Rebuild CampaignAIContext after render / retry / score using the same
 * effective objective + brief rules as the main pipeline entry.
 */
export function provideCampaignAIContextFromCampaign(params: {
  brandProfile: BrandProfile;
  campaign: CampaignRowForContext;
  vision?: VisionAnalysis | null;
  strategy?: StrategyPlan | null;
  assets?: CampaignAIContextAssetRef[];
  transcript?: string | null;
}): CampaignAIContext {
  const creativeBrief = parseCampaignCreativeBrief(params.campaign);
  const campaignMeta = (params.campaign.metadata ?? {}) as Record<string, unknown>;
  const contentLocale = resolvePipelineContentLocale(campaignMeta, params.campaign.goal);
  const goal = effectiveCampaignGoal(creativeBrief, params.campaign.goal, contentLocale);

  return provideCampaignAIContext({
    businessProfile: params.brandProfile,
    campaignObjective: goal,
    publishingPlatforms: params.campaign.platforms ?? [],
    targetAudience: params.campaign.targetAudienceOverride,
    campaignBrief: creativeBrief.campaignBrief,
    workspaceLanguage: contentLocale,
    assets: params.assets,
    vision: params.vision ?? null,
    strategy: params.strategy ?? null,
    transcript: params.transcript ?? null,
  });
}

export type { CampaignAIContext, ProvideCampaignAIContextInput as CampaignAIContextInput };
