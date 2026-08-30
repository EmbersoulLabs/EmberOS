/**
 * Sprint 3 PR 3.6 — Deterministic Story Assembly Runtime orchestrator.
 *
 * Accepted Assembly Job → validate → PROCESSING_STARTED → normalize/concat →
 * persist artifact → SUCCEEDED | FAILED.
 *
 * Never invokes Providers, never mutates Scene Results, never persists
 * Final Story Result rows, never unlocks public execution.
 */
import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import {
  ASSEMBLY_ENGINE_VERSION,
  ASSEMBLY_NORMALIZATION_POLICY_VERSION,
  ASSEMBLY_RUNTIME_CONTRACT_VERSION,
  ASSEMBLY_RUNTIME_FAILURE_POLICIES,
  AssemblyArtifactSchema,
  AssemblyRuntimeResultSchema,
  PHASE1_EXECUTION_LOCKED,
  buildAssemblyExecutionIdentity,
  type AssemblyArtifact,
  type AssemblyJob,
  type AssemblyJobFact,
  type AssemblyRuntimeFailureClassification,
  type AssemblyRuntimeInput,
  type AssemblyRuntimeResult,
  type AssemblySceneMembership,
  type CanonicalSceneResult,
  type StoryAssemblyDefinition,
} from "@ceo-agent/shared/server";
import type {
  AssemblyArtifactRepository,
  AssemblyJobRepository,
} from "@ceo-agent/db";
import {
  loadAssemblyRuntimeInput,
  AssemblyRuntimeInputError,
} from "./assembly-runtime-loader";
import type { AssemblyMediaAccessPort } from "./assembly-runtime-media-access";
import {
  AssemblyEngineError,
  cleanupAssemblyWorkDir,
  runDeterministicAssemblyEngine,
} from "./assembly-runtime-engine";
import { AssemblyMediaAccessError } from "./assembly-runtime-media-access";
import { AssemblyMediaProbeError } from "./assembly-runtime-media-probe";
import {
  buildAssemblyFailedFact,
  buildAssemblyProcessingStartedFact,
  buildAssemblySucceededFact,
} from "./assembly-runtime-facts";
import { projectAssemblyRuntime } from "./assembly-runtime-projection";

export type AssemblyRuntimeSources = {
  readonly definition: StoryAssemblyDefinition;
  readonly memberships: readonly AssemblySceneMembership[];
  readonly sceneResults: readonly CanonicalSceneResult[];
};

export type AssemblyArtifactBlobStore = {
  readonly putImmutableArtifact: (input: {
    readonly ownership: AssemblyJob["ownership"];
    readonly assemblyJobId: string;
    readonly artifactId: string;
    readonly localPath: string;
    readonly contentHash: string;
  }) => Promise<{ readonly artifactReference: string }>;
  /**
   * Fail-closed recovery check: artifact metadata must resolve to readable bytes.
   */
  readonly assertReadableArtifact: (input: {
    readonly ownership: AssemblyJob["ownership"];
    readonly artifactReference: string;
    readonly expectedContentHash: string;
  }) => Promise<void>;
};

export class AssemblyRuntimeError extends Error {
  constructor(
    readonly classification: AssemblyRuntimeFailureClassification,
    message: string,
    readonly retryAllowed: boolean
  ) {
    super(message);
    this.name = "AssemblyRuntimeError";
  }
}

export function createLocalAssemblyArtifactBlobStore(
  rootDir: string
): AssemblyArtifactBlobStore {
  return {
    async putImmutableArtifact({ ownership, assemblyJobId, artifactId, localPath }) {
      const artifactReference = `${ownership.workspaceId}/assembly/${assemblyJobId}/${artifactId}.mp4`;
      const target = join(rootDir, artifactReference);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(localPath, target);
      return { artifactReference };
    },
    async assertReadableArtifact({ ownership, artifactReference, expectedContentHash }) {
      if (
        !artifactReference.startsWith(`${ownership.workspaceId}/`) ||
        artifactReference.includes("..")
      ) {
        throw new AssemblyRuntimeError(
          "ASSEMBLY_ARTIFACT_PERSISTENCE_FAILED",
          "Artifact reference fails workspace scope check",
          false
        );
      }
      const target = join(rootDir, artifactReference);
      try {
        await access(target);
      } catch {
        throw new AssemblyRuntimeError(
          "ASSEMBLY_ARTIFACT_PERSISTENCE_FAILED",
          "Assembly artifact bytes are missing for recovery",
          false
        );
      }
      const bytes = await readFile(target);
      const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (contentHash !== expectedContentHash) {
        throw new AssemblyRuntimeError(
          "ASSEMBLY_ARTIFACT_PERSISTENCE_FAILED",
          "Assembly artifact content hash mismatch during recovery",
          false
        );
      }
    },
  };
}

