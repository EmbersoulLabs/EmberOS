/**
 * Sprint 3 PR 3.6 — Deterministic Story Assembly Runtime execution contracts.
 *
 * Consumes an accepted Assembly Job + canonical Scene Results and describes
 * provider-neutral assembly execution. Does NOT persist Final Story Result,
 * unlock public execution, or invoke Providers.
 */
import { z } from "zod";
import {
  ASSEMBLY_FAILURE_CLASSIFICATIONS,
  AssemblyFailureClassificationSchema,
  assemblyIntegrityHash,
  type AssemblyFailureClassification,
  type AssemblyJob,
} from "./ai-story-assembly-runtime";
import {
  RuntimeMediaReferenceSchema,
  RuntimeOwnershipIdentitySchema,
  type CanonicalSceneResult,
  type RuntimeOwnershipIdentity,
} from "./ai-story-runtime-contracts";
import { PHASE1_EXECUTION_LOCKED } from "./ai-story-phase1-execution-lock";

export const ASSEMBLY_RUNTIME_CONTRACT_VERSION = "1" as const;
export const ASSEMBLY_ENGINE_VERSION = "1" as const;
export const ASSEMBLY_NORMALIZATION_POLICY_VERSION = "1" as const;

const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = NonEmptyTextSchema;

/* -------------------------------------------------------------------------- */
/* Runtime failure classifications (execution layer)                          */
/* -------------------------------------------------------------------------- */

export const ASSEMBLY_RUNTIME_FAILURE_CLASSIFICATIONS = [
  "ASSEMBLY_INPUT_INCOMPLETE",
  "ASSEMBLY_MEMBERSHIP_CONFLICT",
  "ASSEMBLY_ORDER_CONFLICT",
  "ASSEMBLY_MEDIA_UNAVAILABLE",
  "ASSEMBLY_MEDIA_HASH_MISMATCH",
  "ASSEMBLY_MEDIA_UNSUPPORTED",
  "ASSEMBLY_MEDIA_PROBE_FAILED",
  "ASSEMBLY_NORMALIZATION_FAILED",
  "ASSEMBLY_CONCATENATION_FAILED",
  "ASSEMBLY_OUTPUT_INVALID",
  "ASSEMBLY_ARTIFACT_PERSISTENCE_FAILED",
  "ASSEMBLY_IDENTITY_CONFLICT",
  "ASSEMBLY_INFRASTRUCTURE_TRANSIENT",
  "ASSEMBLY_INFRASTRUCTURE_TERMINAL",
] as const;

export const AssemblyRuntimeFailureClassificationSchema = z.enum(
  ASSEMBLY_RUNTIME_FAILURE_CLASSIFICATIONS
);
export type AssemblyRuntimeFailureClassification = z.infer<
  typeof AssemblyRuntimeFailureClassificationSchema
>;

export type AssemblyRuntimeFailurePolicy = {
  readonly classification: AssemblyRuntimeFailureClassification;
  readonly retryAllowed: boolean;
  readonly terminal: boolean;
  readonly userActionRequired: boolean;
  readonly safePublicMessage: string;
  /** Frozen AssemblyFailedFact classification when persisting terminal failure. */
  readonly terminalFactClassification: AssemblyFailureClassification;
};

export const ASSEMBLY_RUNTIME_FAILURE_POLICIES: Record<
  AssemblyRuntimeFailureClassification,
  AssemblyRuntimeFailurePolicy
