import { z } from "zod";
import {
  AiStoryAssetBindingRoleSchema,
  AiStoryNoAssetConfirmationSchema,
} from "./ai-story-asset-aware-execution-planner";
import {
  AiStoryAssetMatchingResultSchema,
  AiStoryCharacterDnaMatchingAuthoritySchema,
  AiStoryMatchingAudioIntentSchema,
  type AiStoryAssetMatchingResult,
} from "./ai-story-asset-matching";

export const AI_STORY_MODE_RESOLUTION_CONTRACT_VERSION =
  "ai-story-mode-resolution.v1" as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1);

export const AiStoryVisualCapabilityRequirementSchema = z.enum([
  "NEED_TEXT_GENERATION",
  "NEED_SOURCE_IMAGE",
  "NEED_SOURCE_VIDEO",
  "NEED_CHARACTER_IDENTITY",
  "NEED_PRODUCT_FIDELITY",
  "NEED_ENVIRONMENT_FIDELITY",
  "NEED_VISUAL_CONTINUITY",
  "NEED_MOTION_CONTINUATION",
]);

export const AiStoryAudioCapabilityRequirementSchema = z.enum([
  "NEED_NATIVE_DIALOGUE",
  "NEED_NARRATION",
  "NEED_POST_TTS",
  "NEED_SOURCE_AUDIO_PRESERVE",
  "NEED_SOURCE_AUDIO_REPLACE",
  "NEED_SILENT_OUTPUT",
]);

export const AiStoryAuthorityCapabilityRequirementSchema = z.enum([
  "NEED_CHARACTER_DNA",
  "NEED_PRODUCT_AUTHORITY",
  "NEED_EXACT_SOURCE_FRAME",
  "NEED_SOURCE_VIDEO_AUTHORITY",
]);

export const AiStoryCapabilityRequirementsSchema = z
  .object({
    visual: z.array(AiStoryVisualCapabilityRequirementSchema),
    audio: z.array(AiStoryAudioCapabilityRequirementSchema),
    authority: z.array(AiStoryAuthorityCapabilityRequirementSchema),
  })
  .strict();

export const AiStoryContinuityRequirementsSchema = z
  .object({
    exactSourceFrameRequired: z.boolean().default(false),
    motionContinuationRequired: z.boolean().default(false),
    sourceVideoAuthorityRequired: z.boolean().default(false),
  })
  .strict();

export const AiStorySourceAuthoritySelectionSchema = z
  .object({
    imageBindingId: Id.nullable().default(null),
    videoBindingId: Id.nullable().default(null),
  })
  .strict();

export const AiStoryAssetIntelligenceStatusSchema = z.enum([
  "ANALYZED",
  "NO_ASSETS",
  "ANALYSIS_FAILED",
]);

export const AiStoryResolvedExecutionModeSchema = z.enum([
  "TEXT_TO_VIDEO",
  "IMAGE_TO_VIDEO",
  "VIDEO_TO_VIDEO",
]);

export const AiStoryModeResolutionStatusSchema = z.enum([
  "RESOLVED",
  "NO_VALID_MODE",
]);

const BindingAuthoritySchema = z
  .object({
    bindingId: Id,
    assetId: Id,
    analysisSnapshotId: Id,
    contentHash: Hash,
    role: AiStoryAssetBindingRoleSchema,
    required: z.boolean(),
  })
  .strict();

export const AiStoryModeResolutionSnapshotSchema = z
  .object({
    contractVersion: z.literal(AI_STORY_MODE_RESOLUTION_CONTRACT_VERSION),
    plannerSnapshotId: Id,
    orgId: Id,
    workspaceId: Id,
    storyId: Id,
    storyVersionId: Id,
    matchingResultId: Id,
    matchingContractVersion: Text,
    bindingAuthorities: z.array(BindingAuthoritySchema),
    characterDnaAuthority:
      AiStoryCharacterDnaMatchingAuthoritySchema.nullable(),
    noAssetConfirmation: AiStoryNoAssetConfirmationSchema.nullable(),
    assetIntelligenceStatus: AiStoryAssetIntelligenceStatusSchema,
    continuityRequirements: AiStoryContinuityRequirementsSchema,
    audioIntent: AiStoryMatchingAudioIntentSchema,
    capabilityRequirements: AiStoryCapabilityRequirementsSchema,
    resolutionStatus: AiStoryModeResolutionStatusSchema,
    resolvedGenerationMode: AiStoryResolvedExecutionModeSchema.nullable(),
    selectedBindingIds: z.array(Id),
    blockingReasons: z.array(Text),
    missingAuthorities: z.array(Text),
    recommendedNextActions: z.array(Text),
    resolutionTrace: z.array(
      z
        .object({
          step: Text,
          outcome: Text,
          bindingIds: z.array(Id),
        })
        .strict()
    ),
    resolverVersion: Text,
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    const resolved = value.resolutionStatus === "RESOLVED";
    if (resolved !== (value.resolvedGenerationMode !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolvedGenerationMode"],
        message: "Resolved status and generation mode must agree",
      });
    }
    if (resolved && value.blockingReasons.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockingReasons"],
        message: "A resolved mode cannot retain blocking reasons",
      });
    }
  });