function classifyError(error: unknown): {
  classification: AssemblyRuntimeFailureClassification;
  retryAllowed: boolean;
  message: string;
} {
  if (
    error instanceof AssemblyRuntimeInputError ||
    error instanceof AssemblyEngineError ||
    error instanceof AssemblyMediaAccessError ||
    error instanceof AssemblyMediaProbeError ||
    error instanceof AssemblyRuntimeError
  ) {
    const policy = ASSEMBLY_RUNTIME_FAILURE_POLICIES[error.classification];
    return {
      classification: error.classification,
      retryAllowed: policy.retryAllowed,
      message: policy.safePublicMessage,
    };
  }
  return {
    classification: "ASSEMBLY_INFRASTRUCTURE_TRANSIENT",
    retryAllowed: true,
    message: ASSEMBLY_RUNTIME_FAILURE_POLICIES.ASSEMBLY_INFRASTRUCTURE_TRANSIENT
      .safePublicMessage,
  };
}

function terminalFromFacts(
  job: AssemblyJob,
  facts: readonly AssemblyJobFact[],
  artifact: AssemblyArtifact | null,
  executionIdentity: string
): AssemblyRuntimeResult | null {
  const succeeded = facts.find((fact) => fact.factKind === "SUCCEEDED");
  if (succeeded && succeeded.factKind === "SUCCEEDED") {
    if (!artifact) {
      return null;
    }
    return AssemblyRuntimeResultSchema.parse({
      status: "SUCCEEDED",
      assemblyJobId: job.assemblyJobId,
      executionIdentity,
      artifact,
      completedAt: succeeded.completedAt,
      replayed: true,
      executionAllowed: false,
      executionLockCode: PHASE1_EXECUTION_LOCKED,
    });
  }
  const failed = facts.find((fact) => fact.factKind === "FAILED");
  if (failed && failed.factKind === "FAILED") {
    const match = (
      Object.keys(ASSEMBLY_RUNTIME_FAILURE_POLICIES) as AssemblyRuntimeFailureClassification[]
    ).find(
      (key) =>
        ASSEMBLY_RUNTIME_FAILURE_POLICIES[key].terminalFactClassification ===
        failed.failureClassification
    );
    const classification = match ?? "ASSEMBLY_INFRASTRUCTURE_TERMINAL";
    return AssemblyRuntimeResultSchema.parse({
      status: "FAILED",
      assemblyJobId: job.assemblyJobId,
      executionIdentity,
      classification,
      terminalFactClassification: failed.failureClassification,
      message: failed.message,
      failedAt: failed.failedAt,
      replayed: true,
      executionAllowed: false,
      executionLockCode: PHASE1_EXECUTION_LOCKED,
    });
  }
  return null;
}

