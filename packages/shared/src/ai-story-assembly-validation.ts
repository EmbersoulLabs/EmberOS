/**
 * Sprint 3 PR 3.6 Phase 2 — Assembly Validation Layer contracts.
 *
 * READ-ONLY validation language. Does not create Assembly Jobs, Final Story
 * Results, facts, projections, persistence, SQL, media processing, or unlock
 * public execution.
 */
import { z } from "zod";
import {
  ASSEMBLY_FAILURE_CLASSIFICATIONS,
  AssemblyFailureClassificationSchema,
  type AssemblyFailureClassification,
} from "./ai-story-assembly-runtime";
import { RuntimeOwnershipIdentitySchema } from "./ai-story-runtime-contracts";

/* -------------------------------------------------------------------------- */
/* V1 technical media contract (metadata declarations only)                   */
/* -------------------------------------------------------------------------- */

/** Frozen V1 input containers (metadata declaration — not FFmpeg probe). */
export const ASSEMBLY_V1_SUPPORTED_CONTAINERS = ["mp4"] as const;
export const AssemblyV1SupportedContainerSchema = z.enum(
  ASSEMBLY_V1_SUPPORTED_CONTAINERS
);
export type AssemblyV1SupportedContainer = z.infer<
  typeof AssemblyV1SupportedContainerSchema
>;

/** Frozen V1 input video codecs (metadata declaration — not FFmpeg probe). */
export const ASSEMBLY_V1_SUPPORTED_VIDEO_CODECS = ["h264", "avc1"] as const;
export const AssemblyV1SupportedVideoCodecSchema = z.enum(
  ASSEMBLY_V1_SUPPORTED_VIDEO_CODECS
);
export type AssemblyV1SupportedVideoCodec = z.infer<
  typeof AssemblyV1SupportedVideoCodecSchema
>;

/** Frozen V1 input audio codecs; absence of audio is allowed. */
export const ASSEMBLY_V1_SUPPORTED_AUDIO_CODECS = ["aac", "none"] as const;
export const AssemblyV1SupportedAudioCodecSchema = z.enum(
  ASSEMBLY_V1_SUPPORTED_AUDIO_CODECS
);
export type AssemblyV1SupportedAudioCodec = z.infer<
  typeof AssemblyV1SupportedAudioCodecSchema
>;

export const ASSEMBLY_V1_SUPPORTED_MEDIA_TYPES = ["video/mp4"] as const;

/**
 * Declared Scene media metadata for contract-only validation.
 * Never obtained by invoking FFmpeg in Phase 2.
 */
export const AssemblySceneMediaMetadataSchema = z
  .object({
    sceneResultId: z.string().uuid(),
    contentHash: z.string().trim().min(1),
    mediaType: z.string().trim().min(1),
    container: z.string().trim().min(1),
    videoCodec: z.string().trim().min(1),
    audioCodec: z.string().trim().min(1).default("none"),
    durationMs: z.number().int(),
    metadataReadable: z.boolean(),
    videoStreamCount: z.number().int().nonnegative().default(1),
  })
  .strict();

export type AssemblySceneMediaMetadata = z.infer<
  typeof AssemblySceneMediaMetadataSchema
>;

/* -------------------------------------------------------------------------- */
/* Read models (validation inputs)                                            */
/* -------------------------------------------------------------------------- */

/** Minimal Execution Plan identity loaded for validation. */
export const AssemblyValidationExecutionPlanSchema = z
  .object({
    executionPlanId: z.string().uuid(),
    integrityHash: z.string().trim().min(1),
    orgId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    campaignId: z.string().uuid(),
    storyId: z.string().uuid(),
    storyVersionId: z.string().uuid(),
    animationPackageId: z.string().uuid(),
  })
  .strict();

export type AssemblyValidationExecutionPlan = z.infer<
  typeof AssemblyValidationExecutionPlanSchema
>;

/** Expected ownership chain supplied by the caller (org/workspace scoped). */
export const AssemblyValidationOwnershipExpectationSchema =
  RuntimeOwnershipIdentitySchema;
export type AssemblyValidationOwnershipExpectation = z.infer<
  typeof AssemblyValidationOwnershipExpectationSchema
>;

export const AssemblyValidationRequestSchema = z
  .object({
    executionPlanId: z.string().uuid(),
    ownership: AssemblyValidationOwnershipExpectationSchema,
  })
  .strict();

export type AssemblyValidationRequest = z.infer<
  typeof AssemblyValidationRequestSchema
>;

/* -------------------------------------------------------------------------- */
/* Validation outcomes                                                        */
/* -------------------------------------------------------------------------- */

/** Phase 2 may only emit these frozen classifications (subset of PR 3.6 set). */
export const ASSEMBLY_VALIDATION_FAILURE_CLASSIFICATIONS = [
  "ASSEMBLY_DEFINITION_INVALID",
  "ASSEMBLY_MEMBERSHIP_INVALID",
  "ASSEMBLY_ORDER_INVALID",
  "SCENE_RESULT_MISSING",
  "SCENE_RESULT_FAILED",
  "SCENE_RESULT_CONFLICT",
  "SCENE_MEDIA_MISSING",
  "SCENE_MEDIA_HASH_MISMATCH",
  "SCENE_MEDIA_UNSUPPORTED",
  "SCENE_MEDIA_CORRUPTED",
] as const satisfies ReadonlyArray<
  (typeof ASSEMBLY_FAILURE_CLASSIFICATIONS)[number]
>;

export const AssemblyValidationFailureClassificationSchema = z.enum(
  ASSEMBLY_VALIDATION_FAILURE_CLASSIFICATIONS
);
export type AssemblyValidationFailureClassification = z.infer<
  typeof AssemblyValidationFailureClassificationSchema
>;

export const AssemblyValidationIssueSchema = z
  .object({
    classification: AssemblyFailureClassificationSchema,
    message: z.string().trim().min(1),
    executionPlanId: z.string().uuid().optional(),
    assemblyDefinitionId: z.string().uuid().optional(),
    sceneExecutionId: z.string().uuid().optional(),
    sceneResultId: z.string().uuid().optional(),
    sceneOrder: z.number().int().nonnegative().optional(),
  })
  .strict();

export type AssemblyValidationIssue = z.infer<typeof AssemblyValidationIssueSchema>;

export const AssemblyValidationResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      executionPlanId: z.string().uuid(),
      assemblyDefinitionId: z.string().uuid(),
      orderedSceneResultIds: z.array(z.string().uuid()).min(1),
      orderedSceneContentHashes: z.array(z.string().trim().min(1)).min(1),
      validationFingerprint: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      executionPlanId: z.string().uuid(),
      issues: z.array(AssemblyValidationIssueSchema).min(1),
      validationFingerprint: z.string().trim().min(1),
    })
    .strict(),
]);

export type AssemblyValidationResult = z.infer<typeof AssemblyValidationResultSchema>;

export type { AssemblyFailureClassification };
