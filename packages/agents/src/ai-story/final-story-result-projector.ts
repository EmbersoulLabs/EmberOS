/**
 * Sprint 3 PR 3.7 Phase B — Final Story Result Projector.
 *
 * Subordinate projection only:
 *   Accepted Assembly Job + SUCCEEDED fact + Assembly Artifact
 *   → verify artifact readability
 *   → FinalStoryResultRepository.acceptOrConverge
 *
 * Authority remains Execution Plan → Assembly Job / terminal fact → Artifact.
 * Never runs FFmpeg / Assembly Runtime / Providers / production finalization /
 * Export / Publish.
 * Never re-scans or re-hashes Canonical Scene Results (frozen inside Assembly Job).
 */
import {
  assertDurableWorkspaceMediaReference,
  buildFinalStoryResultPersistenceRecord,
  buildPersistedFinalStoryResultIdentity,
  type AssemblyArtifact,
  type AssemblyJob,
  type AssemblyJobFact,
  type AssemblySucceededFact,
  type FinalStoryResultPersistenceRecord,
  type RuntimeOwnershipIdentity,
} from "@ceo-agent/shared/server";
import {
  FinalStoryResultPersistenceError,
  type AssemblyArtifactRepository,
  type AssemblyJobRepository,
  type FinalStoryResultRepository,
} from "@ceo-agent/db";
import type { AssemblyArtifactBlobStore } from "./assembly-runtime-orchestrator";

export type FinalStoryResultProjectorFailureCode =
  | "FINAL_STORY_RESULT_PRECONDITION_FAILED"
  | "FINAL_STORY_RESULT_ARTIFACT_UNREADABLE"
  | "FINAL_STORY_RESULT_ARTIFACT_HASH_MISMATCH"
  | "FINAL_STORY_RESULT_OWNERSHIP_VIOLATION"
  | "FINAL_STORY_RESULT_IDENTITY_CONFLICT"
  | "FINAL_STORY_RESULT_PERSISTENCE_TRANSIENT";

export type FinalStoryResultProjectorSafeMetadata = {
  readonly executionPlanId?: string;
  readonly assemblyJobId?: string;
  readonly assemblyArtifactId?: string;
  readonly retryAllowed: boolean;
};

export class FinalStoryResultProjectorError extends Error {
  constructor(
    readonly code: FinalStoryResultProjectorFailureCode,
    message: string,
    readonly metadata: FinalStoryResultProjectorSafeMetadata
  ) {
    super(message);
    this.name = "FinalStoryResultProjectorError";
  }
}

/** Internal safe read model — no signed URLs / credentials. */
export type FinalStoryResultProjectionOutcome = {
  readonly finalStoryResultId: string;
  readonly executionPlanId: string;
  readonly assemblyJobId: string;
  readonly assemblyArtifactId: string;
  readonly contentHash: string;
  readonly mediaType: "video/mp4";
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly acceptedAt: string;
  readonly projectedAt: string;
  readonly replayed: boolean;
  readonly result: FinalStoryResultPersistenceRecord;
};

export type FinalStoryResultProjectorInput = {
  readonly executionPlanId: string;
  readonly assemblyJobId: string;
};

export type FinalStoryResultProjectorDeps = {
  readonly jobRepository: Pick<
    AssemblyJobRepository,
    "getByAssemblyJobId" | "loadAssemblyFacts"
  >;
  readonly artifactRepository: Pick<AssemblyArtifactRepository, "getByAssemblyJobId">;
  readonly finalStoryResultRepository: FinalStoryResultRepository;
  readonly artifactBlobStore: Pick<AssemblyArtifactBlobStore, "assertReadableArtifact">;
  /** Fault-injection / test clock only. */
  readonly hooks?: {
    readonly beforePersist?: () => Promise<void>;
    readonly now?: () => string;
  };
};

function ownershipEquals(
  left: RuntimeOwnershipIdentity,
  right: RuntimeOwnershipIdentity
): boolean {
  return (
    left.orgId === right.orgId &&
    left.workspaceId === right.workspaceId &&
    left.campaignId === right.campaignId &&
    left.storyId === right.storyId &&
    left.storyVersionId === right.storyVersionId &&
    left.animationPackageId === right.animationPackageId &&
    left.executionPlanId === right.executionPlanId
  );
}