export async function runDeterministicAssemblyRuntime(input: {
  readonly assemblyJobId: string;
  readonly sources: AssemblyRuntimeSources;
  readonly jobRepository: AssemblyJobRepository;
  readonly artifactRepository: AssemblyArtifactRepository;
  readonly mediaAccess: AssemblyMediaAccessPort;
  readonly blobStore: AssemblyArtifactBlobStore;
  /** Fault-injection hooks for recovery tests. */
  readonly hooks?: {
    readonly afterProcessingFact?: () => Promise<void>;
    readonly beforeEngineRun?: () => Promise<void>;
    readonly afterMediaOutput?: () => Promise<void>;
    readonly beforeArtifactPersist?: () => Promise<void>;
    readonly afterArtifactPersist?: () => Promise<void>;
    readonly beforeTerminalFact?: () => Promise<void>;
  };
}): Promise<AssemblyRuntimeResult> {
  const job = await input.jobRepository.getByAssemblyJobId(input.assemblyJobId);
  if (!job) {
    throw new AssemblyRuntimeError(
      "ASSEMBLY_INPUT_INCOMPLETE",
      "Assembly Job not found",
      false
    );
  }

  let runtimeInput: AssemblyRuntimeInput;
  try {
    runtimeInput = loadAssemblyRuntimeInput({
      job,
      definition: input.sources.definition,
      memberships: input.sources.memberships,
      sceneResults: input.sources.sceneResults,
    });
  } catch (error) {
    const classified = classifyError(error);
    if (!classified.retryAllowed) {
      return await appendTerminalFailure({
        jobRepository: input.jobRepository,
        job,
        classification: classified.classification,
        executionIdentity: buildAssemblyExecutionIdentity({
          executionPlanId: job.executionPlanId,
          assemblyDefinitionId: job.assemblyDefinitionId,
          assemblyJobId: job.assemblyJobId,
          orderedSceneResultIds: [...job.orderedSceneResultIds],
          orderedSceneContentHashes: [...job.orderedSceneContentHashes],
          assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
          assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
          normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
        }),
      });
    }
    throw new AssemblyRuntimeError(
      classified.classification,
      classified.message,
      classified.retryAllowed
    );
  }

  const executionIdentity = buildAssemblyExecutionIdentity({
    executionPlanId: runtimeInput.executionPlanId,
    assemblyDefinitionId: runtimeInput.assemblyDefinitionId,
    assemblyJobId: runtimeInput.assemblyJobId,
    orderedSceneResultIds: runtimeInput.orderedScenes.map((scene) => scene.sceneResultId),
    orderedSceneContentHashes: runtimeInput.orderedScenes.map((scene) => scene.contentHash),
    assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
    assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
    normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
  });

  const facts = await input.jobRepository.loadAssemblyFacts(job.assemblyJobId);
  const existingArtifact =
    (await input.artifactRepository.getByAssemblyJobId(job.assemblyJobId)) ??
    (await input.artifactRepository.getByExecutionIdentity(executionIdentity));
  const existingTerminal = terminalFromFacts(
    job,
    facts,
    existingArtifact,
    executionIdentity
  );
  if (existingTerminal) return existingTerminal;

  // Recover: artifact stored but terminal fact missing — verify bytes, never re-run FFmpeg.
  if (existingArtifact) {
    await input.blobStore.assertReadableArtifact({
      ownership: job.ownership,
      artifactReference: existingArtifact.artifactReference,
      expectedContentHash: existingArtifact.contentHash,
    });
    return await finalizeSuccess({
      jobRepository: input.jobRepository,
      artifactRepository: input.artifactRepository,
      job,
      artifact: existingArtifact,
      executionIdentity,
      hooks: input.hooks,
      alreadyPersisted: true,
    });
  }

  const lock = await input.jobRepository.acquireTerminalAcceptanceLock(job.assemblyJobId);
  await lock.run(async ({ job: lockedJob, appendFact }) => {
    const lockedFacts = await input.jobRepository.loadAssemblyFacts(lockedJob.assemblyJobId);
    if (lockedFacts.some((fact) => fact.factKind === "SUCCEEDED" || fact.factKind === "FAILED")) {
      return;
    }
    if (!lockedFacts.some((fact) => fact.factKind === "PROCESSING_STARTED")) {
      await appendFact(buildAssemblyProcessingStartedFact(lockedJob));
    }
  });
  await input.hooks?.afterProcessingFact?.();

  let workDir: string | undefined;
  try {
    await input.hooks?.beforeEngineRun?.();
    const engineResult = await runDeterministicAssemblyEngine({
      runtimeInput,
      mediaAccess: input.mediaAccess,
    });
    workDir = engineResult.artifact.workDir;
    await input.hooks?.afterMediaOutput?.();
    await input.hooks?.beforeArtifactPersist?.();

    const { artifactReference } = await input.blobStore.putImmutableArtifact({
      ownership: job.ownership,
      assemblyJobId: job.assemblyJobId,
      artifactId: engineResult.artifact.artifactId,
      localPath: engineResult.artifact.localOutputPath,
      contentHash: engineResult.artifact.contentHash,
    });

    const artifact = AssemblyArtifactSchema.parse({
      artifactId: engineResult.artifact.artifactId,
      assemblyJobId: job.assemblyJobId,
      executionPlanId: job.executionPlanId,
      ownership: job.ownership,
      artifactReference,
      contentHash: engineResult.artifact.contentHash,
      mediaType: "video/mp4",
      durationMs: engineResult.artifact.durationMs,
      width: engineResult.artifact.width,
      height: engineResult.artifact.height,
      frameRate: engineResult.artifact.frameRate,
      byteSize: engineResult.artifact.byteSize,
      assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
      normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
      assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
      integrityHash: engineResult.artifact.integrityHash,
      createdAt: job.acceptedAt,
    });

    const persisted = await input.artifactRepository.persistOrConverge(
      artifact,
      executionIdentity
    );
    await input.hooks?.afterArtifactPersist?.();

    return await finalizeSuccess({
      jobRepository: input.jobRepository,
      artifactRepository: input.artifactRepository,
      job,
      artifact: persisted.artifact,
      executionIdentity,
      hooks: input.hooks,
      alreadyPersisted: true,
    });
  } catch (error) {
    const classified = classifyError(error);
    if (classified.retryAllowed) {
      throw new AssemblyRuntimeError(
        classified.classification,
        classified.message,
        true
      );
    }
    return await appendTerminalFailure({
      jobRepository: input.jobRepository,
      job,
      classification: classified.classification,
      executionIdentity,
    });
  } finally {
    if (workDir) {
      await cleanupAssemblyWorkDir(workDir).catch(() => undefined);
    }
  }
}

