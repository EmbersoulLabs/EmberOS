import { z } from "zod";

export const AI_STORY_ASSET_PLANNER_CONTRACT_VERSION =
  "ai-story-asset-aware-execution-planner.v1" as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1);

export const AiStoryAssetFileKindSchema = z.enum([
  "IMAGE",
  "VIDEO",
  "AUDIO",
  "DOCUMENT",
  "OTHER",
]);

/** Provider-neutral projection over the existing Workspace-owned `assets` table. */
export const AiStoryAssetRegistryEntrySchema = z
  .object({
    assetId: Id,
    orgId: Id,
    workspaceId: Id,
    contentHash: Hash,
    mimeType: Text,
    fileKind: AiStoryAssetFileKindSchema,
    storageRef: Text,
    createdAt: z.string().datetime(),
  })
  .strict();

export const AiStoryAssetAnalysisResultSchema = z
  .object({
    fileKind: AiStoryAssetFileKindSchema,
    usable: z.boolean(),
    rejectionReasons: z.array(Text).default([]),
    affordances: z
      .object({
        visualReference: z.boolean().default(false),
        firstFrame: z.boolean().default(false),
        sourceMotion: z.boolean().default(false),
        sourceAudio: z.boolean().default(false),
        productGrounding: z.boolean().default(false),
        characterGrounding: z.boolean().default(false),
      })
      .strict(),
    facts: z.record(z.unknown()).default({}),
  })
  .strict();

export const AiStoryAssetAnalysisSnapshotSchema = z
  .object({
    snapshotId: Id,
    orgId: Id,
    workspaceId: Id,
    sourceAssetId: Id,
    analyzedContentHash: Hash,
    analyzerVersion: Text,
    schemaVersion: Text,
    analysis: AiStoryAssetAnalysisResultSchema,
    analysisFingerprint: Hash,
    createdAt: z.string().datetime(),
  })
  .strict();

export const AiStoryAssetAnalysisAttemptSchema = z
  .object({
    attemptId: Id,
    orgId: Id,
    workspaceId: Id,
    assetId: Id,
    contentHash: Hash,
    analyzerVersion: Text,
    schemaVersion: Text,
    status: z.enum(["SUCCEEDED", "FAILED"]),
    snapshotId: Id.nullable(),
    errorCode: Text.nullable(),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.status === "SUCCEEDED" && !value.snapshotId) ||
      (value.status === "FAILED" && !value.errorCode)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Successful analysis requires a Snapshot; failed analysis requires an error code",
      });
    }
  });

export const AiStoryAssetBindingRoleSchema = z.enum([
  "STORY_REFERENCE",
  "SCENE_REFERENCE",
  "FIRST_FRAME_CANDIDATE",
  "SOURCE_VIDEO_CANDIDATE",
  "PRODUCT_GROUNDING",
  "CHARACTER_GROUNDING",
  "SOURCE_AUDIO",
  "CHARACTER_AUTHORITY",
  "PRODUCT_AUTHORITY",
  "ENVIRONMENT_AUTHORITY",
  "BRAND_ASSET",
  "SOURCE_IMAGE_CANDIDATE",
  "CONTINUITY_REFERENCE",
  "SUPPORTING_REFERENCE",
  "UNUSED",
]);

export const AiStoryAssetBindingStatusSchema = z.enum([
  "ACTIVE",
  "REJECTED",
  "SUPERSEDED",
]);

export const AiStoryAssetBindingSchema = z
  .object({
    bindingId: Id,
    orgId: Id,
    workspaceId: Id,
    storyId: Id,
    storyVersionId: Id,
    assetId: Id,
    assetContentHash: Hash,
    analysisSnapshotId: Id,
    analysisContentHash: Hash,
    role: AiStoryAssetBindingRoleSchema,
    required: z.boolean(),
    reason: Text,
    trace: z.array(Text).min(1),
    status: AiStoryAssetBindingStatusSchema,
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.assetContentHash !== value.analysisContentHash) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["analysisSnapshotId"],
        message:
          "Story Asset binding must pin analysis for the exact Asset content hash",
      });
    }
  });

export const AiStoryExecutionAssetRequirementsSchema = z
  .object({
    needsSourceMotion: z.boolean().default(false),
    needsVisualIdentityGrounding: z.boolean().default(false),
    needsProductGrounding: z.boolean().default(false),
    allowsReferenceFree: z.boolean().default(true),
  })
  .strict();

export const AiStoryAudioIntentSchema = z.enum([
  "NONE",
  "NATIVE_DIALOGUE",
  "VOICE_OVER",
  "PRESERVE_SOURCE_AUDIO",
  "MIXED",
]);

export const AiStoryProviderCapabilityRequirementsSchema = z
  .object({
    textToVideo: z.boolean(),
    firstFrameImageToVideo: z.boolean(),
    videoToVideo: z.boolean(),
    nativeAudio: z.boolean(),
    nativeDialogue: z.boolean(),
    detachedVoiceOver: z.boolean(),
    preserveSourceAudio: z.boolean(),
  })
  .strict();