function fail(
  code: FinalStoryResultProjectorFailureCode,
  message: string,
  meta: Omit<FinalStoryResultProjectorSafeMetadata, "retryAllowed"> & {
    readonly retryAllowed?: boolean;
  }
): never {
  throw new FinalStoryResultProjectorError(code, message, {
    ...meta,
    retryAllowed:
      meta.retryAllowed ??
      (code === "FINAL_STORY_RESULT_PERSISTENCE_TRANSIENT" ||
        code === "FINAL_STORY_RESULT_ARTIFACT_UNREADABLE"),
  });
}

function findTerminalSucceeded(
  facts: readonly AssemblyJobFact[]
): AssemblySucceededFact | null {
  const succeeded = facts.find((fact) => fact.factKind === "SUCCEEDED");
  if (!succeeded || succeeded.factKind !== "SUCCEEDED") return null;
  return succeeded;
}

function assertAcceptedAssemblyState(input: {
  readonly executionPlanId: string;
  readonly assemblyJobId: string;
  readonly job: AssemblyJob | null;
  readonly facts: readonly AssemblyJobFact[];
  readonly artifact: AssemblyArtifact | null;
}): {
  readonly job: AssemblyJob;
  readonly succeeded: AssemblySucceededFact;
  readonly artifact: AssemblyArtifact;
} {
  const { executionPlanId, assemblyJobId } = input;

  if (!input.job) {
    fail("FINAL_STORY_RESULT_PRECONDITION_FAILED", "Assembly Job not found", {
      executionPlanId,
      assemblyJobId,
      retryAllowed: false,
    });
  }
  const job = input.job;

  if (job.assemblyJobId !== assemblyJobId) {
    fail("FINAL_STORY_RESULT_OWNERSHIP_VIOLATION", "Assembly Job id mismatch", {
      executionPlanId,
      assemblyJobId,
      retryAllowed: false,
    });
  }

  if (
    job.executionPlanId !== executionPlanId ||
    job.ownership.executionPlanId !== executionPlanId
  ) {
    fail(
      "FINAL_STORY_RESULT_OWNERSHIP_VIOLATION",
      "Assembly Job does not belong to the requested Execution Plan",
      {
        executionPlanId,
        assemblyJobId,
        retryAllowed: false,
      }
    );
  }

  const failed = input.facts.find((fact) => fact.factKind === "FAILED");
  const succeeded = findTerminalSucceeded(input.facts);
  if (!succeeded) {
    fail(
      "FINAL_STORY_RESULT_PRECONDITION_FAILED",
      failed
        ? "Assembly Job terminal fact is FAILED; Final Story Result requires SUCCEEDED"
        : "Assembly Job has no terminal SUCCEEDED fact",
      {
        executionPlanId,
        assemblyJobId,
        retryAllowed: false,
      }
    );
  }

  if (failed) {
    fail(
      "FINAL_STORY_RESULT_PRECONDITION_FAILED",
      "Assembly Job has conflicting FAILED and SUCCEEDED terminal facts",
      {
        executionPlanId,
        assemblyJobId,
        retryAllowed: false,
      }
    );
  }

  if (
    succeeded.assemblyJobId !== job.assemblyJobId ||
    succeeded.executionPlanId !== job.executionPlanId ||
    !ownershipEquals(succeeded.ownership, job.ownership)
  ) {
    fail(
      "FINAL_STORY_RESULT_OWNERSHIP_VIOLATION",
      "SUCCEEDED fact ownership does not match Assembly Job",
      {
        executionPlanId,
        assemblyJobId,
        retryAllowed: false,
      }
    );
  }

  if (!input.artifact) {
    fail(
      "FINAL_STORY_RESULT_PRECONDITION_FAILED",
      "Assembly Artifact not found for succeeded Assembly Job",
      {
        executionPlanId,
        assemblyJobId,
        retryAllowed: false,
      }
    );
  }
  const artifact = input.artifact;

  if (
    artifact.assemblyJobId !== job.assemblyJobId ||
    artifact.executionPlanId !== job.executionPlanId ||
    !ownershipEquals(artifact.ownership, job.ownership)
  ) {
    fail(
      "FINAL_STORY_RESULT_OWNERSHIP_VIOLATION",
      "Assembly Artifact ownership does not match Assembly Job",
      {
        executionPlanId,
        assemblyJobId,
        assemblyArtifactId: artifact.artifactId,
        retryAllowed: false,
      }
    );
  }

  if (succeeded.finalMediaContentHash !== artifact.contentHash) {
    fail(
      "FINAL_STORY_RESULT_ARTIFACT_HASH_MISMATCH",
      "SUCCEEDED finalMediaContentHash does not match Assembly Artifact contentHash",
      {
        executionPlanId,
        assemblyJobId,
        assemblyArtifactId: artifact.artifactId,
        retryAllowed: false,
      }
    );
  }

  const expectedIdentity = buildPersistedFinalStoryResultIdentity({
    assemblyJobId: job.assemblyJobId,
    assemblyJobIdentity: job.deterministicFingerprint,
    finalMediaContentHash: artifact.contentHash,
    assemblyEngineSnapshotHash: job.assemblyEngineSnapshotHash,
  });
  if (succeeded.storyResultId !== expectedIdentity.finalStoryResultId) {
    fail(
      "FINAL_STORY_RESULT_PRECONDITION_FAILED",
      "SUCCEEDED storyResultId does not match frozen Final Story Result identity",
      {
        executionPlanId,
        assemblyJobId,
        assemblyArtifactId: artifact.artifactId,
        retryAllowed: false,
      }
    );
  }

  try {
    assertDurableWorkspaceMediaReference(
      job.ownership.workspaceId,
      artifact.artifactReference
    );
  } catch {
    fail(
      "FINAL_STORY_RESULT_OWNERSHIP_VIOLATION",
      "Assembly Artifact reference fails durable workspace scope check",
      {
        executionPlanId,
        assemblyJobId,
        assemblyArtifactId: artifact.artifactId,
        retryAllowed: false,
      }
    );
  }

  return { job, succeeded, artifact };
}

