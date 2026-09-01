/**
 * Sprint 3 PR 3.7 Phase C — production AI Story provider worker cycle.
 *
 * Extends the existing Dispatch poll: after Dispatch materialization, run the
 * Scene Worker → Finalization → Assembly → FSR continuation for AI Story jobs.
 *
 * Sprint 4 Phase A: wires durable scene media ingest, durable assembly media
 * access, durable assembly blob store, and real ffmpeg engine provenance.
 *
 * Does not create a second Outbox/Dispatch/Finalizer authority.
 * Legacy story-execution BullMQ job remains locked at processor entry.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AiStoryRuntimeContinuationCoordinator,
  createDurableAssemblyArtifactBlobStore,
  createDurableAssemblyMediaAccessPort,
  createLocalDurableObjectStore,
  resolveProductionAssemblyEngineSnapshotHash,
  type AiStoryContinuationOutcome,
  type CanonicalAdapterRegistry,
  type AssemblyRuntimeSources,
  type DurableObjectStore,
} from "@ceo-agent/agents";
import {
  AssemblyArtifactRepositoryImpl,
  AssemblyJobRepositoryImpl,
  AssemblyValidationRepositoryImpl,
  DurableSceneMediaAttestationRepositoryImpl,
  FinalStoryResultRepositoryImpl,
  ProviderExecutionFinalizationRepository,
  ExecutionDispatchRepository,
  ProviderLedgerRepository,
  ProviderOutboxRepository,
  SceneProjectionRepositoryImpl,
  SceneProviderWorkerRuntimeRepository,
} from "@ceo-agent/db";
import {
  CanonicalSceneResultSchema,
  type AssemblyJob,
  type DurableSceneMediaAttestation,
} from "@ceo-agent/shared/server";
import { createProductionAiStoryCanonicalAdapterRegistry } from "./ai-story-canonical-adapter-registry";
import {
  createSupabaseDurableObjectStore,
  isSupabaseStorageConfigured,
} from "./ai-story-durable-object-store";
import { dispatchNextProviderExecution } from "./provider-execution-dispatch-entrypoint";
import { AiStoryCertificationCommercialReservationGate } from "./ai-story-certification-commercial-reservation";
import { AiStoryPostGenerationQcRuntimeOrchestrator } from "./ai-story-post-generation-qc-orchestrator";

export type AiStoryProviderWorkerCycleOptions = {
  readonly adapters?: CanonicalAdapterRegistry;
  readonly artifactRoot?: string;
  readonly durableObjectRoot?: string;
  readonly coordinator?: AiStoryRuntimeContinuationCoordinator;
  readonly postGenerationQcOrchestrator?: AiStoryPostGenerationQcRuntimeOrchestrator;
  readonly postGenerationQcRecovery?: { recoverNext(): Promise<unknown> };
  /**
   * Canonical owner for the complete claim -> provider -> finalization cycle.
   * Recovery claims and terminal finalization must use this same identity.
   */
  readonly leaseOwner?: string;
};

const AI_STORY_RUNTIME_LEASE_OWNER = `ai-story-runtime:${process.pid}`;

export function isAiStoryProviderDispatchHeld(
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  return environment.AI_STORY_PROVIDER_DISPATCH_MODE === "certification_no_dispatch";
}

let cachedCoordinator: AiStoryRuntimeContinuationCoordinator | undefined;
let cachedArtifactRoot: string | undefined;
let cachedDurableObjectRoot: string | undefined;
let cachedLeaseOwner: string | undefined;
let cachedPostQcOrchestrator: AiStoryPostGenerationQcRuntimeOrchestrator | undefined;

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

async function resolveLocalDurableObjectRoot(explicit?: string): Promise<string> {
  if (explicit) {
    await mkdir(explicit, { recursive: true });
    return explicit;
  }
  if (cachedDurableObjectRoot) return cachedDurableObjectRoot;
  const root =
    process.env.AI_STORY_DURABLE_OBJECT_ROOT?.trim() ||
    join(tmpdir(), "emberos-ai-story-durable-objects");
  await mkdir(root, { recursive: true });
  cachedDurableObjectRoot = root;
  return root;
}

async function resolveProductionDurableObjectStore(
  options: AiStoryProviderWorkerCycleOptions
): Promise<DurableObjectStore> {
  if (isSupabaseStorageConfigured()) {
    return createSupabaseDurableObjectStore();
  }
  const root = await resolveLocalDurableObjectRoot(options.durableObjectRoot);
  return createLocalDurableObjectStore(root);
}

