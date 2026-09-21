import { z } from "zod";

export const AI_STORY_EPISODE_REVISION_AUTHORITY_CONTRACT_VERSION =
  "ai-story-episode-revision-authority.v1" as const;

export const AI_STORY_EPISODE_REVISION_AUTHORITY = "CONTRACT_AND_PLANNING_CERTIFIED" as const;
export const EDIT_DIALOGUE = "DURABLE_RUNTIME_CERTIFIED" as const;
export const DIALOGUE_SMALLEST_SCOPE_INVALIDATION = "CERTIFIED" as const;
export const ADJUST_ENDING = "DURABLE_RUNTIME_CERTIFIED" as const;
export const ADJUST_PACING = "DURABLE_RUNTIME_CERTIFIED" as const;
export const REPLACE_REFERENCE = "DURABLE_RUNTIME_CERTIFIED" as const;
export const LIVE_COST_ESTIMATE = "CERTIFIED" as const;
export const REVISION_COST_ESTIMATE = "CERTIFIED" as const;
export const COST_ESTIMATE_IS_NOT_AUTHORIZATION = "CERTIFIED" as const;
export const REGENERATE_APPROVED_MOMENT =
  "CERTIFIED_WITH_EXISTING_COMMERCIAL_RETRY_AUTHORITY" as const;
export const PARTIAL_FAILURE_RETRY =
  "CERTIFIED_WITH_EXISTING_RETRY_AUTHORITY" as const;
export const SIBLING_GENERATION_UNIT_PRESERVATION = "CERTIFIED" as const;
export const SCENE_INTERNAL_AUTHORITY_PRESERVED_FOR_REVISION = true as const;
export const EPISODE_FIRST_UI_REVISION = "PRESENTATION_AND_DURABLE_REVISION_CERTIFIED" as const;
export const AI_STORY_EPISODE_REVISION_PERSISTENCE = "CERTIFIED" as const;
export const AI_STORY_DURABLE_EPISODE_REVISION_PERSISTENCE = "CERTIFIED" as const;
export const DIALOGUE_DURABLE_SCRIPT_MUTATION = "CERTIFIED" as const;
export const ENDING_DURABLE_STORY_REVISION = "CERTIFIED" as const;
export const REFERENCE_DURABLE_BINDING_REVISION = "CERTIFIED" as const;
export const PACING_DURABLE_EDITORIAL_REVISION = "CERTIFIED" as const;
export const REVISION_CURRENT_VERSION_ADVANCE = "CERTIFIED" as const;
export const DEPENDENT_AUTHORITY_REBIND = "CERTIFIED" as const;
export const REVISION_HISTORY = "CERTIFIED" as const;
export const HISTORICAL_AUTHORITY_IMMUTABILITY = "CERTIFIED" as const;
export const REVISION_OPTIMISTIC_CONCURRENCY = "CERTIFIED" as const;
export const REVISION_IDEMPOTENCY = "CERTIFIED" as const;
export const REVISION_TRANSACTION_ATOMICITY = "CERTIFIED" as const;
export const REVISION_TENANT_ISOLATION = "CERTIFIED" as const;
export const CANONICAL_CURRENT_VERSION_ADVANCE = "CERTIFIED" as const;
export const REVISION_SOURCE_VERSION_CONFLICT = "REVISION_SOURCE_VERSION_CONFLICT" as const;
export const AI_STORY_EPISODE_REVISION_PROVIDER_CALLS_DURING_TESTS = 0 as const;
export const ENDING_REVISION_SCOPE_GATE = "ENDING_REVISION_SCOPE_GATE" as const;
export const REFERENCE_REVISION_IMPACT_GATE = "REFERENCE_REVISION_IMPACT_GATE" as const;
export const REGENERATE_APPROVED_MOMENT_DENIED =
  "REGENERATE_APPROVED_MOMENT_DENIED" as const;

export const AI_STORY_EPISODE_REVISION_TYPES = [
  "EDIT_DIALOGUE",
  "ADJUST_ENDING",
  "ADJUST_PACING",
  "REPLACE_REFERENCE",
  "REGENERATE_MOMENT",
] as const;
export type AiStoryEpisodeRevisionType =
  (typeof AI_STORY_EPISODE_REVISION_TYPES)[number];

