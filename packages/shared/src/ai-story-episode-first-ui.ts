import {
  AI_STORY_OUTLINE_PROFILE_REGISTRY,
  canonicalAiStoryOutlineProfileReference,
  type AiStoryOutlineProfileReference,
} from "./ai-story-outline-profile";

export const AI_STORY_EPISODE_FIRST_UI_CONTRACT_VERSION =
  "ai-story-episode-first-ui.v1" as const;
export const USER_FACING_AUTHORITY = "EPISODE" as const;
export const SCENE_USER_UI_REQUIRED = false as const;
export const SCENE_INTERNAL_AUTHORITY_PRESERVED = true as const;
export const LEGACY_SCENE_STORY_PRESENTATION = "EPISODE_WRAPPER" as const;

export const AI_STORY_EPISODE_USER_TYPES = [
  "COMMERCIAL_STORY",
  "PRODUCT_STORY",
  "BRAND_STORY",
  "SERVICE_STORY",
  "FOOD_STORY",
  "EMOTIONAL_STORY",
  "ENTERTAINMENT_STORY",
] as const;
export type AiStoryEpisodeUserType =
  (typeof AI_STORY_EPISODE_USER_TYPES)[number];

export const AI_STORY_EPISODE_DURATIONS_SEC = [15, 30, 45, 60] as const;
export const AI_STORY_EPISODE_ASPECT_RATIOS = ["9:16", "16:9", "1:1"] as const;
export const AI_STORY_EPISODE_PACING = ["RELAXED", "NATURAL", "FAST"] as const;
export type AiStoryEpisodePacing = (typeof AI_STORY_EPISODE_PACING)[number];

export const AI_STORY_EPISODE_USER_STATUSES = [
  "Draft",
  "Planning",
  "Generating",
  "Editing",
  "Ready for Review",
  "Needs Attention",
  "Completed",
  "Exported",
] as const;
export type AiStoryEpisodeUserStatus =
  (typeof AI_STORY_EPISODE_USER_STATUSES)[number];

export const AI_STORY_EPISODE_PROGRESS_STEPS = [
  "Planning your episode",
  "Creating characters and locations",
  "Generating episode moments",
  "Editing the story",
  "Finalizing audio and video",
] as const;

export const AI_STORY_EPISODE_MOMENT_MARKERS = [
  "Hook",
  "Discovery",
  "Product",
  "Reaction",
  "Payoff",
  "CTA",
] as const;
export type AiStoryEpisodeMomentMarker =
  (typeof AI_STORY_EPISODE_MOMENT_MARKERS)[number];

export const AI_STORY_EPISODE_ENDING_INTENTS = [
  "stronger CTA",
  "softer ending",
  "brand-focused ending",
  "product-focused ending",
  "no CTA",
] as const;

export const BACKEND_GAP = "BACKEND_GAP" as const;

export const AI_STORY_EPISODE_ACTION_CERTIFICATION = Object.freeze({
  createEpisode: "CERTIFIED",
  generateEpisodePlanning: "CERTIFIED",
  timeRangeToInternalUnitMapping: "CERTIFIED",
  regenerateMomentExecution:
    "CERTIFIED_WITH_EXISTING_COMMERCIAL_RETRY_AUTHORITY",
  editDialogue: "DURABLE_RUNTIME_CERTIFIED",
  adjustEnding: "DURABLE_RUNTIME_CERTIFIED",
  adjustPacing: "DURABLE_RUNTIME_CERTIFIED",
  replaceReference: "DURABLE_RUNTIME_CERTIFIED",
  costEstimate: "CERTIFIED",
  actualCost: "CERTIFIED",
  partialFailureCopy: "CERTIFIED",
  partialFailureRetry: "CERTIFIED_WITH_EXISTING_RETRY_AUTHORITY",
  costEstimateIsAuthorization: false,
  hardcodedCostEstimate: false,
} as const);