function buildRecordFromAcceptedAssembly(input: {
  readonly job: AssemblyJob;
  readonly artifact: AssemblyArtifact;
  readonly succeeded: AssemblySucceededFact;
  readonly projectedAt: string;
}): FinalStoryResultPersistenceRecord {
  // orderedSceneResultIds come from the accepted Assembly Job only —
  // do not re-fetch or re-hash Canonical Scene Results.
  return buildFinalStoryResultPersistenceRecord({
    ownership: input.job.ownership,
    assemblyDefinitionId: input.job.assemblyDefinitionId,
    assemblyJobId: input.job.assemblyJobId,
    assemblyJobIdentity: input.job.deterministicFingerprint,
    assemblyArtifactId: input.artifact.artifactId,
    orderedSceneResultIds: input.job.orderedSceneResultIds,
    outputMediaReference: input.artifact.artifactReference,
    contentHash: input.artifact.contentHash,
    totalDurationMs: input.artifact.durationMs,
    width: input.artifact.width,
    height: input.artifact.height,
    frameRate: input.artifact.frameRate,
    assemblyEngineSnapshotHash: input.job.assemblyEngineSnapshotHash,
    acceptedAt: input.succeeded.completedAt,
    projectedAt: input.projectedAt,
  });
}

function mapPersistenceError(
  error: unknown,
  ctx: {
    readonly executionPlanId: string;
    readonly assemblyJobId: string;
    readonly assemblyArtifactId?: string;
  }
): never {
  if (error instanceof FinalStoryResultProjectorError) {
    throw error;
  }
  if (error instanceof FinalStoryResultPersistenceError) {
    if (error.code === "FINAL_STORY_RESULT_IDENTITY_CONFLICT") {
      fail("FINAL_STORY_RESULT_IDENTITY_CONFLICT", error.message, {
        ...ctx,
        retryAllowed: false,
      });
    }
    if (error.code === "FINAL_STORY_RESULT_OWNERSHIP_INVALID") {
      fail("FINAL_STORY_RESULT_OWNERSHIP_VIOLATION", error.message, {
        ...ctx,
        retryAllowed: false,
      });
    }
  }
  fail(
    "FINAL_STORY_RESULT_PERSISTENCE_TRANSIENT",
    "Final Story Result persistence failed transiently; retry projection only",
    {
      ...ctx,
      retryAllowed: true,
    }
  );
}

