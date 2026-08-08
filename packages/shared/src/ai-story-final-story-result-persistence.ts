/**
 * Sprint 3 PR 3.7 Phase A — Final Story Result persistence contracts.
 *
 * SUCCESS-ONLY immutable projection subordinate to the Execution Plan.
 * Does NOT implement: projector, Execute, worker wiring, Export, Publish,
 * Browser UI, Provider adapters, or public execution unlock.
 *
 * Identity reuses the frozen PR 3.6 Final Story Result identity algorithm
 * (assemblyJobId + finalMediaContentHash + contract version + engine snapshot
 * hash already bound into Assembly Job identity). Do not invent a second
 * independent identity algorithm.
 */
import { z } from "zod";
import {
  ASSEMBLY_FINAL_RESULT_CONTRACT_VERSION,
  assemblyIntegrityHash,
  buildFinalStoryResultIdentity,
} from "./ai-story-assembly-runtime";
import {
  ASSEMBLY_ENGINE_VERSION,
  ASSEMBLY_NORMALIZATION_POLICY_VERSION,
  ASSEMBLY_RUNTIME_CONTRACT_VERSION,
} from "./ai-story-assembly-runtime-execution";
import {
  RuntimeOwnershipIdentitySchema,
  type RuntimeOwnershipIdentity,
} from "./ai-story-runtime-contracts";

export const FINAL_STORY_RESULT_PERSISTENCE_CONTRACT_VERSION =
  ASSEMBLY_FINAL_RESULT_CONTRACT_VERSION;
export const FINAL_STORY_RESULT_PROJECTION_VERSION = "1" as const;

const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = NonEmptyTextSchema;
const OrderedUuidListSchema = z.array(z.string().uuid()).min(1);

const FORBIDDEN_PERSISTENCE_KEYS = [
  "status",
  "failureStatus",
  "failureClassification",
  "providerId",
  "providerRequestId",
  "providerAttemptId",
  "providerExecutionId",
  "rawProviderPayload",
  "providerPayload",
  "credentials",
  "signedUrl",
  "localFilesystemPath",
  "tempPath",
  "temporaryArtifactPath",
  "ffmpegArgs",
  "exportState",
  "publishState",
] as const;

const SIGNED_OR_HTTP_PATTERN =
  /^(?:https?:|file:)|[?&](?:token|sig|signature|X-Amz-Signature)=/i;
const TEMP_PATH_PATTERN = /(?:^|\/)(?:tmp|temp)(?:\/|$)|temp(?:orary)?[:/]|scratch[:/]/i;
const ABSOLUTE_LOCAL_PATH_PATTERN = /^(?:[a-zA-Z]:[\\/]|\/(?!\/))/;

/**
 * Durable workspace-scoped object key only.
 * Phase A does not mint playback signed URLs.
 */
export function assertDurableWorkspaceMediaReference(
  workspaceId: string,
  outputMediaReference: string
): void {
  const ref = outputMediaReference.trim();
  if (!ref.startsWith(`${workspaceId}/`)) {
    throw new Error(
      "Final Story Result outputMediaReference must be workspace-scoped"
    );
  }
  if (ref.includes("..")) {
    throw new Error(
      "Final Story Result outputMediaReference must not contain path traversal"
    );
  }
  if (SIGNED_OR_HTTP_PATTERN.test(ref)) {
    throw new Error(
      "Final Story Result outputMediaReference must not be a signed URL or http(s)/file URI"
    );
  }
  if (TEMP_PATH_PATTERN.test(ref) || ABSOLUTE_LOCAL_PATH_PATTERN.test(ref)) {
    throw new Error(
      "Final Story Result outputMediaReference must not be a temporary or absolute local path"
    );
  }
}

/**
 * PR 3.7 persistence identity — delegates to frozen PR 3.6 algorithm.
 * `assemblyJobIdentity` is the Assembly Job deterministic fingerprint and is
 * validated by the repository against the job row; it is not independently
 * re-hashed into a second id algorithm.
 */
export function buildPersistedFinalStoryResultIdentity(input: {
  readonly assemblyJobId: string;
  readonly assemblyJobIdentity: string;
  readonly finalMediaContentHash: string;
  readonly assemblyEngineSnapshotHash: string;
  readonly finalStoryResultContractVersion?: typeof FINAL_STORY_RESULT_PERSISTENCE_CONTRACT_VERSION;
}): {
  readonly finalStoryResultId: string;
  readonly integrityBindingHash: string;
  readonly assemblyJobIdentity: string;
} {
  const contractVersion =
    input.finalStoryResultContractVersion ??
    FINAL_STORY_RESULT_PERSISTENCE_CONTRACT_VERSION;
  if (!input.assemblyJobIdentity.trim()) {
    throw new Error("assemblyJobIdentity is required");
  }
  const binding = buildFinalStoryResultIdentity({
    assemblyJobId: input.assemblyJobId,
    finalMediaContentHash: input.finalMediaContentHash,
    finalResultContractVersion: contractVersion,
    assemblyEngineSnapshotHash: input.assemblyEngineSnapshotHash,
  });
  return {
    finalStoryResultId: binding.storyResultId,
    integrityBindingHash: binding.integrityHash,
    assemblyJobIdentity: input.assemblyJobIdentity,
  };
}