export const AI_STORY_EPISODE_REVISION_INTERNAL_STATUSES = [
  "REQUESTED",
  "ANALYZING",
  "COST_CONFIRMATION_REQUIRED",
  "READY_TO_REGENERATE",
  "REGENERATING",
  "RE_EDITING",
  "READY_FOR_REVIEW",
  "FAILED",
] as const;
export type AiStoryEpisodeRevisionInternalStatus =
  (typeof AI_STORY_EPISODE_REVISION_INTERNAL_STATUSES)[number];

export const AI_STORY_EPISODE_REVISION_USER_STATUSES = [
  "Revision requested",
  "Analyzing changes",
  "Cost confirmation required",
  "Ready to regenerate",
  "Regenerating moment",
  "Re-editing Episode",
  "Ready for review",
  "Revision failed",
] as const;
export type AiStoryEpisodeRevisionUserStatus =
  (typeof AI_STORY_EPISODE_REVISION_USER_STATUSES)[number];

export const AI_STORY_EPISODE_REVISION_USER_STATUS_BY_INTERNAL = {
  REQUESTED: "Revision requested",
  ANALYZING: "Analyzing changes",
  COST_CONFIRMATION_REQUIRED: "Cost confirmation required",
  READY_TO_REGENERATE: "Ready to regenerate",
  REGENERATING: "Regenerating moment",
  RE_EDITING: "Re-editing Episode",
  READY_FOR_REVIEW: "Ready for review",
  FAILED: "Revision failed",
} as const satisfies Record<
  AiStoryEpisodeRevisionInternalStatus,
  AiStoryEpisodeRevisionUserStatus
>;

export const AI_STORY_EPISODE_REVISION_HISTORY_SUMMARIES = [
  "Dialogue updated",
  "Ending changed",
  "Pacing changed",
  "Product reference replaced",
  "Store reference replaced",
  "Character reference replaced",
  "Brand reference replaced",
  "Visual reference replaced",
  "Moment regeneration requested",
] as const;

export const AI_STORY_EPISODE_COMMERCIAL_AUTHORIZATION_STATUSES = [
  "NOT_REQUIRED",
  "REQUIRED",
  "AUTHORIZED",
  "DENIED",
] as const;
export type AiStoryEpisodeCommercialAuthorizationStatus =
  (typeof AI_STORY_EPISODE_COMMERCIAL_AUTHORIZATION_STATUSES)[number];

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Money = z.string().regex(/^\d+\.\d{2}$/);
const Instant = z.string().datetime();
const Text = z.string().trim().min(1).max(4000);

export const AiStoryEpisodeRevisionTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("DIALOGUE_ENTRY"),
      entryId: Id,
    })
    .strict(),
  z
    .object({
      kind: z.literal("MOMENT"),
      momentId: Id.optional(),
      generationUnitId: Id.optional(),
      editorialTimelineEntryId: Id.optional(),
      directorShotId: Id.optional(),
      sceneId: Id.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("ENDING") }).strict(),
  z.object({ kind: z.literal("EPISODE_PACING") }).strict(),
  z
    .object({
      kind: z.literal("REFERENCE_BINDING"),
      referenceKind: z.enum([
        "PRODUCT",
        "LOCATION",
        "CHARACTER",
        "BRAND",
        "VISUAL",
      ]),
      authorityId: Id,
    })
    .strict(),
]);
export type AiStoryEpisodeRevisionTarget = z.infer<
  typeof AiStoryEpisodeRevisionTargetSchema
>;

