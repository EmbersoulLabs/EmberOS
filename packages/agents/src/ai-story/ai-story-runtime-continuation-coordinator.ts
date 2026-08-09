/**
 * Sprint 3 PR 3.7 Phase C — thin runtime continuation coordinator.
 *
 * Sequences frozen authorities only:
 *   Dispatch → SceneProviderWorkerRuntime → SceneFinalizationCoordinator
 *   → scene-complete derivation → Assembly Job → Assembly Runtime
 *   → FinalStoryResultProjector
 *
 * Does NOT own persistence. Does NOT unlock Execute. Does NOT Export/Publish.
 */
import {
  AssemblyJobSchema,
  buildAssemblyEngineSnapshotContentHash,
  buildAssemblyEngineSnapshotId,
  buildAssemblyJobIdentity,
  type AssemblyJob,
  type AssemblyRuntimeResult,
  type CanonicalSceneResult,
  type RuntimeOwnershipIdentity,
  type SceneProjectionOutcome,
  type StoryAssemblyDefinition,
  type AssemblySceneMembership,
  type WorkerExecutionResult,
} from "@ceo-agent/shared/server";
import type {
  AssemblyArtifactRepository,
  AssemblyJobRepository,
  FinalStoryResultRepository,
} from "@ceo-agent/db";
import {
  classifyWorkerResultForCoordinator,
} from "./provider-worker-result-finalizer-bridge";
import {
  SceneFinalizationCoordinator,
  type SceneFinalizationCoordinatorDependencies,
} from "./scene-finalization-coordinator";
import {
  SceneProviderWorkerRuntime,
  type SceneProviderWorkerRuntimeDependencies,
} from "./scene-provider-worker-runtime";
import {
  validateAssemblyInputs,
  type AssemblyValidatorDependencies,
} from "./assembly-validator";
import {
  runDeterministicAssemblyRuntime,
  type AssemblyArtifactBlobStore,
  type AssemblyRuntimeSources,
} from "./assembly-runtime-orchestrator";
import type { AssemblyMediaAccessPort } from "./assembly-runtime-media-access";
import {
  FinalStoryResultProjector,
  type FinalStoryResultProjectionOutcome,
  type FinalStoryResultProjectorDeps,
} from "./final-story-result-projector";

export type AiStoryContinuationStatus =
  | "SKIPPED_NON_SCENE"
  | "WORKER_REPLAYED"
  | "WORKER_NON_TERMINAL"
  | "RECONCILIATION_REQUIRED"
  | "FINALIZATION_PROJECTED"
  | "FINALIZATION_OUTCOME"
  | "ASSEMBLY_NOT_READY"
  | "ASSEMBLY_TRIGGERED"
  | "ASSEMBLY_REPLAYED"
  | "FSR_PROJECTED"
  | "FSR_REPLAYED"
  | "FSR_FAILED_ASSEMBLY_INTACT";

export type AiStoryContinuationOutcome = {
  readonly status: AiStoryContinuationStatus;
  readonly dispatchId?: string;
  readonly executionPlanId?: string;
  readonly assemblyJobId?: string;
  readonly workerResult?: WorkerExecutionResult;
  readonly projection?: SceneProjectionOutcome;
  readonly assembly?: AssemblyRuntimeResult;
  readonly finalStoryResult?: FinalStoryResultProjectionOutcome;
  readonly adapterInvoked?: boolean;
  readonly message?: string;
};

/** Frozen production Assembly engine snapshot config (identity only). */
export function buildProductionAssemblyEngineSnapshotHash(): string {
  return buildAssemblyEngineSnapshotContentHash({
    engineName: "ember-story-assembly",
    engineContractVersion: "1",
    engineImplementationVersion: "1.0.0",
    binaryName: "ffmpeg",
    binaryVersion: "6.1.1",
    binaryBuildHash:
      "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    operatingEnvironmentContractVersion: "1",
    containerFormat: "mp4",
    videoCodec: "h264",
    videoCodecProfile: "high",
    audioCodec: "aac",
    pixelFormat: "yuv420p",
    frameRatePolicy: "constant-30",
    targetFrameRate: 30,
    timeBasePolicy: "1/15360",
    audioSampleRate: 48000,
    audioChannelPolicy: "stereo",
    streamMappingPolicy: "video-first-audio-second",
    rotationNormalizationPolicy: "apply-and-strip",
    metadataStrippingPolicy: "strip-nonessential",
    timestampNormalizationPolicy: "frozen-constant",
    resolutionNormalizationPolicy: "scale-and-pad",
    aspectRatioNormalizationPolicy: "preserve-with-pad",
    normalizationPolicyVersion: "1",
  });
}