/**
 * Success-only Final Story Result persistence record.
 * Timestamps are stored but excluded from integrity derivation.
 */
const FinalStoryResultPersistenceObjectSchema = z
  .object({
    finalStoryResultId: z.string().uuid(),
    orgId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    campaignId: z.string().uuid(),
    storyId: z.string().uuid(),
    storyVersionId: z.string().uuid(),
    animationPackageId: z.string().uuid(),
    executionPlanId: z.string().uuid(),
    assemblyDefinitionId: z.string().uuid(),
    assemblyJobId: z.string().uuid(),
    assemblyArtifactId: z.string().uuid(),
    assemblyJobIdentity: IntegrityHashSchema,
    orderedSceneResultIds: OrderedUuidListSchema,
    outputMediaReference: NonEmptyTextSchema,
    contentHash: IntegrityHashSchema,
    mediaType: z.literal("video/mp4"),
    totalDurationMs: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frameRate: z.number().positive(),
    assemblyRuntimeContractVersion: z.literal(ASSEMBLY_RUNTIME_CONTRACT_VERSION),
    assemblyEngineVersion: z.literal(ASSEMBLY_ENGINE_VERSION),
    normalizationPolicyVersion: z.literal(ASSEMBLY_NORMALIZATION_POLICY_VERSION),
    finalStoryResultContractVersion: z.literal(
      FINAL_STORY_RESULT_PERSISTENCE_CONTRACT_VERSION
    ),
    assemblyEngineSnapshotHash: IntegrityHashSchema,
    acceptedAt: z.string().datetime(),
    projectedAt: z.string().datetime(),
    projectionVersion: z.literal(FINAL_STORY_RESULT_PROJECTION_VERSION),
    integrityHash: IntegrityHashSchema,
    ownership: RuntimeOwnershipIdentitySchema,
  })
  .strict();

export type FinalStoryResultPersistenceRecord = z.infer<
  typeof FinalStoryResultPersistenceObjectSchema
>;

export const FinalStoryResultPersistenceRecordSchema =
  FinalStoryResultPersistenceObjectSchema.superRefine((record, ctx) => {
    const ownership = record.ownership as RuntimeOwnershipIdentity;
    if (ownership.executionPlanId !== record.executionPlanId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ownership.executionPlanId must match executionPlanId",
        path: ["ownership", "executionPlanId"],
      });
    }
    if (ownership.orgId !== record.orgId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ownership.orgId must match orgId",
        path: ["ownership", "orgId"],
      });
    }
    if (ownership.workspaceId !== record.workspaceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ownership.workspaceId must match workspaceId",
        path: ["ownership", "workspaceId"],
      });
    }
    try {
      assertDurableWorkspaceMediaReference(
        record.workspaceId,
        record.outputMediaReference
      );
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : String(error),
        path: ["outputMediaReference"],
      });
    }
  });

/** Payload fields that participate in integrity (timestamps excluded). */
export function finalStoryResultIntegrityPayload(
  record: Omit<
    FinalStoryResultPersistenceRecord,
    "acceptedAt" | "projectedAt" | "integrityHash"
  >
): unknown {
  return {
    kind: "final-story-result-persistence",
    finalStoryResultId: record.finalStoryResultId,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    campaignId: record.campaignId,
    storyId: record.storyId,
    storyVersionId: record.storyVersionId,
    animationPackageId: record.animationPackageId,
    executionPlanId: record.executionPlanId,
    assemblyDefinitionId: record.assemblyDefinitionId,
    assemblyJobId: record.assemblyJobId,
    assemblyArtifactId: record.assemblyArtifactId,
    assemblyJobIdentity: record.assemblyJobIdentity,
    orderedSceneResultIds: record.orderedSceneResultIds,
    outputMediaReference: record.outputMediaReference,
    contentHash: record.contentHash,
    mediaType: record.mediaType,
    totalDurationMs: record.totalDurationMs,
    width: record.width,
    height: record.height,
    frameRate: record.frameRate,
    assemblyRuntimeContractVersion: record.assemblyRuntimeContractVersion,
    assemblyEngineVersion: record.assemblyEngineVersion,
    normalizationPolicyVersion: record.normalizationPolicyVersion,
    finalStoryResultContractVersion: record.finalStoryResultContractVersion,
    assemblyEngineSnapshotHash: record.assemblyEngineSnapshotHash,
    projectionVersion: record.projectionVersion,
    ownership: record.ownership,
  };
}