> = {
  ASSEMBLY_INPUT_INCOMPLETE: {
    classification: "ASSEMBLY_INPUT_INCOMPLETE",
    retryAllowed: false,
    terminal: true,
    userActionRequired: true,
    safePublicMessage: "Assembly inputs are incomplete.",
    terminalFactClassification: "ASSEMBLY_DEFINITION_INVALID",
  },
  ASSEMBLY_MEMBERSHIP_CONFLICT: {
    classification: "ASSEMBLY_MEMBERSHIP_CONFLICT",
    retryAllowed: false,
    terminal: true,
    userActionRequired: true,
    safePublicMessage: "Assembly membership conflict.",
    terminalFactClassification: "ASSEMBLY_MEMBERSHIP_INVALID",
  },
  ASSEMBLY_ORDER_CONFLICT: {
    classification: "ASSEMBLY_ORDER_CONFLICT",
    retryAllowed: false,
    terminal: true,
    userActionRequired: true,
    safePublicMessage: "Assembly scene order conflict.",
    terminalFactClassification: "ASSEMBLY_ORDER_INVALID",
  },
  ASSEMBLY_MEDIA_UNAVAILABLE: {
    classification: "ASSEMBLY_MEDIA_UNAVAILABLE",
    retryAllowed: true,
    terminal: false,
    userActionRequired: false,
    safePublicMessage: "Scene media is temporarily unavailable.",
    terminalFactClassification: "SCENE_MEDIA_MISSING",
  },
  ASSEMBLY_MEDIA_HASH_MISMATCH: {
    classification: "ASSEMBLY_MEDIA_HASH_MISMATCH",
    retryAllowed: false,
    terminal: true,
    userActionRequired: true,
    safePublicMessage: "Scene media integrity check failed.",
    terminalFactClassification: "SCENE_MEDIA_HASH_MISMATCH",
  },
  ASSEMBLY_MEDIA_UNSUPPORTED: {
    classification: "ASSEMBLY_MEDIA_UNSUPPORTED",
    retryAllowed: false,
    terminal: true,
    userActionRequired: true,
    safePublicMessage: "Scene media format is unsupported.",
    terminalFactClassification: "SCENE_MEDIA_UNSUPPORTED",
  },
  ASSEMBLY_MEDIA_PROBE_FAILED: {
    classification: "ASSEMBLY_MEDIA_PROBE_FAILED",
    retryAllowed: false,
    terminal: true,
    userActionRequired: true,
    safePublicMessage: "Scene media could not be inspected.",
    terminalFactClassification: "SCENE_MEDIA_CORRUPTED",
  },
  ASSEMBLY_NORMALIZATION_FAILED: {
    classification: "ASSEMBLY_NORMALIZATION_FAILED",
    retryAllowed: false,
    terminal: true,
    userActionRequired: false,
    safePublicMessage: "Deterministic media normalization failed.",
    terminalFactClassification: "ASSEMBLY_ENGINE_FAILED",
  },
  ASSEMBLY_CONCATENATION_FAILED: {
    classification: "ASSEMBLY_CONCATENATION_FAILED",
    retryAllowed: false,
    terminal: true,
    userActionRequired: false,
    safePublicMessage: "Deterministic scene concatenation failed.",
    terminalFactClassification: "ASSEMBLY_ENGINE_FAILED",
  },
  ASSEMBLY_OUTPUT_INVALID: {
    classification: "ASSEMBLY_OUTPUT_INVALID",
    retryAllowed: false,
    terminal: true,
    userActionRequired: false,
    safePublicMessage: "Assembled media output is invalid.",
    terminalFactClassification: "ASSEMBLY_ARTIFACT_VALIDATION_FAILED",
  },
  ASSEMBLY_ARTIFACT_PERSISTENCE_FAILED: {
    classification: "ASSEMBLY_ARTIFACT_PERSISTENCE_FAILED",
    retryAllowed: true,
    terminal: false,
    userActionRequired: false,
    safePublicMessage: "Assembled artifact could not be stored.",
    terminalFactClassification: "ASSEMBLY_PERSISTENCE_FAILED",
  },
  ASSEMBLY_IDENTITY_CONFLICT: {
    classification: "ASSEMBLY_IDENTITY_CONFLICT",
    retryAllowed: false,
    terminal: true,
    userActionRequired: true,
    safePublicMessage: "Assembly identity conflict.",
    terminalFactClassification: "ASSEMBLY_IDENTITY_CONFLICT",
  },
  ASSEMBLY_INFRASTRUCTURE_TRANSIENT: {
    classification: "ASSEMBLY_INFRASTRUCTURE_TRANSIENT",
    retryAllowed: true,
    terminal: false,
    userActionRequired: false,
    safePublicMessage: "Temporary assembly infrastructure failure.",
    terminalFactClassification: "ASSEMBLY_ENGINE_FAILED",
  },
  ASSEMBLY_INFRASTRUCTURE_TERMINAL: {
    classification: "ASSEMBLY_INFRASTRUCTURE_TERMINAL",
    retryAllowed: false,
    terminal: true,
    userActionRequired: false,
    safePublicMessage: "Assembly infrastructure failed permanently.",
    terminalFactClassification: "ASSEMBLY_ENGINE_FAILED",
  },
};

