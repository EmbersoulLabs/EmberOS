/**
 * Sprint 3 PR 3.6 Phase 1 — Deterministic Story Assembly Runtime contracts.
 *
 * FINAL FROZEN architecture: contract & identity layer only.
 *
 * Does NOT implement: repositories, SQL, persistence, projection, Assembly Engine,
 * artifact store, media processing, transactions, runtime, export, publish,
 * browser UI, worker, router, Seedance, MiniMax, Finalizer, usage, cost, or
 * public execution unlock.
 *
 * Aggregate hierarchy unchanged — Execution Plan remains the sole Aggregate Root.
 * Assembly Job / facts / Final Story Result remain subordinate.
 */
import { createHash } from "crypto";
import { z } from "zod";
import {
  RuntimeMediaReferenceSchema,
  RuntimeOwnershipIdentitySchema,
  type RuntimeOwnershipIdentity,
} from "./ai-story-runtime-contracts";

/* -------------------------------------------------------------------------- */
/* Contract versions                                                          */
/* -------------------------------------------------------------------------- */

export const ASSEMBLY_CONTRACT_VERSION = "1" as const;
export const ASSEMBLY_ENGINE_SNAPSHOT_CONTRACT_VERSION = "1" as const;
export const ASSEMBLY_FACT_CONTRACT_VERSION = "1" as const;
/** PR 3.6 success-only Final Story Result contract version. */
export const ASSEMBLY_FINAL_RESULT_CONTRACT_VERSION = "1" as const;

const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = NonEmptyTextSchema;
const OrderedUuidListSchema = z.array(z.string().uuid()).min(1);
const OrderedHashListSchema = z.array(IntegrityHashSchema).min(1);

/* -------------------------------------------------------------------------- */
/* Failure classifications (exact frozen set)                                 */
/* -------------------------------------------------------------------------- */

export const ASSEMBLY_FAILURE_CLASSIFICATIONS = [
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
  "ASSEMBLY_ENGINE_SNAPSHOT_MISMATCH",
  "ASSEMBLY_ENGINE_FAILED",
  "ASSEMBLY_IDENTITY_CONFLICT",
  "ASSEMBLY_OUTPUT_CONFLICT",
  "ASSEMBLY_ARTIFACT_VALIDATION_FAILED",
  "ASSEMBLY_PERSISTENCE_FAILED",
  "ASSEMBLY_PROJECTION_FAILED",
] as const;

export const AssemblyFailureClassificationSchema = z.enum(
  ASSEMBLY_FAILURE_CLASSIFICATIONS
);
export type AssemblyFailureClassification = z.infer<
  typeof AssemblyFailureClassificationSchema
>;

/* -------------------------------------------------------------------------- */
/* Integrity hashing                                                          */
/* -------------------------------------------------------------------------- */

function sortCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortCanonicalValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortCanonicalValue(child)])
    );
  }
  return value;
}

/**
 * Canonical integrity hash. Equivalent payloads hash identically;
 * conflicting immutable payloads hash differently.
 */