export const AiStoryEpisodeRevisionRequestedChangeSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("DIALOGUE_TEXT"),
        entryId: Id,
        previousText: Text,
        nextText: Text,
      })
      .strict(),
    z
      .object({
        kind: z.literal("ENDING_INTENT"),
        previousIntent: Text,
        nextIntent: z.enum([
          "stronger CTA",
          "softer ending",
          "brand-focused ending",
          "product-focused ending",
          "no CTA",
        ]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("EPISODE_PACING"),
        previousPacing: z.enum(["RELAXED", "NATURAL", "FAST"]),
        nextPacing: z.enum(["RELAXED", "NATURAL", "FAST"]),
        reactionSpeed: z.enum(["SLOW", "NATURAL", "FAST"]).optional(),
        cutRhythm: z.enum(["RELAXED", "NATURAL", "FAST"]).optional(),
        heroHold: z.enum(["SHORT", "NATURAL", "LONG"]).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("REFERENCE_BINDING"),
        referenceKind: z.enum([
          "PRODUCT",
          "LOCATION",
          "CHARACTER",
          "BRAND",
          "VISUAL",
        ]),
        previousAuthorityId: Id,
        nextAuthorityId: Id,
        previousSourceAssetId: Id.nullable().optional(),
        nextSourceAssetId: Id.nullable().optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("REGENERATE_MOMENT"),
        generationUnitId: Id,
      })
      .strict(),
  ]
);
export type AiStoryEpisodeRevisionRequestedChange = z.infer<
  typeof AiStoryEpisodeRevisionRequestedChangeSchema
>;

export const AiStoryEpisodeRevisionRequestSchema = z
  .object({
    revisionRequestId: Id,
    contractVersion: z.literal(
      AI_STORY_EPISODE_REVISION_AUTHORITY_CONTRACT_VERSION
    ),
    storyId: Id,
    storyVersionId: Id,
    episodeId: Id,
    revisionType: z.enum(AI_STORY_EPISODE_REVISION_TYPES),
    target: AiStoryEpisodeRevisionTargetSchema,
    requestedChange: AiStoryEpisodeRevisionRequestedChangeSchema,
    sourceVersionFingerprint: Hash,
    createdBy: Id,
    createdAt: Instant,
    status: z.enum(AI_STORY_EPISODE_REVISION_INTERNAL_STATUSES),
    revisionFingerprint: Hash,
    supersedesRevisionRequestId: Id.nullable(),
    sourceVersion: z.number().int().positive(),
    revisionVersion: z.number().int().positive(),
  })
  .strict();
export type AiStoryEpisodeRevisionRequest = z.infer<
  typeof AiStoryEpisodeRevisionRequestSchema
>;

export const AiStoryRevisionImpactSchema = z
  .object({
    revisionRequestId: Id,
    impactedScriptEntryIds: z.array(Id),
    impactedSceneIds: z.array(Id),
    impactedDirectorShotIds: z.array(Id),
    impactedGenerationUnitIds: z.array(Id),
    preservedGenerationUnitIds: z.array(Id),
    impactedEditorialEntryIds: z.array(Id),
    impactedNativeDialogueAuthorityIds: z.array(Id),
    requiresProviderExecution: z.boolean(),
    requiresEditorialRecompile: z.boolean(),
    requiresAssemblyRebuild: z.boolean(),
    providerRegenerationReason: z.string().nullable(),
    endingScopeGate: z.enum(["PASS", "BLOCK"]).optional(),
    referenceImpactGate: z.enum(["PASS", "BLOCK"]).optional(),
    fingerprint: Hash,
  })
  .strict();
export type AiStoryRevisionImpact = z.infer<typeof AiStoryRevisionImpactSchema>;

export const AiStoryEpisodeCostUnitBreakdownSchema = z
  .object({
    generationUnitId: Id,
    durationSeconds: z.number().positive(),
    nativeAudio: z.boolean(),
    estimatedUsd: Money,
  })
  .strict();

export const AiStoryEpisodeCostEstimateSchema = z
  .object({
    costEstimateId: Id,
    contractVersion: z.literal(
      AI_STORY_EPISODE_REVISION_AUTHORITY_CONTRACT_VERSION
    ),
    currency: z.literal("USD"),
    estimatedMin: Money,
    estimatedExpected: Money,
    estimatedMax: Money,
    unitBreakdown: z.array(AiStoryEpisodeCostUnitBreakdownSchema),
    pricingVersion: z.string().min(1),
    pricingSource: z.string().url(),
    modelId: z.string().min(1),
    resolution: z.enum(["480p", "720p", "1080p"]),
    nativeAudioMode: z.boolean(),
    generatedAt: Instant,
    authorizesSpend: z.literal(false),
    fingerprint: Hash,
  })
  .strict();
