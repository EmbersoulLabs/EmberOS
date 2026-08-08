/**
 * Sprint 3 PR 3.7 Phase C — production AI Story provider worker cycle.
 *
 * Extends the existing Dispatch poll: after Dispatch materialization, run the
 * Scene Worker → Finalization → Assembly → FSR continuation for AI Story jobs.
 *
 * Does not create a second Outbox/Dispatch/Finalizer authority.
 * Legacy story-execution BullMQ job remains locked at processor entry.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AiStoryRuntimeContinuationCoordinator,
  createLocalAssemblyArtifactBlobStore,
  createLocalAssemblyMediaAccessPort,
  type AiStoryContinuationOutcome,
  type CanonicalAdapterRegistry,
  type AssemblyRuntimeSources,
} from "@ceo-agent/agents";
import {
  AssemblyArtifactRepositoryImpl,
  AssemblyJobRepositoryImpl,
  AssemblyValidationRepositoryImpl,
  FinalStoryResultRepositoryImpl,
  ProviderExecutionFinalizationRepository,
  ProviderLedgerRepository,
  ProviderOutboxRepository,
  SceneProjectionRepositoryImpl,
  SceneProviderWorkerRuntimeRepository,
} from "@ceo-agent/db";
import {
  CanonicalSceneResultSchema,
  type AssemblyJob,
} from "@ceo-agent/shared/server";
import { createProductionAiStoryCanonicalAdapterRegistry } from "./ai-story-canonical-adapter-registry";
import { dispatchNextProviderExecution } from "./provider-execution-dispatch-entrypoint";

export type AiStoryProviderWorkerCycleOptions = {
  readonly adapters?: CanonicalAdapterRegistry;
  readonly artifactRoot?: string;
  readonly coordinator?: AiStoryRuntimeContinuationCoordinator;
};

let cachedCoordinator: AiStoryRuntimeContinuationCoordinator | undefined;
let cachedArtifactRoot: string | undefined;

async function resolveArtifactRoot(explicit?: string): Promise<string> {
  if (explicit) {
    await mkdir(explicit, { recursive: true });
    return explicit;
  }
  if (cachedArtifactRoot) return cachedArtifactRoot;
  const root =
    process.env.AI_STORY_ASSEMBLY_ARTIFACT_ROOT?.trim() ||
    join(tmpdir(), "emberos-ai-story-assembly-artifacts");
  await mkdir(root, { recursive: true });
  cachedArtifactRoot = root;
  return root;
}

export async function createProductionAiStoryContinuationCoordinator(
  options: AiStoryProviderWorkerCycleOptions = {}
): Promise<AiStoryRuntimeContinuationCoordinator> {
  const artifactRoot = await resolveArtifactRoot(options.artifactRoot);
  const blobStore = createLocalAssemblyArtifactBlobStore(artifactRoot);
  const mediaAccess = createLocalAssemblyMediaAccessPort();
  const workerRepo = new SceneProviderWorkerRuntimeRepository();
  const projectionRepo = new SceneProjectionRepositoryImpl();
  const validationRepo = new AssemblyValidationRepositoryImpl();
  const jobRepo = new AssemblyJobRepositoryImpl();
  const artifactRepo = new AssemblyArtifactRepositoryImpl();
  const fsrRepo = new FinalStoryResultRepositoryImpl();
  const adapters =
    options.adapters ?? createProductionAiStoryCanonicalAdapterRegistry();

  return new AiStoryRuntimeContinuationCoordinator({
    worker: {
      repository: workerRepo,
      adapters,
    },
    finalization: {
      chain: projectionRepo,
      bridge: {
        ledger: new ProviderLedgerRepository(),
        outbox: {
          findJob: (jobId: string) => new ProviderOutboxRepository().findJob(jobId),
          releaseLease: (input) => new ProviderOutboxRepository().releaseLease(input),
          claimOrRenewForFinalization: async (input) => {
            await new ProviderOutboxRepository().claimOrRenewForFinalization(input);
          },
        },
      },
      productionFinalizer: new ProviderExecutionFinalizationRepository(),
      projection: projectionRepo,
    },
    assemblyValidation: {
      repository: validationRepo,
    },
    jobRepository: jobRepo,
    artifactRepository: artifactRepo,
    mediaAccess,
    blobStore,
    finalStoryResult: {
      finalStoryResultRepository: fsrRepo,
    },
    loadAssemblyRuntimeSources: async ({ executionPlanId, job }) =>
      loadProductionAssemblyRuntimeSources({
        executionPlanId,
        job,
        validationRepo,
      }),
  });
}

async function loadProductionAssemblyRuntimeSources(input: {
  readonly executionPlanId: string;
  readonly job: AssemblyJob;
  readonly validationRepo: AssemblyValidationRepositoryImpl;
}): Promise<AssemblyRuntimeSources> {
  const definition = await input.validationRepo.getAssemblyDefinition(
    input.executionPlanId
  );
  if (!definition) {
    throw new Error("Assembly Definition missing for runtime sources");
  }
  const memberships = await input.validationRepo.listMemberships(
    definition.assemblyDefinitionId
  );
  const sceneResults = await input.validationRepo.listCanonicalSceneResults(
    input.executionPlanId
  );
  return {
    definition,
    memberships,
    sceneResults: sceneResults.map((result) =>
      CanonicalSceneResultSchema.parse(result)
    ),
  };
}

export async function getProductionAiStoryContinuationCoordinator(
  options: AiStoryProviderWorkerCycleOptions = {}
): Promise<AiStoryRuntimeContinuationCoordinator> {
  if (options.coordinator) return options.coordinator;
  if (!cachedCoordinator || options.adapters || options.artifactRoot) {
    cachedCoordinator = await createProductionAiStoryContinuationCoordinator(options);
  }
  return cachedCoordinator;
}

/**
 * One production tick:
 * 1) Materialize next AI-Story-correlated Dispatch from Outbox (selection filter)
 * 2) Continue Scene Worker → Finalization → Assembly → FSR
 *
 * Generic Provider jobs remain PENDING (not DISPATCHED) until a generic executor
 * selects them via ownership=GENERIC_PROVIDER — preventing SKIPPED_NON_SCENE stranding.
 */
export async function runAiStoryProviderWorkerCycle(
  options: AiStoryProviderWorkerCycleOptions = {}
): Promise<{
  readonly dispatchStatus: "NO_JOB" | "DISPATCHED";
  readonly ownership?: "AI_STORY_SCENE" | "GENERIC_PROVIDER" | "MISSING_DISPATCH";
  readonly continuation?: AiStoryContinuationOutcome;
}> {
  const dispatchOutcome = await dispatchNextProviderExecution({
    ownership: "AI_STORY_SCENE",
  });
  if (dispatchOutcome.status !== "DISPATCHED") {
    return { dispatchStatus: "NO_JOB" };
  }

  const workerRepo = new SceneProviderWorkerRuntimeRepository();
  const ownership = await workerRepo.classifyDispatchOwnership(
    dispatchOutcome.dispatch.dispatchId
  );
  if (ownership !== "AI_STORY_SCENE") {
    // Selection filter should prevent this; fail closed rather than strand/skip.
    throw new Error(
      `AI Story poll selected non-scene Dispatch ownership=${ownership} dispatch=${dispatchOutcome.dispatch.dispatchId}`
    );
  }

  const coordinator = await getProductionAiStoryContinuationCoordinator(options);
  const continuation = await coordinator.continueFromDispatch(
    dispatchOutcome.dispatch.dispatchId
  );
  return { dispatchStatus: "DISPATCHED", ownership, continuation };
}