export async function createProductionAiStoryContinuationCoordinator(
  options: AiStoryProviderWorkerCycleOptions = {}
): Promise<AiStoryRuntimeContinuationCoordinator> {
  await resolveArtifactRoot(options.artifactRoot);
  const durableObjectStore = await resolveProductionDurableObjectStore(options);
  const durableMediaRepository = new DurableSceneMediaAttestationRepositoryImpl();
  const postGenerationQc = options.postGenerationQcOrchestrator ??
    new AiStoryPostGenerationQcRuntimeOrchestrator(undefined, durableObjectStore);
  const blobStore = createDurableAssemblyArtifactBlobStore(durableObjectStore);
  const mediaAccess = createDurableAssemblyMediaAccessPort({
    store: durableObjectStore,
    attestations: durableMediaRepository,
  });
  const workerRepo = new SceneProviderWorkerRuntimeRepository();
  const projectionRepo = new SceneProjectionRepositoryImpl();
  const validationRepo = new AssemblyValidationRepositoryImpl();
  const jobRepo = new AssemblyJobRepositoryImpl();
  const artifactRepo = new AssemblyArtifactRepositoryImpl();
  const fsrRepo = new FinalStoryResultRepositoryImpl();
  const adapters =
    options.adapters ?? createProductionAiStoryCanonicalAdapterRegistry();
  const assemblyEngineSnapshotHash =
    await resolveProductionAssemblyEngineSnapshotHash();

  return new AiStoryRuntimeContinuationCoordinator({
    worker: {
      repository: workerRepo,
      adapters,
      ...(process.env.AI_STORY_PROVIDER_DISPATCH_MODE === "certification_no_dispatch"
        ? {
            beforeCommercialReservation: () => {
              throw new Error("AI_STORY_CERTIFICATION_NO_DISPATCH_HOLD");
            },
          }
        : {}),
      commercialReservation: new AiStoryCertificationCommercialReservationGate(),
      requireCommercialReservation: true,
    },
    finalization: {
      chain: projectionRepo,
      bridge: {
        workerId: options.leaseOwner ?? AI_STORY_RUNTIME_LEASE_OWNER,
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
    assemblyEngineSnapshotHash,
    durableMediaRepository,
    durableObjectStore,
    postGenerationQc,
    requirePostGenerationQc: true,
    requireDurableSceneMedia: true,
    loadAssemblyRuntimeSources: async ({ executionPlanId, job }) =>
      loadProductionAssemblyRuntimeSources({
        executionPlanId,
        job,
        validationRepo,
        durableMediaRepository,
      }),
  });
}

async function loadProductionAssemblyRuntimeSources(input: {
  readonly executionPlanId: string;
  readonly job: AssemblyJob;
  readonly validationRepo: AssemblyValidationRepositoryImpl;
  readonly durableMediaRepository: DurableSceneMediaAttestationRepositoryImpl;
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
  const attestations = await input.durableMediaRepository.listByExecutionPlanId(
    input.executionPlanId
  );
  const bySceneResultId = new Map<string, DurableSceneMediaAttestation>(
    attestations.map((row) => [row.sceneResultId, row] as const)
  );

  return {
    definition,
    memberships,
    sceneResults: sceneResults.map((result) => {
      const parsed = CanonicalSceneResultSchema.parse(result);
      const attestation = bySceneResultId.get(parsed.sceneResultId);
      if (!attestation || !parsed.mediaReference) return parsed;
      return {
        ...parsed,
        mediaReference: {
          ...parsed.mediaReference,
          uri: attestation.durableObjectReference,
          contentHash: attestation.contentHash,
        },
      };
    }),
  };
}

export async function getProductionAiStoryContinuationCoordinator(
  options: AiStoryProviderWorkerCycleOptions = {}
): Promise<AiStoryRuntimeContinuationCoordinator> {
  if (options.coordinator) return options.coordinator;
  const leaseOwner = options.leaseOwner ?? AI_STORY_RUNTIME_LEASE_OWNER;
  if (
    !cachedCoordinator ||
    options.adapters ||
    options.artifactRoot ||
    options.durableObjectRoot ||
    cachedLeaseOwner !== leaseOwner
  ) {
    cachedCoordinator = await createProductionAiStoryContinuationCoordinator({
      ...options,
      leaseOwner,
    });
    cachedLeaseOwner = leaseOwner;
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
  // Durable media may already exist when a prior process crashed before Post-QC.
  // Recovery is non-Provider work and therefore remains safe while the paid
  // dispatch hold is active.
  if (options.postGenerationQcRecovery) {
    await options.postGenerationQcRecovery.recoverNext();
  } else if (!options.coordinator) {
    if (!cachedPostQcOrchestrator) {
      cachedPostQcOrchestrator = new AiStoryPostGenerationQcRuntimeOrchestrator(
        undefined,
        await resolveProductionDurableObjectStore(options)
      );
    }
    await cachedPostQcOrchestrator.recoverNext();
  }
  // The certification hold is a pre-claim boundary. It must prevent both the
  // ordinary selector and the existing-Dispatch recovery selector from taking
  // a lease, so a non-paid recovery certification remains observational.
  if (isAiStoryProviderDispatchHeld()) {
    return { dispatchStatus: "NO_JOB" };
  }
  const leaseOwner = options.leaseOwner ?? AI_STORY_RUNTIME_LEASE_OWNER;
  const recoveryDispatch = await new ExecutionDispatchRepository()
    .claimAuthorizedRecoveryDispatch({
      workerId: leaseOwner,
    });
  const dispatchOutcome = recoveryDispatch
    ? { status: "DISPATCHED" as const, dispatch: recoveryDispatch }
    : await dispatchNextProviderExecution({ ownership: "AI_STORY_SCENE" });
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

  const coordinator = await getProductionAiStoryContinuationCoordinator({
    ...options,
    leaseOwner,
  });
  const continuation = await coordinator.continueFromDispatch(
    dispatchOutcome.dispatch.dispatchId
  );
  return { dispatchStatus: "DISPATCHED", ownership, continuation };
}