/* -------------------------------------------------------------------------- */
/* Engine / normalization descriptors                                         */
/* -------------------------------------------------------------------------- */

export const AssemblyEngineDescriptorSchema = z
  .object({
    engineName: z.literal("ember-story-assembly"),
    assemblyEngineVersion: z.literal(ASSEMBLY_ENGINE_VERSION),
    normalizationPolicyVersion: z.literal(ASSEMBLY_NORMALIZATION_POLICY_VERSION),
    binaryName: z.literal("ffmpeg"),
    containerFormat: z.literal("mp4"),
    videoCodec: z.literal("h264"),
    pixelFormat: z.literal("yuv420p"),
    targetFrameRate: z.literal(30),
    audioCodec: z.literal("aac"),
    audioSampleRate: z.literal(48000),
    audioChannels: z.literal(2),
  })
  .strict();

export type AssemblyEngineDescriptor = z.infer<typeof AssemblyEngineDescriptorSchema>;

export const DEFAULT_ASSEMBLY_ENGINE_DESCRIPTOR: AssemblyEngineDescriptor =
  AssemblyEngineDescriptorSchema.parse({
    engineName: "ember-story-assembly",
    assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
    normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
    binaryName: "ffmpeg",
    containerFormat: "mp4",
    videoCodec: "h264",
    pixelFormat: "yuv420p",
    targetFrameRate: 30,
    audioCodec: "aac",
    audioSampleRate: 48000,
    audioChannels: 2,
  });

export const AssemblyNormalizationPlanSchema = z
  .object({
    normalizationPolicyVersion: z.literal(ASSEMBLY_NORMALIZATION_POLICY_VERSION),
    targetWidth: z.number().int().positive(),
    targetHeight: z.number().int().positive(),
    targetFrameRate: z.literal(30),
    videoCodec: z.literal("h264"),
    pixelFormat: z.literal("yuv420p"),
    audioCodec: z.literal("aac"),
    audioSampleRate: z.literal(48000),
    audioChannels: z.literal(2),
    insertSilentAudioWhenMissing: z.literal(true),
    scaleMode: z.literal("scale-and-pad"),
    padColor: z.literal("black"),
    forbidTransitions: z.literal(true),
    forbidCreativeEffects: z.literal(true),
  })
  .strict();

export type AssemblyNormalizationPlan = z.infer<typeof AssemblyNormalizationPlanSchema>;

/* -------------------------------------------------------------------------- */
/* Media probe / scene inputs                                                 */
/* -------------------------------------------------------------------------- */

export const AssemblyMediaProbeSchema = z
  .object({
    sceneResultId: z.string().uuid(),
    mediaType: NonEmptyTextSchema,
    durationMs: z.number().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frameRate: z.number().positive().nullable(),
    videoCodec: NonEmptyTextSchema,
    hasAudio: z.boolean(),
    audioCodec: NonEmptyTextSchema.nullable(),
    timeBase: NonEmptyTextSchema.nullable(),
    byteSize: z.number().int().nonnegative().nullable(),
    contentHash: IntegrityHashSchema,
  })
  .strict();

export type AssemblyMediaProbe = z.infer<typeof AssemblyMediaProbeSchema>;