export function assemblyIntegrityHash(value: unknown): string {
  const canonical = JSON.stringify(sortCanonicalValue(value));
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

function deterministicAssemblyUuid(kind: string, fingerprint: string): string {
  const hex = assemblyIntegrityHash({ kind, fingerprint })
    .replace(/^sha256:/, "")
    .slice(0, 32);
  const bytes = hex.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const normalized = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`;
}

/* -------------------------------------------------------------------------- */
/* AssemblyEngineSnapshot                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Immutable AssemblyEngineSnapshot — every FINAL FROZEN field.
 * Records are immutable and explicitly versioned. Replay always uses the
 * snapshot accepted by the Assembly Job.
 */
export const AssemblyEngineSnapshotSchema = z
  .object({
    assemblyEngineSnapshotId: z.string().uuid(),
    engineName: NonEmptyTextSchema,
    engineContractVersion: z.literal(ASSEMBLY_ENGINE_SNAPSHOT_CONTRACT_VERSION),
    engineImplementationVersion: NonEmptyTextSchema,
    binaryName: NonEmptyTextSchema,
    binaryVersion: NonEmptyTextSchema,
    binaryBuildHash: IntegrityHashSchema,
    operatingEnvironmentContractVersion: NonEmptyTextSchema,
    containerFormat: NonEmptyTextSchema,
    videoCodec: NonEmptyTextSchema,
    videoCodecProfile: NonEmptyTextSchema,
    audioCodec: NonEmptyTextSchema,
    pixelFormat: NonEmptyTextSchema,
    frameRatePolicy: NonEmptyTextSchema,
    targetFrameRate: z.number().positive(),
    timeBasePolicy: NonEmptyTextSchema,
    audioSampleRate: z.number().int().positive(),
    audioChannelPolicy: NonEmptyTextSchema,
    streamMappingPolicy: NonEmptyTextSchema,
    rotationNormalizationPolicy: NonEmptyTextSchema,
    metadataStrippingPolicy: NonEmptyTextSchema,
    timestampNormalizationPolicy: NonEmptyTextSchema,
    resolutionNormalizationPolicy: NonEmptyTextSchema,
    aspectRatioNormalizationPolicy: NonEmptyTextSchema,
    normalizationPolicyVersion: NonEmptyTextSchema,
    snapshotContentHash: IntegrityHashSchema,
    acceptedAt: z.string().datetime(),
  })
  .strict();

export type AssemblyEngineSnapshot = z.infer<typeof AssemblyEngineSnapshotSchema>;

/** Immutable engine config used to derive snapshotContentHash (excludes id/hash/acceptedAt). */
export type AssemblyEngineSnapshotConfig = Omit<
  AssemblyEngineSnapshot,
  "assemblyEngineSnapshotId" | "snapshotContentHash" | "acceptedAt"
>;

export function buildAssemblyEngineSnapshotContentHash(
  config: AssemblyEngineSnapshotConfig
): string {
  return assemblyIntegrityHash({
    kind: "assembly-engine-snapshot",
    ...config,
  });
}

export function buildAssemblyEngineSnapshotId(snapshotContentHash: string): string {
  return deterministicAssemblyUuid("assembly-engine-snapshot", snapshotContentHash);
}

/* -------------------------------------------------------------------------- */
/* Assembly Job identity                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Pre-processing identity payload for Assembly Job.
 * Excludes timestamps, runtime metadata, temporary paths, and output hash.
 * AssemblyProcessingStartedFact never participates.
 */
export const AssemblyJobIdentityPayloadSchema = z
  .object({
    executionPlanId: z.string().uuid(),
    assemblyDefinitionId: z.string().uuid(),
    orderedSceneResultIds: OrderedUuidListSchema,
    orderedSceneContentHashes: OrderedHashListSchema,
    assemblyContractVersion: z.literal(ASSEMBLY_CONTRACT_VERSION),
    assemblyEngineSnapshotHash: IntegrityHashSchema,
  })
  .strict();

export type AssemblyJobIdentityPayload = z.infer<
  typeof AssemblyJobIdentityPayloadSchema
>;

export function buildAssemblyJobFingerprint(
  payload: AssemblyJobIdentityPayload
): string {
  const parsed = AssemblyJobIdentityPayloadSchema.parse(payload);
  if (parsed.orderedSceneResultIds.length !== parsed.orderedSceneContentHashes.length) {
    throw new Error(
      "Assembly Job identity requires equal-length ordered scene result ids and content hashes"
    );
  }
  return assemblyIntegrityHash({
    kind: "assembly-job-identity",
    ...parsed,
  });
}

export function buildAssemblyJobId(fingerprint: string): string {
  return deterministicAssemblyUuid("assembly-job", fingerprint);
}

export function buildAssemblyJobIdentity(payload: AssemblyJobIdentityPayload): {
  readonly assemblyJobId: string;
  readonly deterministicFingerprint: string;
  readonly identity: AssemblyJobIdentityPayload;
} {
  const identity = AssemblyJobIdentityPayloadSchema.parse(payload);
  const deterministicFingerprint = buildAssemblyJobFingerprint(identity);
  return {
    assemblyJobId: buildAssemblyJobId(deterministicFingerprint),
    deterministicFingerprint,
    identity,
  };
}

/* -------------------------------------------------------------------------- */
/* AssemblyJob                                                                */
/* -------------------------------------------------------------------------- */

export const AssemblyJobSchema = z
  .object({
    assemblyJobId: z.string().uuid(),
    executionPlanId: z.string().uuid(),
    assemblyDefinitionId: z.string().uuid(),
    runtimeAuthorizationId: z.string().uuid(),
    ownership: RuntimeOwnershipIdentitySchema,
    orderedSceneResultIds: OrderedUuidListSchema,
    orderedSceneContentHashes: OrderedHashListSchema,
    assemblyContractVersion: z.literal(ASSEMBLY_CONTRACT_VERSION),
    assemblyEngineSnapshotId: z.string().uuid(),
    assemblyEngineSnapshotHash: IntegrityHashSchema,
    deterministicFingerprint: IntegrityHashSchema,
    acceptedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((job, ctx) => {
    if (job.orderedSceneResultIds.length !== job.orderedSceneContentHashes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "orderedSceneResultIds and orderedSceneContentHashes must have equal length",
      });
    }
    if (job.ownership.executionPlanId !== job.executionPlanId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ownership.executionPlanId must match executionPlanId",
        path: ["ownership", "executionPlanId"],
      });
    }
  });

export type AssemblyJob = z.infer<typeof AssemblyJobSchema>;

/* -------------------------------------------------------------------------- */
/* Append-only Assembly Job facts                                             */
/* -------------------------------------------------------------------------- */

export const ASSEMBLY_JOB_FACT_KINDS = [
  "ACCEPTED",
  "PROCESSING_STARTED",
  "SUCCEEDED",
  "FAILED",
] as const;

export const AssemblyJobFactKindSchema = z.enum(ASSEMBLY_JOB_FACT_KINDS);
export type AssemblyJobFactKind = z.infer<typeof AssemblyJobFactKindSchema>;

const AssemblyFactBaseFields = {
  factId: z.string().uuid(),
  assemblyJobId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  ownership: RuntimeOwnershipIdentitySchema,
  integrityHash: IntegrityHashSchema,
  contractVersion: z.literal(ASSEMBLY_FACT_CONTRACT_VERSION),
} as const;

/** Records acceptance of the deterministic Assembly Job. */
export const AssemblyJobAcceptedFactSchema = z
  .object({
    ...AssemblyFactBaseFields,
    factKind: z.literal("ACCEPTED"),
    assemblyDefinitionId: z.string().uuid(),
    deterministicFingerprint: IntegrityHashSchema,
    assemblyEngineSnapshotId: z.string().uuid(),
    assemblyEngineSnapshotHash: IntegrityHashSchema,
    acceptedAt: z.string().datetime(),
  })
  .strict();

export type AssemblyJobAcceptedFact = z.infer<typeof AssemblyJobAcceptedFactSchema>;

/**
 * Operational telemetry only.
 * Must never participate in deterministic identity, replay identity,
 * fingerprints, or terminal acceptance.
 */
export const AssemblyProcessingStartedFactSchema = z
  .object({
    ...AssemblyFactBaseFields,
    factKind: z.literal("PROCESSING_STARTED"),
    startedAt: z.string().datetime(),
  })
  .strict();

export type AssemblyProcessingStartedFact = z.infer<
  typeof AssemblyProcessingStartedFactSchema
>;

/** Terminal success — references exactly one accepted Final Story Result. */
export const AssemblySucceededFactSchema = z
  .object({
    ...AssemblyFactBaseFields,
    factKind: z.literal("SUCCEEDED"),
    storyResultId: z.string().uuid(),
    finalMediaContentHash: IntegrityHashSchema,
    completedAt: z.string().datetime(),
  })
  .strict();

export type AssemblySucceededFact = z.infer<typeof AssemblySucceededFactSchema>;

/**
 * Terminal failure — sanitized classification only.
 * Must not reference a Final Story Result (strict schema excludes storyResultId).
 */
export const AssemblyFailedFactSchema = z
  .object({
    ...AssemblyFactBaseFields,
    factKind: z.literal("FAILED"),
    failureClassification: AssemblyFailureClassificationSchema,
    message: NonEmptyTextSchema,
    failedAt: z.string().datetime(),
  })
  .strict();

export type AssemblyFailedFact = z.infer<typeof AssemblyFailedFactSchema>;

export const AssemblyJobFactSchema = z.discriminatedUnion("factKind", [
  AssemblyJobAcceptedFactSchema,
  AssemblyProcessingStartedFactSchema,
  AssemblySucceededFactSchema,
  AssemblyFailedFactSchema,
]);

export type AssemblyJobFact = z.infer<typeof AssemblyJobFactSchema>;

/* -------------------------------------------------------------------------- */
/* Final Story Result identity (success-only)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Completed-result identity payload.
 * Excludes timestamps, runtime metadata, and temporary artifact paths.
 */
export const FinalStoryResultIdentityPayloadSchema = z
  .object({
    assemblyJobId: z.string().uuid(),
    finalMediaContentHash: IntegrityHashSchema,
    finalResultContractVersion: z.literal(ASSEMBLY_FINAL_RESULT_CONTRACT_VERSION),
    assemblyEngineSnapshotHash: IntegrityHashSchema,
  })
  .strict();

export type FinalStoryResultIdentityPayload = z.infer<
  typeof FinalStoryResultIdentityPayloadSchema
>;

export function buildFinalStoryResultFingerprint(
  payload: FinalStoryResultIdentityPayload
): string {
  const parsed = FinalStoryResultIdentityPayloadSchema.parse(payload);
  return assemblyIntegrityHash({
    kind: "final-story-result-identity",
    ...parsed,
  });
}

export function buildFinalStoryResultId(fingerprint: string): string {
  return deterministicAssemblyUuid("final-story-result", fingerprint);
}

export function buildFinalStoryResultIdentity(
  payload: FinalStoryResultIdentityPayload
): {
  readonly storyResultId: string;
  readonly integrityHash: string;
  readonly identity: FinalStoryResultIdentityPayload;
} {
  const identity = FinalStoryResultIdentityPayloadSchema.parse(payload);
  const integrityHash = buildFinalStoryResultFingerprint(identity);
  return {
    storyResultId: buildFinalStoryResultId(integrityHash),
    integrityHash,
    identity,
  };
}

/* -------------------------------------------------------------------------- */
/* Success-only Final Story Result (PR 3.6)                                   */
/* -------------------------------------------------------------------------- */

const FORBIDDEN_FINAL_STORY_KEYS = [
  "status",
  "failureClassification",
  "providerId",
  "providerExecutionId",
  "providerAttemptId",
  "providerPayload",
  "providerRequestId",
  "usage",
  "cost",
  "usageAmount",
  "costAmount",
  "temporaryArtifactPath",
  "tempPath",
  "exportState",
  "publishState",
] as const;

const TEMPORARY_ARTIFACT_URI_PATTERN =
  /(?:^|\/)(?:tmp|temp)(?:\/|$)|temp(?:orary)?[:/]|scratch[:/]/i;

/**
 * PR 3.6 success-only Final Story Result.
 *
 * Distinct from the PR 3.1 language stub (`FinalStoryResultSchema` in
 * ai-story-runtime-contracts), which is not the assembly runtime contract.
 *
 * Failure belongs only to AssemblyFailedFact.
 */
export const AssemblyFinalStoryResultSchema = z
  .object({
    storyResultId: z.string().uuid(),
    assemblyJobId: z.string().uuid(),
    executionPlanId: z.string().uuid(),
    assemblyDefinitionId: z.string().uuid(),
    runtimeAuthorizationId: z.string().uuid(),
    ownership: RuntimeOwnershipIdentitySchema,
    orderedSceneResultIds: OrderedUuidListSchema,
    orderedSceneContentHashes: OrderedHashListSchema,
    mediaReference: RuntimeMediaReferenceSchema,
    finalMediaContentHash: IntegrityHashSchema,
    durationMs: z.number().int().positive(),
    completedAt: z.string().datetime(),
    assemblyContractVersion: z.literal(ASSEMBLY_CONTRACT_VERSION),
    finalResultContractVersion: z.literal(ASSEMBLY_FINAL_RESULT_CONTRACT_VERSION),
    assemblyEngineSnapshotId: z.string().uuid(),
    assemblyEngineSnapshotHash: IntegrityHashSchema,
    integrityHash: IntegrityHashSchema,
  })
  .strict()
  .superRefine((result, ctx) => {
    if (result.orderedSceneResultIds.length !== result.orderedSceneContentHashes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "orderedSceneResultIds and orderedSceneContentHashes must have equal length",
      });
    }
    if (result.mediaReference.contentHash !== result.finalMediaContentHash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "mediaReference.contentHash must equal finalMediaContentHash",
        path: ["mediaReference", "contentHash"],
      });
    }
    if (TEMPORARY_ARTIFACT_URI_PATTERN.test(result.mediaReference.uri)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Final Story Result must not reference temporary artifact paths",
        path: ["mediaReference", "uri"],
      });
    }
    if (result.ownership.executionPlanId !== result.executionPlanId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ownership.executionPlanId must match executionPlanId",
        path: ["ownership", "executionPlanId"],
      });
    }
  });

export type AssemblyFinalStoryResult = z.infer<typeof AssemblyFinalStoryResultSchema>;

/**
 * Parse and reject failed / provider / temporary semantics for Final Story Result.
 */
export function parseAssemblyFinalStoryResult(
  value: unknown
): AssemblyFinalStoryResult {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of FORBIDDEN_FINAL_STORY_KEYS) {
      if (key in record) {
        throw new Error(
          `Final Story Result rejects forbidden field '${key}' (failure belongs to AssemblyFailedFact; provider/temp fields are prohibited)`
        );
      }
    }
  }
  return AssemblyFinalStoryResultSchema.parse(value);
}

export type { RuntimeOwnershipIdentity };