export function deriveSceneCompleteReadiness(input: {
  readonly definition: StoryAssemblyDefinition;
  readonly memberships: readonly AssemblySceneMembership[];
  readonly sceneResults: readonly CanonicalSceneResult[];
}): {
  readonly ready: boolean;
  readonly orderedSceneResultIds: readonly string[];
  readonly orderedSceneContentHashes: readonly string[];
  readonly reason?: string;
} {
  const byExecutionId = new Map(
    input.sceneResults.map((result) => [result.sceneExecutionId, result] as const)
  );
  const ordered = [...input.memberships].sort((a, b) => a.sceneOrder - b.sceneOrder);
  if (ordered.length !== input.definition.orderedSceneExecutionIds.length) {
    return {
      ready: false,
      orderedSceneResultIds: [],
      orderedSceneContentHashes: [],
      reason: "Membership count does not match Assembly Definition",
    };
  }
  const orderedSceneResultIds: string[] = [];
  const orderedSceneContentHashes: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const membership = ordered[i]!;
    if (membership.sceneExecutionId !== input.definition.orderedSceneExecutionIds[i]) {
      return {
        ready: false,
        orderedSceneResultIds: [],
        orderedSceneContentHashes: [],
        reason: "Membership order does not match Assembly Definition",
      };
    }
    const result = byExecutionId.get(membership.sceneExecutionId);
    if (!result) {
      return {
        ready: false,
        orderedSceneResultIds: [],
        orderedSceneContentHashes: [],
        reason: "Required Scene Result missing",
      };
    }
    if (result.status !== "SUCCEEDED" || !result.mediaReference?.contentHash) {
      return {
        ready: false,
        orderedSceneResultIds: [],
        orderedSceneContentHashes: [],
        reason: `Scene Result not SUCCEEDED (${result.status})`,
      };
    }
    orderedSceneResultIds.push(result.sceneResultId);
    orderedSceneContentHashes.push(result.mediaReference.contentHash);
  }
  return { ready: true, orderedSceneResultIds, orderedSceneContentHashes };
}

export function buildDeterministicAssemblyJob(input: {
  readonly ownership: RuntimeOwnershipIdentity;
  readonly assemblyDefinitionId: string;
  readonly runtimeAuthorizationId: string;
  readonly orderedSceneResultIds: readonly string[];
  readonly orderedSceneContentHashes: readonly string[];
  readonly assemblyEngineSnapshotHash?: string;
  readonly acceptedAt?: string;
}): AssemblyJob {
  const assemblyEngineSnapshotHash =
    input.assemblyEngineSnapshotHash ?? buildProductionAssemblyEngineSnapshotHash();
  const identity = buildAssemblyJobIdentity({
    executionPlanId: input.ownership.executionPlanId,
    assemblyDefinitionId: input.assemblyDefinitionId,
    orderedSceneResultIds: [...input.orderedSceneResultIds],
    orderedSceneContentHashes: [...input.orderedSceneContentHashes],
    assemblyContractVersion: "1",
    assemblyEngineSnapshotHash,
  });
  return AssemblyJobSchema.parse({
    assemblyJobId: identity.assemblyJobId,
    executionPlanId: input.ownership.executionPlanId,
    assemblyDefinitionId: input.assemblyDefinitionId,
    runtimeAuthorizationId: input.runtimeAuthorizationId,
    ownership: input.ownership,
    orderedSceneResultIds: [...input.orderedSceneResultIds],
    orderedSceneContentHashes: [...input.orderedSceneContentHashes],
    assemblyContractVersion: "1",
    assemblyEngineSnapshotId: buildAssemblyEngineSnapshotId(assemblyEngineSnapshotHash),
    assemblyEngineSnapshotHash,
    deterministicFingerprint: identity.deterministicFingerprint,
    acceptedAt: input.acceptedAt ?? new Date().toISOString(),
  });
}