export type AiStoryModeResolutionSnapshot = z.infer<
  typeof AiStoryModeResolutionSnapshotSchema
>;

export class AiStoryModeResolutionError extends Error {
  constructor(
    readonly code:
      | "MODE_RESOLUTION_SCOPE_MISMATCH"
      | "MODE_RESOLUTION_AUTHORITY_INVALID",
    message: string
  ) {
    super(message);
    this.name = "AiStoryModeResolutionError";
  }
}

function audioCapability(
  audioIntent: z.infer<typeof AiStoryMatchingAudioIntentSchema>
): z.infer<typeof AiStoryAudioCapabilityRequirementSchema> {
  switch (audioIntent) {
    case "NATIVE_DIALOGUE":
      return "NEED_NATIVE_DIALOGUE";
    case "NARRATION":
      return "NEED_NARRATION";
    case "POST_TTS":
      return "NEED_POST_TTS";
    case "SOURCE_AUDIO_PRESERVE":
      return "NEED_SOURCE_AUDIO_PRESERVE";
    case "SOURCE_AUDIO_REPLACE":
      return "NEED_SOURCE_AUDIO_REPLACE";
    case "SILENT":
      return "NEED_SILENT_OUTPUT";
  }
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function selectRequiredAuthority(input: {
  readonly bindings: AiStoryAssetMatchingResult["bindings"];
  readonly role: "SOURCE_IMAGE_CANDIDATE" | "SOURCE_VIDEO_CANDIDATE";
  readonly selectedBindingId: string | null;
}) {
  const candidates = input.bindings.filter(
    (binding) => binding.status === "ACTIVE" && binding.role === input.role
  );
  if (input.selectedBindingId) {
    const selected = candidates.find(
      (binding) => binding.bindingId === input.selectedBindingId
    );
    if (!selected) {
      throw new AiStoryModeResolutionError(
        "MODE_RESOLUTION_AUTHORITY_INVALID",
        `Selected ${input.role} binding is not active Story authority`
      );
    }
    return { selected, ambiguous: false, candidateCount: candidates.length };
  }
  return {
    selected: candidates.length === 1 ? candidates[0] : undefined,
    ambiguous: candidates.length > 1,
    candidateCount: candidates.length,
  };
}

/**
 * Pure deterministic authority resolver. It has no raw-media, analyzer,
 * semantic-model, Provider, Worker, or dispatch dependency.
 */
export function resolveAiStoryGenerationMode(input: {
  readonly plannerSnapshotId: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly storyId: string;
  readonly storyVersionId: string;
  readonly matchingResult: AiStoryAssetMatchingResult;
  readonly assetIntelligenceStatus: z.infer<
    typeof AiStoryAssetIntelligenceStatusSchema
  >;
  readonly continuityRequirements?: z.input<
    typeof AiStoryContinuityRequirementsSchema
  >;
  readonly sourceAuthoritySelection?: z.input<
    typeof AiStorySourceAuthoritySelectionSchema
  >;
  readonly resolverVersion: string;
  readonly createdAt: string;
}): AiStoryModeResolutionSnapshot {
  const matching = AiStoryAssetMatchingResultSchema.parse(
    input.matchingResult
  );
  const continuity = AiStoryContinuityRequirementsSchema.parse(
    input.continuityRequirements ?? {}
  );
  const selection = AiStorySourceAuthoritySelectionSchema.parse(
    input.sourceAuthoritySelection ?? {}
  );
  const assetIntelligenceStatus = AiStoryAssetIntelligenceStatusSchema.parse(
    input.assetIntelligenceStatus
  );

  if (
    matching.orgId !== input.orgId ||
    matching.workspaceId !== input.workspaceId ||
    matching.storyId !== input.storyId ||
    matching.storyVersionId !== input.storyVersionId ||
    matching.bindings.some(
      (binding) =>
        binding.orgId !== input.orgId ||
        binding.workspaceId !== input.workspaceId ||
        binding.storyId !== input.storyId ||
        binding.storyVersionId !== input.storyVersionId
    )
  ) {
    throw new AiStoryModeResolutionError(
      "MODE_RESOLUTION_SCOPE_MISMATCH",
      "Mode resolution authority must share one Story Version and Workspace"
    );
  }

  const activeBindings = matching.bindings.filter(
    (binding) => binding.status === "ACTIVE"
  );
  const relevantBindings = activeBindings.filter(
    (binding) =>
      binding.role !== "UNUSED" && binding.role !== "SUPPORTING_REFERENCE"
  );
  const imageRequired =
    continuity.exactSourceFrameRequired ||
    activeBindings.some(
      (binding) =>
        binding.required && binding.role === "SOURCE_IMAGE_CANDIDATE"
    );
  const videoRequired =
    matching.requirements.sourceMotionRequired ||
    continuity.motionContinuationRequired ||
    continuity.sourceVideoAuthorityRequired ||
    activeBindings.some(
      (binding) =>
        binding.required && binding.role === "SOURCE_VIDEO_CANDIDATE"
    );

  const imageAuthority = selectRequiredAuthority({
    bindings: activeBindings,
    role: "SOURCE_IMAGE_CANDIDATE",
    selectedBindingId: selection.imageBindingId,
  });
  const videoAuthority = selectRequiredAuthority({
    bindings: activeBindings,
    role: "SOURCE_VIDEO_CANDIDATE",
    selectedBindingId: selection.videoBindingId,
  });

  const visualCapabilities: z.infer<
    typeof AiStoryVisualCapabilityRequirementSchema
  >[] = [
    ...(imageRequired ? (["NEED_SOURCE_IMAGE"] as const) : []),
    ...(videoRequired ? (["NEED_SOURCE_VIDEO"] as const) : []),
    ...(!imageRequired && !videoRequired
      ? (["NEED_TEXT_GENERATION"] as const)
      : []),
    ...(matching.requirements.characterIdentityRequired
      ? (["NEED_CHARACTER_IDENTITY"] as const)
      : []),
    ...(matching.requirements.productIdentityRequired
      ? (["NEED_PRODUCT_FIDELITY"] as const)
      : []),
    ...(matching.requirements.environmentFidelityRequired
      ? (["NEED_ENVIRONMENT_FIDELITY"] as const)
      : []),
    ...(matching.requirements.visualContinuityRequired
      ? (["NEED_VISUAL_CONTINUITY"] as const)
      : []),
    ...(matching.requirements.sourceMotionRequired ||
    continuity.motionContinuationRequired
      ? (["NEED_MOTION_CONTINUATION"] as const)
      : []),
  ];
  const authorityCapabilities: z.infer<
    typeof AiStoryAuthorityCapabilityRequirementSchema
  >[] = [
    ...(matching.characterDnaAuthority
      ? (["NEED_CHARACTER_DNA"] as const)
      : []),
    ...(matching.requirements.productIdentityRequired
      ? (["NEED_PRODUCT_AUTHORITY"] as const)
      : []),
    ...(imageRequired ? (["NEED_EXACT_SOURCE_FRAME"] as const) : []),
    ...(videoRequired
      ? (["NEED_SOURCE_VIDEO_AUTHORITY"] as const)
      : []),
  ];

  const blockingReasons: string[] = [];
  const missingAuthorities: string[] = [...matching.missingRequirements];
  const recommendedNextActions: string[] = [];
  let mode: z.infer<typeof AiStoryResolvedExecutionModeSchema> | null = null;
  let selectedBindingIds: string[] = [];

  if (assetIntelligenceStatus === "ANALYSIS_FAILED") {
    blockingReasons.push(
      "Asset analysis failed; failure cannot authorize reference-free execution"
    );
    recommendedNextActions.push(
      "Retry Asset analysis under the same content identity"
    );
  }
  if (matching.missingRequirements.length > 0) {
    blockingReasons.push(
      `Required Story authorities are unresolved: ${matching.missingRequirements.join(
        ", "
      )}`
    );
    recommendedNextActions.push("Provide the recommended missing Assets");
  }
  if (imageRequired && videoRequired) {
    blockingReasons.push(
      "Required source-image and source-video execution authorities conflict"
    );
    recommendedNextActions.push(
      "Choose one required source execution authority"
    );
  } else if (imageRequired) {
    if (imageAuthority.ambiguous) {
      blockingReasons.push(
        "Multiple source-image authorities are eligible without an explicit selection"
      );
      recommendedNextActions.push("Select the authoritative source image");
    } else if (!imageAuthority.selected) {
      blockingReasons.push("Exact source-frame authority is required but missing");
      missingAuthorities.push("EXACT_SOURCE_FRAME");
      recommendedNextActions.push("Bind an authoritative source image");
    } else if (blockingReasons.length === 0) {
      mode = "IMAGE_TO_VIDEO";
      selectedBindingIds = [imageAuthority.selected.bindingId];
    }
  } else if (videoRequired) {
    if (videoAuthority.ambiguous) {
      blockingReasons.push(
        "Multiple source-video authorities are eligible without an explicit selection"
      );
      recommendedNextActions.push("Select the authoritative source video");
    } else if (!videoAuthority.selected) {
      blockingReasons.push("Source-video authority is required but missing");
      missingAuthorities.push("SOURCE_VIDEO_AUTHORITY");
      recommendedNextActions.push("Bind an authoritative source video");
    } else if (blockingReasons.length === 0) {
      mode = "VIDEO_TO_VIDEO";
      selectedBindingIds = [videoAuthority.selected.bindingId];
    }
  } else if (blockingReasons.length === 0) {
    const noUsableStoryAssets =
      assetIntelligenceStatus === "NO_ASSETS" ||
      relevantBindings.length === 0;
    const confirmation = matching.noAssetConfirmation;
    const hasValidConfirmation =
      confirmation?.storyId === input.storyId &&
      confirmation.storyVersionId === input.storyVersionId;
    if (noUsableStoryAssets && !hasValidConfirmation) {
      blockingReasons.push(
        "Reference-free execution requires explicit CONFIRMED_NO_ASSETS authority"
      );
      recommendedNextActions.push(
        "Upload recommended Assets or explicitly confirm no Assets"
      );
    } else {
      mode = "TEXT_TO_VIDEO";
    }
  }

  const resolutionStatus = mode ? "RESOLVED" : "NO_VALID_MODE";
  const sourceReason =
    mode === "IMAGE_TO_VIDEO"
      ? "Exact source-frame execution authority is required and pinned"
      : mode === "VIDEO_TO_VIDEO"
        ? "Source-video execution authority is required and pinned"
        : mode === "TEXT_TO_VIDEO"
          ? relevantBindings.length > 0
            ? "Existing Assets are supporting authorities and do not require source-media execution"
            : "Explicit no-Asset authority permits reference-free execution"
          : blockingReasons.join("; ");

  return AiStoryModeResolutionSnapshotSchema.parse({
    contractVersion: AI_STORY_MODE_RESOLUTION_CONTRACT_VERSION,
    plannerSnapshotId: input.plannerSnapshotId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    matchingResultId: matching.matchingResultId,
    matchingContractVersion: matching.contractVersion,
    bindingAuthorities: activeBindings.map((binding) => ({
      bindingId: binding.bindingId,
      assetId: binding.assetId,
      analysisSnapshotId: binding.analysisSnapshotId,
      contentHash: binding.analysisContentHash,
      role: binding.role,
      required: binding.required,
    })),
    characterDnaAuthority: matching.characterDnaAuthority,
    noAssetConfirmation: matching.noAssetConfirmation,
    assetIntelligenceStatus,
    continuityRequirements: continuity,
    audioIntent: matching.audioIntent,
    capabilityRequirements: {
      visual: unique(visualCapabilities),
      audio: [audioCapability(matching.audioIntent)],
      authority: unique(authorityCapabilities),
    },
    resolutionStatus,
    resolvedGenerationMode: mode,
    selectedBindingIds,
    blockingReasons: unique(blockingReasons),
    missingAuthorities: unique(missingAuthorities),
    recommendedNextActions: unique(recommendedNextActions),
    resolutionTrace: [
      {
        step: "VALIDATE_UPSTREAM_AUTHORITY",
        outcome: `Story Version and ${activeBindings.length} active binding(s) validated`,
        bindingIds: activeBindings.map((binding) => binding.bindingId),
      },
      {
        step: "DERIVE_PROVIDER_NEUTRAL_CAPABILITIES",
        outcome: `${visualCapabilities.join(",")} | ${audioCapability(
          matching.audioIntent
        )}`,
        bindingIds: [],
      },
      {
        step: "RESOLVE_REQUIRED_SOURCE_AUTHORITY",
        outcome: sourceReason,
        bindingIds: selectedBindingIds,
      },
      {
        step: "RESOLVE_GENERATION_MODE",
        outcome: mode ?? "NO_VALID_MODE",
        bindingIds: selectedBindingIds,
      },
    ],
    resolverVersion: input.resolverVersion,
    createdAt: input.createdAt,
  });
}
