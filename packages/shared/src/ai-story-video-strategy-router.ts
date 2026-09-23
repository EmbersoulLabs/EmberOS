/**
 * Provider-neutral planning router for an already classified video observation.
 * Campaign, Scene, and Episode are planning context. They are not part of the
 * reusable asset analysis. This module does not extract observations from media,
 * persist analysis, or call a Provider.
 */
import {
  AI_STORY_VIDEO_ANALYSIS_PROVIDER_CALLS,
  AI_STORY_VIDEO_ANALYSIS_PROVIDER_COST_USD,
  AI_STORY_VIDEO_QUALITY_RISK_FLAGS,
  AiStoryVideoAssetAnalysisSchema,
  videoAssetAnalysisReuseKey,
  type AiStoryVideoAssetAnalysis,
} from "./ai-story-video-asset-analysis";

export const AI_STORY_VIDEO_PLANNING_STRATEGIES = [
  "USE_AS_EXISTING_VIDEO",
  "GENERATE_WITH_ACTION_REFERENCE",
  "GENERATE_WITH_ENVIRONMENT_REFERENCE",
  "GENERATE_WITH_ACTION_AND_ENVIRONMENT_REFERENCE",
  "REQUEST_STRICT_V2V_IF_PROVIDER_AVAILABLE",
  "IGNORE_AS_REFERENCE",
] as const;

export const AI_STORY_VIDEO_USER_INTENTS = [
  "KEEP_ENVIRONMENT",
  "FOLLOW_HAND_ACTION",
  "USE_VIDEO_DIRECTLY",
  "REPLACE_PERSON_KEEP_MOTION",
] as const;

const USER_INTENT_PHRASES: Record<string, (typeof AI_STORY_VIDEO_USER_INTENTS)[number]> = {
  "keep the environment": "KEEP_ENVIRONMENT",
  "use this street": "KEEP_ENVIRONMENT",
  "follow this hand action": "FOLLOW_HAND_ACTION",
  "just use this video directly": "USE_VIDEO_DIRECTLY",
  "use this video directly": "USE_VIDEO_DIRECTLY",
  "same video, just replace person": "REPLACE_PERSON_KEEP_MOTION",
  "same motion just replace person": "REPLACE_PERSON_KEEP_MOTION",
  "same motion, just replace person": "REPLACE_PERSON_KEEP_MOTION",
};

const STRATEGY_BY_REFERENCE_USE = {
  ACTION_REFERENCE: "GENERATE_WITH_ACTION_REFERENCE",
  ENVIRONMENT_REFERENCE: "GENERATE_WITH_ENVIRONMENT_REFERENCE",
  ACTION_AND_ENVIRONMENT_REFERENCE: "GENERATE_WITH_ACTION_AND_ENVIRONMENT_REFERENCE",
  EXISTING_VIDEO: "USE_AS_EXISTING_VIDEO",
  STRICT_V2V_CANDIDATE: "REQUEST_STRICT_V2V_IF_PROVIDER_AVAILABLE",
  UNSUITABLE_VIDEO_REFERENCE: "IGNORE_AS_REFERENCE",
} as const;

export type AiStoryVideoPlanningStrategy = (typeof AI_STORY_VIDEO_PLANNING_STRATEGIES)[number];
export type AiStoryVideoUserIntent = (typeof AI_STORY_VIDEO_USER_INTENTS)[number];

export type AiStoryVideoPlanningRoute = {
  readonly strategy: AiStoryVideoPlanningStrategy;
  readonly recommendedReferenceUse: AiStoryVideoAssetAnalysis["recommendedReferenceUse"];
  readonly reuseKey: string;
  readonly reusedAnalysis: true;
  readonly dispatched: false;
  readonly providerCalls: 0;
  readonly providerCostUsd: 0;
  readonly strictV2vProviderAvailable: boolean;
  readonly userIntent: AiStoryVideoUserIntent | null;
  readonly rationale: string;
};

function normalizePhrase(value: string): string {
  return value.trim().toLowerCase().replace(/[.]+$/g, "").trim();
}

export function parseBoundedVideoUserIntent(value: string): AiStoryVideoUserIntent | null {
  return USER_INTENT_PHRASES[normalizePhrase(value)] ?? null;
}

export function resolveVideoUserIntent(
  value: AiStoryVideoUserIntent | string | null | undefined,
): AiStoryVideoUserIntent | null {
  if (!value) return null;
  if ((AI_STORY_VIDEO_USER_INTENTS as readonly string[]).includes(value)) {
    return value as AiStoryVideoUserIntent;
  }
  return parseBoundedVideoUserIntent(value);
}

function blockingQuality(analysis: AiStoryVideoAssetAnalysis): boolean {
  return analysis.qualityRiskFlags.some((flag) =>
    (AI_STORY_VIDEO_QUALITY_RISK_FLAGS as readonly string[]).includes(flag)
  );
}

function applyUserIntent(
  analysis: AiStoryVideoAssetAnalysis,
  intent: AiStoryVideoUserIntent | null,
  base: AiStoryVideoPlanningStrategy,
): AiStoryVideoPlanningStrategy {
  if (!intent) return base;
  if (analysis.recommendedReferenceUse === "UNSUITABLE_VIDEO_REFERENCE" || blockingQuality(analysis)) {
    return "IGNORE_AS_REFERENCE";
  }
  if (intent === "KEEP_ENVIRONMENT") {
    return analysis.environmentReferenceStrength
      ? "GENERATE_WITH_ENVIRONMENT_REFERENCE"
      : base;
  }
  if (intent === "FOLLOW_HAND_ACTION") {
    return analysis.actionReferenceStrength || analysis.handMotionImportant
      ? "GENERATE_WITH_ACTION_REFERENCE"
      : base;
  }
  if (intent === "USE_VIDEO_DIRECTLY") {
    return analysis.canUseAsExistingVideo
      ? "USE_AS_EXISTING_VIDEO"
      : base;
  }
  if (
    intent === "REPLACE_PERSON_KEEP_MOTION" &&
    analysis.primaryPersonPresent &&
    (analysis.actionReferenceStrength || analysis.interactionTimingImportant)
  ) {
    return "REQUEST_STRICT_V2V_IF_PROVIDER_AVAILABLE";
  }
  return base;
}

export function routeAiStoryVideoPlanningStrategy(input: {
  readonly analysis: AiStoryVideoAssetAnalysis;
  readonly userIntent?: AiStoryVideoUserIntent | string | null;
  readonly executionContext?: {
    readonly strictV2vProviderAvailable?: boolean;
    readonly campaignId?: string;
    readonly sceneId?: string;
    readonly episodeId?: string;
  };
}): AiStoryVideoPlanningRoute {
  const analysis = AiStoryVideoAssetAnalysisSchema.parse(input.analysis);
  const userIntent = resolveVideoUserIntent(input.userIntent);
  const base = STRATEGY_BY_REFERENCE_USE[analysis.recommendedReferenceUse];
  const strategy = applyUserIntent(analysis, userIntent, base);
  return {
    strategy,
    recommendedReferenceUse: analysis.recommendedReferenceUse,
    reuseKey: videoAssetAnalysisReuseKey(analysis),
    reusedAnalysis: true,
    dispatched: false,
    providerCalls: AI_STORY_VIDEO_ANALYSIS_PROVIDER_CALLS,
    providerCostUsd: AI_STORY_VIDEO_ANALYSIS_PROVIDER_COST_USD,
    strictV2vProviderAvailable: input.executionContext?.strictV2vProviderAvailable === true,
    userIntent,
    rationale: analysis.rationale,
  };
}