export const AiStoryNoAssetConfirmationSchema = z
  .object({
    storyId: Id,
    storyVersionId: Id,
    confirmedBy: Id,
    confirmedAt: z.string().datetime(),
    authorityVersion: Text,
  })
  .strict();

export const AiStoryAssetDecisionStatusSchema = z.enum([
  "NEEDS_RECOMMENDED_UPLOADS",
  "AWAITING_NO_ASSET_CONFIRMATION",
  "RESOLVED",
  "UNSUPPORTED",
]);

export const AiStoryResolvedGenerationModeSchema = z.enum([
  "TEXT_TO_VIDEO",
  "FIRST_FRAME_IMAGE_TO_VIDEO",
  "VIDEO_TO_VIDEO",
]);

export const AiStoryAssetAwareExecutionPlanSchema = z
  .object({
    contractVersion: z.literal(AI_STORY_ASSET_PLANNER_CONTRACT_VERSION),
    plannerSnapshotId: Id,
    orgId: Id,
    workspaceId: Id,
    storyId: Id,
    storyVersionId: Id,
    assetDecisionStatus: AiStoryAssetDecisionStatusSchema,
    requirements: AiStoryExecutionAssetRequirementsSchema,
    audioIntent: AiStoryAudioIntentSchema,
    providerCapabilityRequirements:
      AiStoryProviderCapabilityRequirementsSchema,
    resolvedGenerationMode: AiStoryResolvedGenerationModeSchema.nullable(),
    selectedBindingIds: z.array(Id),
    recommendedUploadRoles: z.array(AiStoryAssetBindingRoleSchema),
    reasons: z.array(Text).min(1),
    trace: z.array(
      z
        .object({
          step: Text,
          outcome: Text,
          bindingIds: z.array(Id).default([]),
        })
        .strict()
    ),
    noAssetConfirmation: AiStoryNoAssetConfirmationSchema.nullable(),
    plannerVersion: Text,
    createdAt: z.string().datetime(),
  })
  .strict();

export type AiStoryAssetAnalysisSnapshot = z.infer<
  typeof AiStoryAssetAnalysisSnapshotSchema
>;
export type AiStoryAssetAnalysisAttempt = z.infer<
  typeof AiStoryAssetAnalysisAttemptSchema
>;
export type AiStoryAssetRegistryEntry = z.infer<
  typeof AiStoryAssetRegistryEntrySchema
>;
export type AiStoryAssetBinding = z.infer<
  typeof AiStoryAssetBindingSchema
>;
export type AiStoryAudioIntent = z.infer<typeof AiStoryAudioIntentSchema>;
export type AiStoryAssetAwareExecutionPlan = z.infer<
  typeof AiStoryAssetAwareExecutionPlanSchema
>;

export function deriveAiStoryProviderCapabilityRequirements(input: {
  readonly generationMode:
    | z.infer<typeof AiStoryResolvedGenerationModeSchema>
    | null;
  readonly audioIntent: AiStoryAudioIntent;
}): z.infer<typeof AiStoryProviderCapabilityRequirementsSchema> {
  return {
    textToVideo: input.generationMode === "TEXT_TO_VIDEO",
    firstFrameImageToVideo:
      input.generationMode === "FIRST_FRAME_IMAGE_TO_VIDEO",
    videoToVideo: input.generationMode === "VIDEO_TO_VIDEO",
    nativeAudio:
      input.audioIntent === "NATIVE_DIALOGUE" ||
      input.audioIntent === "MIXED",
    nativeDialogue:
      input.audioIntent === "NATIVE_DIALOGUE" ||
      input.audioIntent === "MIXED",
    detachedVoiceOver:
      input.audioIntent === "VOICE_OVER" || input.audioIntent === "MIXED",
    preserveSourceAudio:
      input.audioIntent === "PRESERVE_SOURCE_AUDIO" ||
      input.audioIntent === "MIXED",
  };
}