export const AssemblyRuntimeSceneInputSchema = z
  .object({
    sceneResultId: z.string().uuid(),
    sceneExecutionId: z.string().uuid(),
    sceneId: NonEmptyTextSchema,
    sceneOrder: z.number().int().nonnegative(),
    contentHash: IntegrityHashSchema,
    mediaReference: RuntimeMediaReferenceSchema,
    durationMs: z.number().int().positive(),
    localMediaPath: NonEmptyTextSchema.optional(),
  })
  .strict();

export type AssemblyRuntimeSceneInput = z.infer<typeof AssemblyRuntimeSceneInputSchema>;

export const AssemblyRuntimeInputSchema = z
  .object({
    assemblyJobId: z.string().uuid(),
    executionPlanId: z.string().uuid(),
    assemblyDefinitionId: z.string().uuid(),
    ownership: RuntimeOwnershipIdentitySchema,
    assemblyRuntimeContractVersion: z.literal(ASSEMBLY_RUNTIME_CONTRACT_VERSION),
    assemblyEngineVersion: z.literal(ASSEMBLY_ENGINE_VERSION),
    normalizationPolicyVersion: z.literal(ASSEMBLY_NORMALIZATION_POLICY_VERSION),
    orderedScenes: z.array(AssemblyRuntimeSceneInputSchema).min(1),
    job: z.custom<AssemblyJob>(),
  })
  .strict();

export type AssemblyRuntimeInput = z.infer<typeof AssemblyRuntimeInputSchema>;

/* -------------------------------------------------------------------------- */
/* Artifact / result                                                          */
/* -------------------------------------------------------------------------- */

export const AssemblyArtifactSchema = z
  .object({
    artifactId: z.string().uuid(),
    assemblyJobId: z.string().uuid(),
    executionPlanId: z.string().uuid(),
    ownership: RuntimeOwnershipIdentitySchema,
    artifactReference: NonEmptyTextSchema,
    contentHash: IntegrityHashSchema,
    mediaType: z.literal("video/mp4"),
    durationMs: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frameRate: z.number().positive(),
    byteSize: z.number().int().positive(),
    assemblyEngineVersion: z.literal(ASSEMBLY_ENGINE_VERSION),
    normalizationPolicyVersion: z.literal(ASSEMBLY_NORMALIZATION_POLICY_VERSION),
    assemblyRuntimeContractVersion: z.literal(ASSEMBLY_RUNTIME_CONTRACT_VERSION),
    integrityHash: IntegrityHashSchema,
    createdAt: z.string().datetime(),
  })
  .strict();

export type AssemblyArtifact = z.infer<typeof AssemblyArtifactSchema>;

export const AssemblyRuntimeResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("SUCCEEDED"),
      assemblyJobId: z.string().uuid(),
      executionIdentity: IntegrityHashSchema,
      artifact: AssemblyArtifactSchema,
      completedAt: z.string().datetime(),
      replayed: z.boolean(),
      executionAllowed: z.literal(false),
      executionLockCode: z.literal(PHASE1_EXECUTION_LOCKED),
    })
    .strict(),
  z
    .object({
      status: z.literal("FAILED"),
      assemblyJobId: z.string().uuid(),
      executionIdentity: IntegrityHashSchema,
      classification: AssemblyRuntimeFailureClassificationSchema,
      terminalFactClassification: AssemblyFailureClassificationSchema,
      message: NonEmptyTextSchema,
      failedAt: z.string().datetime(),
      replayed: z.boolean(),
      executionAllowed: z.literal(false),
      executionLockCode: z.literal(PHASE1_EXECUTION_LOCKED),
    })
    .strict(),
]);

export type AssemblyRuntimeResult = z.infer<typeof AssemblyRuntimeResultSchema>;

/* -------------------------------------------------------------------------- */
/* Deterministic execution identity                                           */
/* -------------------------------------------------------------------------- */