export type AiStoryEpisodeCostEstimate = z.infer<
  typeof AiStoryEpisodeCostEstimateSchema
>;

export const AiStoryEpisodeRevisionExecutionPlanSchema = z
  .object({
    revisionRequestId: Id,
    impactedScriptEntries: z.array(Id),
    impactedScenes: z.array(Id),
    impactedShots: z.array(Id),
    impactedGenerationUnits: z.array(Id),
    impactedEditorialEntries: z.array(Id),
    requiresProviderExecution: z.boolean(),
    requiresEditorialRecompile: z.boolean(),
    requiresAssemblyRebuild: z.boolean(),
    preservedGenerationUnits: z.array(Id),
    estimatedCost: AiStoryEpisodeCostEstimateSchema.nullable(),
    commercialAuthorizationStatus: z.enum(
      AI_STORY_EPISODE_COMMERCIAL_AUTHORIZATION_STATUSES
    ),
    retryAuthorizationIds: z.array(Id),
    fingerprint: Hash,
  })
  .strict();
export type AiStoryEpisodeRevisionExecutionPlan = z.infer<
  typeof AiStoryEpisodeRevisionExecutionPlanSchema
>;

export const AiStoryEpisodeRevisionHistoryEntrySchema = z
  .object({
    version: z.number().int().positive(),
    summary: z.string().min(1),
    createdAt: Instant,
    userStatus: z.enum(AI_STORY_EPISODE_REVISION_USER_STATUSES),
  })
  .strict();
export type AiStoryEpisodeRevisionHistoryEntry = z.infer<
  typeof AiStoryEpisodeRevisionHistoryEntrySchema
>;

export const AiStoryEpisodeRevisionCapabilitySchema = z
  .object({
    contractVersion: z.literal(
      AI_STORY_EPISODE_REVISION_AUTHORITY_CONTRACT_VERSION
    ),
    availableRevisionTypes: z.array(z.enum(AI_STORY_EPISODE_REVISION_TYPES)),
    costEstimateAvailable: z.literal(true),
    persistDurableScript: z.literal(true),
    providerExecutionDuringPlan: z.literal(false),
  })
  .strict();
export type AiStoryEpisodeRevisionCapability = z.infer<
  typeof AiStoryEpisodeRevisionCapabilitySchema
>;

export function mapRevisionInternalStatusToUserStatus(
  status: AiStoryEpisodeRevisionInternalStatus
): AiStoryEpisodeRevisionUserStatus {
  return AI_STORY_EPISODE_REVISION_USER_STATUS_BY_INTERNAL[status];
}

export function aiStoryEpisodeRevisionCapability(): AiStoryEpisodeRevisionCapability {
  return {
    contractVersion: AI_STORY_EPISODE_REVISION_AUTHORITY_CONTRACT_VERSION,
    availableRevisionTypes: [...AI_STORY_EPISODE_REVISION_TYPES],
    costEstimateAvailable: true,
    persistDurableScript: true,
    providerExecutionDuringPlan: false,
  };
}

export function revisionActionEnabled(
  type: AiStoryEpisodeRevisionType,
  capability: AiStoryEpisodeRevisionCapability = aiStoryEpisodeRevisionCapability()
): boolean {
  return (
    capability.persistDurableScript &&
    capability.availableRevisionTypes.includes(type)
  );
}

export const AI_STORY_EPISODE_ACTION_CERTIFICATION_AFTER_REVISION = Object.freeze(
  {
    createEpisode: "CERTIFIED",
    generateEpisodePlanning: "CERTIFIED",
    timeRangeToInternalUnitMapping: "CERTIFIED",
    regenerateMomentExecution: REGENERATE_APPROVED_MOMENT,
    editDialogue: EDIT_DIALOGUE,
    adjustEnding: ADJUST_ENDING,
    adjustPacing: ADJUST_PACING,
    replaceReference: REPLACE_REFERENCE,
    costEstimate: LIVE_COST_ESTIMATE,
    actualCost: "CERTIFIED",
    partialFailureCopy: "CERTIFIED",
    partialFailureRetry: PARTIAL_FAILURE_RETRY,
    costEstimateIsAuthorization: false,
    hardcodedCostEstimate: false,
  } as const
);