export function resolveAiStoryAssetAwareExecutionPlan(input: {
  readonly plannerSnapshotId: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly storyId: string;
  readonly storyVersionId: string;
  readonly requirements: z.input<
    typeof AiStoryExecutionAssetRequirementsSchema
  >;
  readonly audioIntent: AiStoryAudioIntent;
  readonly bindings: readonly {
    readonly binding: AiStoryAssetBinding;
    readonly snapshot: AiStoryAssetAnalysisSnapshot;
  }[];
  readonly noAssetConfirmation?: z.infer<
    typeof AiStoryNoAssetConfirmationSchema
  > | null;
  readonly plannerVersion: string;
  readonly createdAt: string;
}): AiStoryAssetAwareExecutionPlan {
  const requirements = AiStoryExecutionAssetRequirementsSchema.parse(
    input.requirements
  );
  const active = input.bindings.filter(({ binding, snapshot }) => {
    AiStoryAssetBindingSchema.parse(binding);
    AiStoryAssetAnalysisSnapshotSchema.parse(snapshot);
    return (
      binding.status === "ACTIVE" &&
      binding.analysisSnapshotId === snapshot.snapshotId &&
      binding.analysisContentHash === snapshot.analyzedContentHash &&
      binding.assetContentHash === snapshot.analyzedContentHash &&
      binding.workspaceId === input.workspaceId &&
      snapshot.workspaceId === input.workspaceId &&
      snapshot.analysis.usable
    );
  });
  const sourceVideo = active.find(
    ({ binding, snapshot }) =>
      binding.role === "SOURCE_VIDEO_CANDIDATE" &&
      snapshot.analysis.affordances.sourceMotion
  );
  const firstFrame = active.find(
    ({ binding, snapshot }) =>
      (binding.role === "FIRST_FRAME_CANDIDATE" ||
        binding.role === "PRODUCT_GROUNDING" ||
        binding.role === "CHARACTER_GROUNDING") &&
      snapshot.analysis.affordances.firstFrame
  );
  const hardGroundingRequired =
    requirements.needsVisualIdentityGrounding ||
    requirements.needsProductGrounding;

  let status: z.infer<typeof AiStoryAssetDecisionStatusSchema>;
  let mode: z.infer<typeof AiStoryResolvedGenerationModeSchema> | null = null;
  let selectedBindingIds: string[] = [];
  let recommendedUploadRoles: z.infer<
    typeof AiStoryAssetBindingRoleSchema
  >[] = [];
  let reasons: string[];

  if (requirements.needsSourceMotion && sourceVideo) {
    status = "RESOLVED";
    mode = "VIDEO_TO_VIDEO";
    selectedBindingIds = [sourceVideo.binding.bindingId];
    reasons = ["Source-motion requirement matched reusable video analysis"];
  } else if (hardGroundingRequired && firstFrame) {
    status = "RESOLVED";
    mode = "FIRST_FRAME_IMAGE_TO_VIDEO";
    selectedBindingIds = [firstFrame.binding.bindingId];
    reasons = ["Visual-grounding requirement matched reusable image analysis"];
  } else if (requirements.needsSourceMotion || hardGroundingRequired) {
    status = "NEEDS_RECOMMENDED_UPLOADS";
    recommendedUploadRoles = requirements.needsSourceMotion
      ? ["SOURCE_VIDEO_CANDIDATE"]
      : requirements.needsProductGrounding
        ? ["PRODUCT_GROUNDING"]
        : ["CHARACTER_GROUNDING"];
    reasons = ["Required reusable Asset intelligence is unavailable"];
  } else if (!requirements.allowsReferenceFree) {
    status = "NEEDS_RECOMMENDED_UPLOADS";
    recommendedUploadRoles = ["STORY_REFERENCE"];
    reasons = ["Story requirements disallow reference-free generation"];
  } else if (
    !input.noAssetConfirmation ||
    input.noAssetConfirmation.storyId !== input.storyId ||
    input.noAssetConfirmation.storyVersionId !== input.storyVersionId
  ) {
    status = "AWAITING_NO_ASSET_CONFIRMATION";
    reasons = [
      "Reference-free generation requires explicit no-Asset confirmation",
    ];
  } else {
    status = "RESOLVED";
    mode = "TEXT_TO_VIDEO";
    reasons = [
      "No-Asset authority explicitly confirmed reference-free execution",
    ];
  }

  return AiStoryAssetAwareExecutionPlanSchema.parse({
    contractVersion: AI_STORY_ASSET_PLANNER_CONTRACT_VERSION,
    plannerSnapshotId: input.plannerSnapshotId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    assetDecisionStatus: status,
    requirements,
    audioIntent: input.audioIntent,
    providerCapabilityRequirements:
      deriveAiStoryProviderCapabilityRequirements({
        generationMode: mode,
        audioIntent: input.audioIntent,
      }),
    resolvedGenerationMode: mode,
    selectedBindingIds,
    recommendedUploadRoles,
    reasons,
    trace: [
      {
        step: "REUSE_ANALYSIS_SNAPSHOTS",
        outcome: `${active.length} usable active binding(s)`,
        bindingIds: active.map(({ binding }) => binding.bindingId),
      },
      {
        step: "RESOLVE_GENERATION_MODE",
        outcome: mode ?? status,
        bindingIds: selectedBindingIds,
      },
      {
        step: "DERIVE_AUDIO_CAPABILITIES",
        outcome: input.audioIntent,
        bindingIds: [],
      },
    ],
    noAssetConfirmation: input.noAssetConfirmation ?? null,
    plannerVersion: input.plannerVersion,
    createdAt: input.createdAt,
  });
}