export function buildFinalStoryResultPersistenceIntegrityHash(
  record: Omit<
    FinalStoryResultPersistenceRecord,
    "acceptedAt" | "projectedAt" | "integrityHash"
  >
): string {
  return assemblyIntegrityHash(finalStoryResultIntegrityPayload(record));
}

export function parseFinalStoryResultPersistenceRecord(
  value: unknown
): FinalStoryResultPersistenceRecord {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of FORBIDDEN_PERSISTENCE_KEYS) {
      if (key in record) {
        throw new Error(
          `Final Story Result persistence rejects forbidden field '${key}'`
        );
      }
    }
  }
  const parsed = FinalStoryResultPersistenceRecordSchema.parse(value);
  const expectedId = buildPersistedFinalStoryResultIdentity({
    assemblyJobId: parsed.assemblyJobId,
    assemblyJobIdentity: parsed.assemblyJobIdentity,
    finalMediaContentHash: parsed.contentHash,
    assemblyEngineSnapshotHash: parsed.assemblyEngineSnapshotHash,
    finalStoryResultContractVersion: parsed.finalStoryResultContractVersion,
  });
  if (parsed.finalStoryResultId !== expectedId.finalStoryResultId) {
    throw new Error(
      "finalStoryResultId does not match frozen PR 3.6 identity derivation"
    );
  }
  const expectedIntegrity = buildFinalStoryResultPersistenceIntegrityHash(parsed);
  if (parsed.integrityHash !== expectedIntegrity) {
    throw new Error("Final Story Result integrityHash mismatch");
  }
  return parsed;
}

export function buildFinalStoryResultPersistenceRecord(input: {
  readonly ownership: RuntimeOwnershipIdentity;
  readonly assemblyDefinitionId: string;
  readonly assemblyJobId: string;
  readonly assemblyJobIdentity: string;
  readonly assemblyArtifactId: string;
  readonly orderedSceneResultIds: readonly string[];
  readonly outputMediaReference: string;
  readonly contentHash: string;
  readonly totalDurationMs: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly assemblyEngineSnapshotHash: string;
  readonly acceptedAt: string;
  readonly projectedAt: string;
}): FinalStoryResultPersistenceRecord {
  const ownership = input.ownership;
  const identity = buildPersistedFinalStoryResultIdentity({
    assemblyJobId: input.assemblyJobId,
    assemblyJobIdentity: input.assemblyJobIdentity,
    finalMediaContentHash: input.contentHash,
    assemblyEngineSnapshotHash: input.assemblyEngineSnapshotHash,
  });
  const base = {
    finalStoryResultId: identity.finalStoryResultId,
    orgId: ownership.orgId,
    workspaceId: ownership.workspaceId,
    campaignId: ownership.campaignId,
    storyId: ownership.storyId,
    storyVersionId: ownership.storyVersionId,
    animationPackageId: ownership.animationPackageId,
    executionPlanId: ownership.executionPlanId,
    assemblyDefinitionId: input.assemblyDefinitionId,
    assemblyJobId: input.assemblyJobId,
    assemblyArtifactId: input.assemblyArtifactId,
    assemblyJobIdentity: input.assemblyJobIdentity,
    orderedSceneResultIds: [...input.orderedSceneResultIds],
    outputMediaReference: input.outputMediaReference,
    contentHash: input.contentHash,
    mediaType: "video/mp4" as const,
    totalDurationMs: input.totalDurationMs,
    width: input.width,
    height: input.height,
    frameRate: input.frameRate,
    assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
    assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
    normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
    finalStoryResultContractVersion: FINAL_STORY_RESULT_PERSISTENCE_CONTRACT_VERSION,
    assemblyEngineSnapshotHash: input.assemblyEngineSnapshotHash,
    projectionVersion: FINAL_STORY_RESULT_PROJECTION_VERSION,
    ownership,
  };
  return parseFinalStoryResultPersistenceRecord({
    ...base,
    acceptedAt: input.acceptedAt,
    projectedAt: input.projectedAt,
    integrityHash: buildFinalStoryResultPersistenceIntegrityHash(base),
  });
}

/** Marker for boundary tests: PR 3.1 language stub is non-authoritative. */
export const PR31_FINAL_STORY_RESULT_SCHEMA_AUTHORITATIVE_FOR_PERSISTENCE = false as const;