async function finalizeSuccess(input: {
  readonly jobRepository: AssemblyJobRepository;
  readonly artifactRepository: AssemblyArtifactRepository;
  readonly job: AssemblyJob;
  readonly artifact: AssemblyArtifact;
  readonly executionIdentity: string;
  readonly hooks?: {
    readonly beforeTerminalFact?: () => Promise<void>;
  };
  readonly alreadyPersisted: boolean;
}): Promise<AssemblyRuntimeResult> {
  void input.alreadyPersisted;

  try {
    await input.hooks?.beforeTerminalFact?.();

    const fact = buildAssemblySucceededFact({
      job: input.job,
      executionIdentity: input.executionIdentity,
      finalMediaContentHash: input.artifact.contentHash,
      assemblyEngineSnapshotHash: input.job.assemblyEngineSnapshotHash,
      completedAt: input.artifact.createdAt,
    });

    const lock = await input.jobRepository.acquireTerminalAcceptanceLock(
      input.job.assemblyJobId
    );
    const appended = await lock.run(async ({ appendFact }) => appendFact(fact));

    return AssemblyRuntimeResultSchema.parse({
      status: "SUCCEEDED",
      assemblyJobId: input.job.assemblyJobId,
      executionIdentity: input.executionIdentity,
      artifact: input.artifact,
      completedAt:
        appended.fact.factKind === "SUCCEEDED" ? appended.fact.completedAt : fact.completedAt,
      replayed: appended.replayed,
      executionAllowed: false,
      executionLockCode: PHASE1_EXECUTION_LOCKED,
    });
  } catch (error) {
    if (error instanceof AssemblyRuntimeError) throw error;
    const classified = classifyError(error);
    throw new AssemblyRuntimeError(
      classified.classification,
      classified.message,
      classified.retryAllowed
    );
  }
}

async function appendTerminalFailure(input: {
  readonly jobRepository: AssemblyJobRepository;
  readonly job: AssemblyJob;
  readonly classification: AssemblyRuntimeFailureClassification;
  readonly executionIdentity: string;
}): Promise<AssemblyRuntimeResult> {
  const policy = ASSEMBLY_RUNTIME_FAILURE_POLICIES[input.classification];
  const fact = buildAssemblyFailedFact({
    job: input.job,
    classification: input.classification,
  });

  const lock = await input.jobRepository.acquireTerminalAcceptanceLock(
    input.job.assemblyJobId
  );
  const appended = await lock.run(async ({ appendFact }) => {
    const existing = await input.jobRepository.loadAssemblyFacts(input.job.assemblyJobId);
    const terminal = existing.find(
      (row) => row.factKind === "SUCCEEDED" || row.factKind === "FAILED"
    );
    if (terminal) {
      return { fact: terminal, replayed: true };
    }
    return appendFact(fact);
  });

  if (appended.fact.factKind === "SUCCEEDED") {
    const artifact = null;
    void artifact;
    throw new AssemblyRuntimeError(
      "ASSEMBLY_IDENTITY_CONFLICT",
      "Terminal success already accepted",
      false
    );
  }

  return AssemblyRuntimeResultSchema.parse({
    status: "FAILED",
    assemblyJobId: input.job.assemblyJobId,
    executionIdentity: input.executionIdentity,
    classification: input.classification,
    terminalFactClassification:
      appended.fact.factKind === "FAILED"
        ? appended.fact.failureClassification
        : policy.terminalFactClassification,
    message:
      appended.fact.factKind === "FAILED" ? appended.fact.message : policy.safePublicMessage,
    failedAt:
      appended.fact.factKind === "FAILED" ? appended.fact.failedAt : input.job.acceptedAt,
    replayed: appended.replayed,
    executionAllowed: false,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
  });
}

export { projectAssemblyRuntime };