export const AI_STORY_EPISODE_COPY = Object.freeze({
  createEpisode: "Create Episode",
  generateEpisode: "Generate Episode",
  yourEpisode: "Your Episode",
  finalEpisode: "Final Episode",
  episodePreview: "Episode Preview",
  finalEpisodePending:
    "Your final Episode will appear here after all moments are ready and assembled.",
  generatingMoments: "EmberOS is creating your Episode moments.",
  waitingForReview:
    "Review the generated moments below before the final Episode is assembled.",
  assembling: "Your moments are ready. EmberOS is assembling the final Episode.",
  assemblyFailed:
    "The final Episode could not be assembled. Your approved moments are preserved.",
  finalEpisodeTemporarilyUnavailable: "The final Episode is temporarily unavailable.",
  durationPending: "Duration pending",
  durationUnavailable: "Duration unavailable",
  reviewEpisode: "Review Episode",
  regenerateThisMoment: "Regenerate this moment",
  editDialogue: "Edit dialogue",
  replaceReference: "Replace reference",
  adjustEnding: "Adjust ending",
  adjustPacing: "Adjust pacing",
  export: "Export",
  retryFailedMoment: "Retry this moment",
  momentFailed: "This moment could not be generated.",
  partialFailure:
    "Most of your Episode is ready. One moment needs attention.",
  estimatedCost: "Estimated generation cost",
  actualCost: "Actual generation cost",
  nativeCharacterDialogue: "Native Character Dialogue",
  backendGap:
    "This action is not available until an existing backend authority can complete it.",
  regenerateRequiresRetryAuth:
    "This moment cannot be regenerated until existing retry authorization is complete.",
  costEstimateUnavailable:
    "Live Episode cost estimate is not available. Paid generation still uses existing billing confirmation at Execute.",
  costConfirmationRequired:
    "This revision needs commercial authorization before paid regeneration. The estimate is not spend authorization.",
  revisionHistory: "Episode versions",
  revisionSaved: "Revision saved",
  estimatedRegenerationCost: "Estimated regeneration cost",
  authorizeRegeneration: "Authorize regeneration",
} as const);

export const NORMAL_USER_HIDDEN_LABELS = [
  "Scene 1",
  "Scene 2",
  "Shot 1",
  "Generation Unit",
  "Approve Scene",
  "Regenerate Scene",
  "Edit Scene 3",
] as const;

export function mapEpisodeTypeToOutlineProfile(
  episodeType: AiStoryEpisodeUserType
): AiStoryOutlineProfileReference {
  let registered: (typeof AI_STORY_OUTLINE_PROFILE_REGISTRY)[keyof typeof AI_STORY_OUTLINE_PROFILE_REGISTRY];
  if (episodeType === "PRODUCT_STORY") {
    registered = AI_STORY_OUTLINE_PROFILE_REGISTRY.PRODUCT_STORY;
  } else if (
    episodeType === "EMOTIONAL_STORY" ||
    episodeType === "ENTERTAINMENT_STORY"
  ) {
    registered = AI_STORY_OUTLINE_PROFILE_REGISTRY.CORE;
  } else {
    registered = AI_STORY_OUTLINE_PROFILE_REGISTRY.COMMERCIAL_STORY;
  }
  return canonicalAiStoryOutlineProfileReference(registered);
}

export function mapInternalStoryStatusToEpisodeStatus(
  status: string
): AiStoryEpisodeUserStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "draft" || normalized === "pending_review") return "Draft";
  if (
    normalized === "ready_for_animation" ||
    normalized === "planning" ||
    normalized === "planning_review"
  ) {
    return "Planning";
  }
  if (normalized === "ready_for_execution" || normalized === "generate_review") {
    return "Ready for Review";
  }
  if (normalized === "executing") return "Generating";
  if (normalized === "execution_review") return "Editing";
  if (normalized === "execution_failed" || normalized === "failed") {
    return "Needs Attention";
  }
  if (normalized === "archived" || normalized === "completed") return "Completed";
  if (normalized === "exported") return "Exported";
  return "Draft";
}