export const AssemblyExecutionIdentityPayloadSchema = z
  .object({
    executionPlanId: z.string().uuid(),
    assemblyDefinitionId: z.string().uuid(),
    assemblyJobId: z.string().uuid(),
    orderedSceneResultIds: z.array(z.string().uuid()).min(1),
    orderedSceneContentHashes: z.array(IntegrityHashSchema).min(1),
    assemblyRuntimeContractVersion: z.literal(ASSEMBLY_RUNTIME_CONTRACT_VERSION),
    assemblyEngineVersion: z.literal(ASSEMBLY_ENGINE_VERSION),
    normalizationPolicyVersion: z.literal(ASSEMBLY_NORMALIZATION_POLICY_VERSION),
  })
  .strict();

export type AssemblyExecutionIdentityPayload = z.infer<
  typeof AssemblyExecutionIdentityPayloadSchema
>;

export function buildAssemblyExecutionIdentity(
  payload: AssemblyExecutionIdentityPayload
): string {
  const parsed = AssemblyExecutionIdentityPayloadSchema.parse(payload);
  if (parsed.orderedSceneResultIds.length !== parsed.orderedSceneContentHashes.length) {
    throw new Error("Assembly execution identity requires equal-length scene id/hash lists");
  }
  return assemblyIntegrityHash({
    kind: "assembly-execution-identity",
    ...parsed,
  });
}

export function buildAssemblyArtifactId(executionIdentity: string): string {
  const hex = executionIdentity.replace(/^sha256:/, "").slice(0, 32);
  const bytes = hex.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const normalized = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`;
}

/** Binding id for SUCCEEDED fact — not a persisted Final Story Result. */
export function buildAssemblySucceededBindingId(executionIdentity: string): string {
  return buildAssemblyArtifactId(`binding:${executionIdentity}`);
}

/* -------------------------------------------------------------------------- */
/* Read projection (non-authoritative)                                        */
/* -------------------------------------------------------------------------- */

export const ASSEMBLY_RUNTIME_PROJECTION_STATES = [
  "NOT_STARTED",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
] as const;

export const AssemblyRuntimeProjectionStateSchema = z.enum(
  ASSEMBLY_RUNTIME_PROJECTION_STATES
);
export type AssemblyRuntimeProjectionState = z.infer<
  typeof AssemblyRuntimeProjectionStateSchema
>;

export const AssemblyRuntimeProjectionSchema = z
  .object({
    assemblyJobId: z.string().uuid(),
    executionPlanId: z.string().uuid(),
    state: AssemblyRuntimeProjectionStateSchema,
    processingStarted: z.boolean(),
    terminalStatus: z.enum(["NONE", "SUCCEEDED", "FAILED"]),
    sceneCount: z.number().int().nonnegative(),
    inputValidationStatus: z.enum(["UNKNOWN", "PASSED", "FAILED"]),
    artifactAvailable: z.boolean(),
    safeFailureClassification: AssemblyRuntimeFailureClassificationSchema.nullable(),
    assemblyEngineVersion: z.literal(ASSEMBLY_ENGINE_VERSION).nullable(),
    acceptedAt: z.string().datetime().nullable(),
    processingStartedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    executionAllowed: z.literal(false),
    executionLockCode: z.literal(PHASE1_EXECUTION_LOCKED),
    derivedAt: z.string().datetime(),
  })
  .strict();

export type AssemblyRuntimeProjection = z.infer<typeof AssemblyRuntimeProjectionSchema>;

export function redactSensitiveAssemblyValue(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'\\]+/gi, "[REDACTED_URL]")
    .replace(/([?&](?:token|sig|signature|X-Amz-Signature)=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/\/(?:tmp|temp|var\/folders)\/[^\s"']+/gi, "[REDACTED_PATH]");
}

export type { AssemblyFailureClassification, CanonicalSceneResult, RuntimeOwnershipIdentity };

/** Exhaustiveness helper for frozen terminal classifications. */
void ASSEMBLY_FAILURE_CLASSIFICATIONS;