export type AiStoryRuntimeContinuationDependencies = {
  readonly worker: SceneProviderWorkerRuntimeDependencies;
  readonly finalization: SceneFinalizationCoordinatorDependencies;
  readonly assemblyValidation: AssemblyValidatorDependencies;
  readonly jobRepository: AssemblyJobRepository;
  readonly artifactRepository: AssemblyArtifactRepository;
  readonly mediaAccess: AssemblyMediaAccessPort;
  readonly blobStore: AssemblyArtifactBlobStore;
  readonly finalStoryResult: {
    readonly finalStoryResultRepository: FinalStoryResultRepository;
    readonly hooks?: FinalStoryResultProjectorDeps["hooks"];
  };
  /** Optional override for tests; defaults to runDeterministicAssemblyRuntime. */
  readonly runAssembly?: typeof runDeterministicAssemblyRuntime;
  readonly loadAssemblyRuntimeSources: (input: {
    readonly executionPlanId: string;
    readonly job: AssemblyJob;
  }) => Promise<AssemblyRuntimeSources>;
};

export class AiStoryRuntimeContinuationCoordinator {
  private readonly workerRuntime: SceneProviderWorkerRuntime;
  private readonly finalizationCoordinator: SceneFinalizationCoordinator;
  private readonly fsrProjector: FinalStoryResultProjector;

  constructor(private readonly deps: AiStoryRuntimeContinuationDependencies) {
    this.workerRuntime = new SceneProviderWorkerRuntime(deps.worker);
    this.finalizationCoordinator = new SceneFinalizationCoordinator(deps.finalization);
    this.fsrProjector = new FinalStoryResultProjector({
      jobRepository: deps.jobRepository,
      artifactRepository: deps.artifactRepository,
      finalStoryResultRepository: deps.finalStoryResult.finalStoryResultRepository,
      artifactBlobStore: deps.blobStore,
      hooks: deps.finalStoryResult.hooks,
    });
  }