export function episodeProgressStep(input: {
  readonly planningComplete: boolean;
  readonly charactersReady: boolean;
  readonly generating: boolean;
  readonly editing: boolean;
  readonly finalizing: boolean;
}): (typeof AI_STORY_EPISODE_PROGRESS_STEPS)[number] {
  if (!input.planningComplete) return "Planning your episode";
  if (!input.charactersReady) return "Creating characters and locations";
  if (input.generating) return "Generating episode moments";
  if (input.editing) return "Editing the story";
  return "Finalizing audio and video";
}

export function episodeMomentMarker(
  order: number,
  editorialRole?: string | null
): AiStoryEpisodeMomentMarker {
  const role = (editorialRole ?? "").toUpperCase();
  if (role === "ESTABLISH" || role === "HOOK") return "Hook";
  if (role === "DISCOVERY" || role === "ACTION") return "Discovery";
  if (role === "DETAIL" || role === "HERO" || role === "PRODUCT") return "Product";
  if (role === "REACTION") return "Reaction";
  if (role === "PAYOFF") return "Payoff";
  if (role === "CTA") return "CTA";
  return AI_STORY_EPISODE_MOMENT_MARKERS[
    Math.min(order, AI_STORY_EPISODE_MOMENT_MARKERS.length - 1)
  ]!;
}

export type AiStoryEpisodeTimelineMoment = {
  readonly startMs: number;
  readonly endMs: number;
  readonly marker: AiStoryEpisodeMomentMarker;
  readonly generationUnitId: string;
  readonly directorShotId: string;
  readonly sceneId: string;
  readonly sceneOrder: number;
  readonly status: "ready" | "generating" | "failed" | "needs_attention";
  readonly runtimeState?: string;
  readonly retryAuthorizationId?: string | null;
  readonly timeRangeAuthority?: "RECORDED" | typeof BACKEND_GAP;
  readonly scriptEntryId?: string;
  readonly dialogueLine?: string;
};

export type EpisodeMomentRepairAuthority =
  | {
      readonly kind: "PRE_DISPATCH_RECOVERY";
      readonly sceneExecutionId: string;
    }
  | {
      readonly kind: "RETRY_AUTHORIZED";
      readonly sceneExecutionId: string;
      readonly retryAuthorizationId: string;
    }
  | {
      readonly kind: typeof BACKEND_GAP;
      readonly reason: string;
    };

export function classifyEpisodeMomentRepair(input: {
  readonly runtimeState?: string | null;
  readonly retryAuthorizationId?: string | null;
  readonly sceneExecutionId: string;
}): EpisodeMomentRepairAuthority {
  if (input.runtimeState === "PRE_DISPATCH_BLOCKED") {
    return {
      kind: "PRE_DISPATCH_RECOVERY",
      sceneExecutionId: input.sceneExecutionId,
    };
  }
  if (input.runtimeState === "RETRY_AUTHORIZED" && input.retryAuthorizationId) {
    return {
      kind: "RETRY_AUTHORIZED",
      sceneExecutionId: input.sceneExecutionId,
      retryAuthorizationId: input.retryAuthorizationId,
    };
  }
  return {
    kind: BACKEND_GAP,
    reason: AI_STORY_EPISODE_COPY.regenerateRequiresRetryAuth,
  };
}