async function assertArtifactReadable(input: {
  readonly blobStore: Pick<AssemblyArtifactBlobStore, "assertReadableArtifact">;
  readonly job: AssemblyJob;
  readonly artifact: AssemblyArtifact;
}): Promise<void> {
  try {
    await input.blobStore.assertReadableArtifact({
      ownership: input.job.ownership,
      artifactReference: input.artifact.artifactReference,
      expectedContentHash: input.artifact.contentHash,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/hash mismatch/i.test(message)) {
      fail(
        "FINAL_STORY_RESULT_ARTIFACT_HASH_MISMATCH",
        "Assembly Artifact bytes do not match persisted contentHash",
        {
          executionPlanId: input.job.executionPlanId,
          assemblyJobId: input.job.assemblyJobId,
          assemblyArtifactId: input.artifact.artifactId,
          retryAllowed: false,
        }
      );
    }
    fail(
      "FINAL_STORY_RESULT_ARTIFACT_UNREADABLE",
      "Assembly Artifact is not readable; retry projection after storage recovers",
      {
        executionPlanId: input.job.executionPlanId,
        assemblyJobId: input.job.assemblyJobId,
        assemblyArtifactId: input.artifact.artifactId,
        retryAllowed: true,
      }
    );
  }
}

function toOutcome(
  result: FinalStoryResultPersistenceRecord,
  replayed: boolean
): FinalStoryResultProjectionOutcome {
  return {
    finalStoryResultId: result.finalStoryResultId,
    executionPlanId: result.executionPlanId,
    assemblyJobId: result.assemblyJobId,
    assemblyArtifactId: result.assemblyArtifactId,
    contentHash: result.contentHash,
    mediaType: result.mediaType,
    durationMs: result.totalDurationMs,
    width: result.width,
    height: result.height,
    frameRate: result.frameRate,
    acceptedAt: result.acceptedAt,
    projectedAt: result.projectedAt,
    replayed,
    result,
  };
}

/**
 * Project an immutable success-only Final Story Result from accepted Assembly state.
 * Callers may identify Execution Plan + Assembly Job only.
 */
export async function projectFinalStoryResultFromSucceededAssembly(
  input: FinalStoryResultProjectorInput & FinalStoryResultProjectorDeps
): Promise<FinalStoryResultProjectionOutcome> {
  const job = await input.jobRepository.getByAssemblyJobId(input.assemblyJobId);
  const facts = job
    ? await input.jobRepository.loadAssemblyFacts(job.assemblyJobId)
    : [];
  const artifact = job
    ? await input.artifactRepository.getByAssemblyJobId(job.assemblyJobId)
    : null;

  const accepted = assertAcceptedAssemblyState({
    executionPlanId: input.executionPlanId,
    assemblyJobId: input.assemblyJobId,
    job,
    facts,
    artifact,
  });

  await assertArtifactReadable({
    blobStore: input.artifactBlobStore,
    job: accepted.job,
    artifact: accepted.artifact,
  });

  const projectedAt = input.hooks?.now?.() ?? new Date().toISOString();
  const record = buildRecordFromAcceptedAssembly({
    job: accepted.job,
    artifact: accepted.artifact,
    succeeded: accepted.succeeded,
    projectedAt,
  });

  try {
    await input.hooks?.beforePersist?.();
    const persisted = await input.finalStoryResultRepository.acceptOrConverge(record);
    return toOutcome(persisted.result, persisted.replayed);
  } catch (error) {
    mapPersistenceError(error, {
      executionPlanId: input.executionPlanId,
      assemblyJobId: input.assemblyJobId,
      assemblyArtifactId: accepted.artifact.artifactId,
    });
  }
}

export class FinalStoryResultProjector {
  constructor(private readonly deps: FinalStoryResultProjectorDeps) {}

  async projectFromSucceededAssembly(
    input: FinalStoryResultProjectorInput
  ): Promise<FinalStoryResultProjectionOutcome> {
    return projectFinalStoryResultFromSucceededAssembly({
      ...this.deps,
      ...input,
    });
  }
}