  /**
   * Process one Dispatch through Worker → Finalization → Assembly → FSR as applicable.
   */
  async continueFromDispatch(dispatchId: string): Promise<AiStoryContinuationOutcome> {
    const bundle = await this.deps.worker.repository.loadValidatedBundleByDispatchId(
      dispatchId
    );
    if (!bundle) {
      return { status: "SKIPPED_NON_SCENE", dispatchId, message: "Not an AI Story scene Dispatch" };
    }

    const workerOutcome = await this.workerRuntime.processDispatch({ dispatchId });
    const route = classifyWorkerResultForCoordinator(workerOutcome.result);

    if (route === "ACCEPTANCE_UNKNOWN") {
      return {
        status: "RECONCILIATION_REQUIRED",
        dispatchId,
        executionPlanId: bundle.runtimeAuthorization.ownership.executionPlanId,
        workerResult: workerOutcome.result,
        adapterInvoked: workerOutcome.adapterInvoked,
      };
    }

    if (route === "NON_TERMINAL") {
      // Accepted async — poll lookup until terminal / reconciliation / deadline.
      // Required for live Provider acceptance (Seedance/MiniMax) where first lookup
      // is often still PROCESSING. Without this loop, subsequent continueFromDispatch
      // would replay the non-terminal observation and never advance.
      if (workerOutcome.result.providerRequestId) {
        const providerRequestId = workerOutcome.result.providerRequestId;
        const pollMs = Math.max(
          1_000,
          Number(process.env.EMBEROS_AI_STORY_LOOKUP_POLL_MS ?? 3_000) || 3_000
        );
        const deadlineMs = Math.max(
          pollMs,
          Number(process.env.EMBEROS_AI_STORY_LOOKUP_DEADLINE_MS ?? 600_000) || 600_000
        );
        const deadline = Date.now() + deadlineMs;
        let resumed = await this.workerRuntime.processDispatch({
          dispatchId,
          mode: "lookup",
          providerRequestId,
        });
        let resumedRoute = classifyWorkerResultForCoordinator(resumed.result);
        while (resumedRoute === "NON_TERMINAL" && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, pollMs));
          resumed = await this.workerRuntime.processDispatch({
            dispatchId,
            mode: "lookup",
            providerRequestId,
          });
          resumedRoute = classifyWorkerResultForCoordinator(resumed.result);
        }
        if (resumedRoute === "NON_TERMINAL" || resumedRoute === "ACCEPTANCE_UNKNOWN") {
          return {
            status:
              resumedRoute === "ACCEPTANCE_UNKNOWN"
                ? "RECONCILIATION_REQUIRED"
                : "WORKER_NON_TERMINAL",
            dispatchId,
            executionPlanId: bundle.runtimeAuthorization.ownership.executionPlanId,
            workerResult: resumed.result,
            adapterInvoked: resumed.adapterInvoked,
          };
        }
        return this.finalizeAndContinue({
          dispatchId,
          executionPlanId: bundle.runtimeAuthorization.ownership.executionPlanId,
          runtimeAuthorizationId: bundle.runtimeAuthorization.runtimeAuthorizationId,
          ownership: bundle.runtimeAuthorization.ownership,
          workerResult: resumed.result,
          adapterInvoked: resumed.adapterInvoked,
        });
      }
      return {
        status: "WORKER_NON_TERMINAL",
        dispatchId,
        executionPlanId: bundle.runtimeAuthorization.ownership.executionPlanId,
        workerResult: workerOutcome.result,
        adapterInvoked: workerOutcome.adapterInvoked,
      };
    }

    if (route === "TRANSIENT_INFRA_FAILURE") {
      const projection = await this.finalizationCoordinator.finalizeAndProject({
        dispatchId,
        workerResultOverride: workerOutcome.result,
      });
      return {
        status: "FINALIZATION_OUTCOME",
        dispatchId,
        executionPlanId: bundle.runtimeAuthorization.ownership.executionPlanId,
        workerResult: workerOutcome.result,
        projection,
        adapterInvoked: workerOutcome.adapterInvoked,
      };
    }

    return this.finalizeAndContinue({
      dispatchId,
      executionPlanId: bundle.runtimeAuthorization.ownership.executionPlanId,
      runtimeAuthorizationId: bundle.runtimeAuthorization.runtimeAuthorizationId,
      ownership: bundle.runtimeAuthorization.ownership,
      workerResult: workerOutcome.result,
      adapterInvoked: workerOutcome.adapterInvoked,
    });
  }

  async continueAssemblyAndFinalStoryResult(input: {
    readonly executionPlanId: string;
    readonly runtimeAuthorizationId: string;
    readonly ownership: RuntimeOwnershipIdentity;
  }): Promise<AiStoryContinuationOutcome> {
    const validation = await validateAssemblyInputs(this.deps.assemblyValidation, {
      executionPlanId: input.executionPlanId,
      ownership: input.ownership,
    });
    if (!validation.ok || !validation.assemblyDefinitionId) {
      return {
        status: "ASSEMBLY_NOT_READY",
        executionPlanId: input.executionPlanId,
        message: !validation.ok
          ? validation.issues[0]?.message ?? "Assembly validation failed"
          : "Assembly Definition missing",
      };
    }

    const definition =
      await this.deps.assemblyValidation.repository.getAssemblyDefinition(
        input.executionPlanId
      );
    const memberships = definition
      ? await this.deps.assemblyValidation.repository.listMemberships(
          definition.assemblyDefinitionId
        )
      : [];
    const sceneResults =
      await this.deps.assemblyValidation.repository.listCanonicalSceneResults(
        input.executionPlanId
      );
    if (!definition) {
      return {
        status: "ASSEMBLY_NOT_READY",
        executionPlanId: input.executionPlanId,
        message: "Assembly Definition missing",
      };
    }
    const readiness = deriveSceneCompleteReadiness({
      definition,
      memberships,
      sceneResults,
    });
    if (!readiness.ready) {
      return {
        status: "ASSEMBLY_NOT_READY",
        executionPlanId: input.executionPlanId,
        message: readiness.reason,
      };
    }

    const job = buildDeterministicAssemblyJob({
      ownership: input.ownership,
      assemblyDefinitionId: validation.assemblyDefinitionId,
      runtimeAuthorizationId: input.runtimeAuthorizationId,
      orderedSceneResultIds: readiness.orderedSceneResultIds,
      orderedSceneContentHashes: readiness.orderedSceneContentHashes,
    });
    const accepted = await this.deps.jobRepository.acceptOrConverge(job);
    const sources = await this.deps.loadAssemblyRuntimeSources({
      executionPlanId: input.executionPlanId,
      job: accepted.job,
    });
    const runAssembly = this.deps.runAssembly ?? runDeterministicAssemblyRuntime;
    const assembly = await runAssembly({
      assemblyJobId: accepted.job.assemblyJobId,
      sources,
      jobRepository: this.deps.jobRepository,
      artifactRepository: this.deps.artifactRepository,
      mediaAccess: this.deps.mediaAccess,
      blobStore: this.deps.blobStore,
    });

    if (assembly.status !== "SUCCEEDED") {
      return {
        status: accepted.replayed ? "ASSEMBLY_REPLAYED" : "ASSEMBLY_TRIGGERED",
        executionPlanId: input.executionPlanId,
        assemblyJobId: accepted.job.assemblyJobId,
        assembly,
      };
    }

    try {
      const fsr = await this.fsrProjector.projectFromSucceededAssembly({
        executionPlanId: input.executionPlanId,
        assemblyJobId: accepted.job.assemblyJobId,
      });
      return {
        status: fsr.replayed ? "FSR_REPLAYED" : "FSR_PROJECTED",
        executionPlanId: input.executionPlanId,
        assemblyJobId: accepted.job.assemblyJobId,
        assembly,
        finalStoryResult: fsr,
      };
    } catch (error) {
      return {
        status: "FSR_FAILED_ASSEMBLY_INTACT",
        executionPlanId: input.executionPlanId,
        assemblyJobId: accepted.job.assemblyJobId,
        assembly,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async finalizeAndContinue(input: {
    readonly dispatchId: string;
    readonly executionPlanId: string;
    readonly runtimeAuthorizationId: string;
    readonly ownership: RuntimeOwnershipIdentity;
    readonly workerResult: WorkerExecutionResult;
    readonly adapterInvoked: boolean;
  }): Promise<AiStoryContinuationOutcome> {
    const projection = await this.finalizationCoordinator.finalizeAndProject({
      dispatchId: input.dispatchId,
    });

    if (projection.outcome !== "PROJECTED") {
      return {
        status: "FINALIZATION_OUTCOME",
        dispatchId: input.dispatchId,
        executionPlanId: input.executionPlanId,
        workerResult: input.workerResult,
        projection,
        adapterInvoked: input.adapterInvoked,
      };
    }

    if (projection.sceneResult.status !== "SUCCEEDED") {
      return {
        status: "FINALIZATION_PROJECTED",
        dispatchId: input.dispatchId,
        executionPlanId: input.executionPlanId,
        workerResult: input.workerResult,
        projection,
        adapterInvoked: input.adapterInvoked,
        message: "Scene projected non-success; Assembly not triggered",
      };
    }

    const continued = await this.continueAssemblyAndFinalStoryResult({
      executionPlanId: input.executionPlanId,
      runtimeAuthorizationId: input.runtimeAuthorizationId,
      ownership: input.ownership,
    });
    return {
      ...continued,
      dispatchId: input.dispatchId,
      workerResult: input.workerResult,
      projection,
      adapterInvoked: input.adapterInvoked,
    };
  }
}