export function composeEpisodeOriginalIdea(input: {
  readonly originalIdea: string;
  readonly episodeType: AiStoryEpisodeUserType;
  readonly durationSec: number | "custom";
  readonly customDurationSec?: number;
  readonly aspectRatio: string;
  readonly language: string;
  readonly dialogueStyle: string;
  readonly nativeCharacterDialogue: boolean;
  readonly pacing: string;
  readonly cta?: string;
}): string {
  const duration =
    input.durationSec === "custom" ? input.customDurationSec ?? "custom" : input.durationSec;
  const extras = [
    `Episode type: ${input.episodeType}`,
    `Duration: ${duration}s`,
    `Aspect ratio: ${input.aspectRatio}`,
    `Language: ${input.language}`,
    `Dialogue style: ${input.dialogueStyle}`,
    `Pacing: ${input.pacing}`,
    input.nativeCharacterDialogue ? "Native character dialogue requested" : null,
    input.cta ? `CTA: ${input.cta}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(". ");
  return `${input.originalIdea.trim()}\n\n${extras}`.slice(0, 8000);
}

export function resolveEpisodeMomentFromTimeRange(input: {
  readonly startMs: number;
  readonly endMs: number;
  readonly moments: readonly AiStoryEpisodeTimelineMoment[];
}): AiStoryEpisodeTimelineMoment | null {
  const midpoint = (input.startMs + input.endMs) / 2;
  const overlapping = input.moments.filter(
    (moment) => midpoint >= moment.startMs && midpoint < moment.endMs
  );
  return overlapping[0] ?? null;
}

export function describeEpisodePartialFailure(input: {
  readonly readyCount: number;
  readonly totalCount: number;
}): string {
  if (input.readyCount <= 0) return AI_STORY_EPISODE_COPY.momentFailed;
  if (input.readyCount >= input.totalCount) return "";
  if (input.totalCount - input.readyCount === 1) {
    return AI_STORY_EPISODE_COPY.partialFailure;
  }
  return `${input.readyCount} of ${input.totalCount} moments are ready. Some moments need attention.`;
}

export function formatEpisodeCostEstimateUsd(input: {
  readonly lowUsd: string;
  readonly highUsd: string;
}): string {
  return `USD ${input.lowUsd}–${input.highUsd}`;
}

export function formatEpisodeActualCostUsd(amountUsd: string): string {
  return `USD ${amountUsd}`;
}

export function formatEpisodeLiveCostEstimateUsd(input: {
  readonly currency: string;
  readonly estimatedExpected: string;
  readonly estimatedMin?: string;
  readonly estimatedMax?: string;
}): string {
  if (
    input.estimatedMin &&
    input.estimatedMax &&
    input.estimatedMin !== input.estimatedMax
  ) {
    return `${input.currency} ${input.estimatedMin}–${input.estimatedMax}`;
  }
  return `${input.currency} ${input.estimatedExpected}`;
}

export function episodeCreateRequiresScene(): false {
  return false;
}

export const AI_STORY_EPISODE_SELF_USE_CONFIRM_THRESHOLD_USD = 2;

export function episodeGenerationRequiresConfirmation(
  highUsd: string,
  thresholdUsd = AI_STORY_EPISODE_SELF_USE_CONFIRM_THRESHOLD_USD
): boolean {
  return Number(highUsd) > thresholdUsd;
}

export function resolveInternalRetryScopeFromEpisodeMoment(
  moment: AiStoryEpisodeTimelineMoment
): {
  readonly timeRangeMs: { readonly startMs: number; readonly endMs: number };
  readonly editorialMarker: AiStoryEpisodeMomentMarker;
  readonly generationUnitId: string;
  readonly directorShotId: string;
  readonly sceneId: string;
  readonly sceneOrder: number;
} {
  return {
    timeRangeMs: { startMs: moment.startMs, endMs: moment.endMs },
    editorialMarker: moment.marker,
    generationUnitId: moment.generationUnitId,
    directorShotId: moment.directorShotId,
    sceneId: moment.sceneId,
    sceneOrder: moment.sceneOrder,
  };
}

export function shouldExposeSceneDiagnostics(input: {
  readonly superAdmin: boolean;
  readonly debugMode: boolean;
}): boolean {
  return input.superAdmin || input.debugMode;
}

export function normalUserSceneLabelHidden(label: string): boolean {
  return NORMAL_USER_HIDDEN_LABELS.some((hidden) => label.includes(hidden));
}

export const TAPAO_JOM_EPISODE_UX_FIXTURE = Object.freeze({
  title: "Tapao Jom by AWH Food Enterprise",
  episodeType: "FOOD_STORY" as const,
  durationSec: 45,
  finalDurationSec: 48,
  aspectRatio: "9:16" as const,
  locale: "zh-MY",
  dialogueStyle: "Malaysian Chinese conversational",
  nativeCharacterDialogue: true,
  estimatedCostUsd: formatEpisodeCostEstimateUsd({
    lowUsd: "3.20",
    highUsd: "3.80",
  }),
  actualCostUsd: formatEpisodeActualCostUsd("3.42"),
  workflow: [
    "Add store/product references",
    "Describe promotional idea",
    "Choose Malaysian Chinese",
    "Choose 45 sec",
    "Generate Episode",
    "Watch one complete result",
    "Regenerate a weak moment if needed",
    "Export",
  ] as const,
  moments: [
    {
      startMs: 0,
      endMs: 8000,
      marker: "Hook" as const,
      generationUnitId: "ae000000-0000-4000-8000-000000000090",
      directorShotId: "ae000000-0000-4000-8000-000000000080",
      sceneId: "ae000000-0000-4000-8000-000000000030",
      sceneOrder: 0,
      status: "ready" as const,
      timeRangeAuthority: "RECORDED" as const,
    },
    {
      startMs: 8000,
      endMs: 16000,
      marker: "Discovery" as const,
      generationUnitId: "ae000000-0000-4000-8000-000000000091",
      directorShotId: "ae000000-0000-4000-8000-000000000081",
      sceneId: "ae000000-0000-4000-8000-000000000031",
      sceneOrder: 1,
      status: "ready" as const,
      timeRangeAuthority: "RECORDED" as const,
    },
    {
      startMs: 16000,
      endMs: 26000,
      marker: "Product" as const,
      generationUnitId: "ae000000-0000-4000-8000-000000000092",
      directorShotId: "ae000000-0000-4000-8000-000000000082",
      sceneId: "ae000000-0000-4000-8000-000000000032",
      sceneOrder: 2,
      status: "ready" as const,
      timeRangeAuthority: "RECORDED" as const,
    },
    {
      startMs: 26000,
      endMs: 34000,
      marker: "Product" as const,
      generationUnitId: "ae000000-0000-4000-8000-000000000093",
      directorShotId: "ae000000-0000-4000-8000-000000000083",
      sceneId: "ae000000-0000-4000-8000-000000000033",
      sceneOrder: 3,
      status: "ready" as const,
      timeRangeAuthority: "RECORDED" as const,
    },
    {
      startMs: 34000,
      endMs: 42000,
      marker: "Reaction" as const,
      generationUnitId: "ae000000-0000-4000-8000-000000000094",
      directorShotId: "ae000000-0000-4000-8000-000000000084",
      sceneId: "ae000000-0000-4000-8000-000000000034",
      sceneOrder: 4,
      status: "ready" as const,
      timeRangeAuthority: "RECORDED" as const,
    },
    {
      startMs: 42000,
      endMs: 48000,
      marker: "CTA" as const,
      generationUnitId: "ae000000-0000-4000-8000-000000000095",
      directorShotId: "ae000000-0000-4000-8000-000000000085",
      sceneId: "ae000000-0000-4000-8000-000000000035",
      sceneOrder: 5,
      status: "ready" as const,
      timeRangeAuthority: "RECORDED" as const,
    },
  ] satisfies readonly AiStoryEpisodeTimelineMoment[],
  hiddenFromNormalUser: [
    "6 Generation Units",
    "internal Scene boundaries",
    "native AV request versions",
    "Assembly trim authority",
  ] as const,
});
