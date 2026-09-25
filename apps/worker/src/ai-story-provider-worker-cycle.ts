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
  AiStoryCompiledRequestWorkerRuntime,
  AiStoryExecutionAuthorityError,
  AiStoryRuntimeContinuationCoordinator,
  DurableAiStoryCanonicalExecutionAuthorityRepository,
  createDurableAssemblyArtifactBlobStore,
  createDurableAssemblyMediaAccessPort,
  createLocalDurableObjectStore,
  resolveProductionAssemblyEngineSnapshotHash,
  type AiStoryContinuationOutcome,
  type CanonicalAdapterRegistry,
  type AssemblyRuntimeSources,
  type DurableObjectStore,
  type AiStoryCanonicalExecutionAuthority,
} from "@ceo-agent/agents";
import {
  AiStoryProviderRuntimeRepository,
  AssemblyArtifactRepositoryImpl,
  AssemblyJobRepositoryImpl,
  AssemblyValidationRepositoryImpl,
  DurableSceneMediaAttestationRepositoryImpl,
  FinalStoryResultRepositoryImpl,
  PgEpisodeContinuityRuntimeIntegration,
  ProviderExecutionFinalizationRepository,
  ExecutionDispatchRepository,
  ProviderLedgerRepository,
  ProviderOutboxRepository,
  SceneProjectionRepositoryImpl,
  SceneProviderWorkerRuntimeRepository,
  getDb,
  schema,
} from "@ceo-agent/db";
import {
  CanonicalSceneResultSchema,
  type AssemblyJob,
  type DurableSceneMediaAttestation,
} from "@ceo-agent/shared/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  AiStoryProviderRuntimeJobSchema,
  getAiProviderConfig,
  isAiProviderReady,
} from "@ceo-agent/shared";
import { createProductionAiStoryCanonicalAdapterRegistry } from "./ai-story-canonical-adapter-registry";
import {
  createSupabaseDurableObjectStore,
  isSupabaseStorageConfigured,
} from "./ai-story-durable-object-store";
import { createWorkerProviderAssetAccessResolver } from "./ai-story-provider-asset-access";
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
  readonly assetAwareDispatchAuthorizer?: (
    dispatchId: string
  ) => Promise<"LEGACY" | "AUTHORIZED_PROVIDER_DISPATCH">;
  /**
   * Canonical owner for the complete claim -> provider -> finalization cycle.
   * Recovery claims and terminal finalization must use this same identity.
   */
  readonly leaseOwner?: string;
};

async function loadCurrentAssetAwareAuthorityState(input: {
  readonly authority: AiStoryCanonicalExecutionAuthority;
  readonly request: import("@ceo-agent/shared").AiStoryCompiledProviderRequest;
}) {
  const authority = input.authority;
  const db = getDb();
  const [story] = await db
    .select({ currentVersionId: schema.aiStories.currentVersionId })
    .from(schema.aiStories)
    .where(
      and(
        eq(schema.aiStories.id, authority.storyId),
        eq(schema.aiStories.orgId, authority.orgId),
        eq(schema.aiStories.workspaceId, authority.workspaceId)
      )
    )
    .limit(1);
  const bindingIds = authority.analysisAuthorities.map(
    (item) => item.bindingId
  );
  const bindings = bindingIds.length
    ? await db
        .select({
          bindingId: schema.aiStoryAssetBindings.bindingId,
          assetId: schema.aiStoryAssetBindings.assetId,
          contentHash: schema.assets.contentHash,
          analysisSnapshotId:
            schema.aiStoryAssetBindings.analysisSnapshotId,
          analysisFingerprint:
            schema.assetAnalysisSnapshots.analysisFingerprint,
        })
        .from(schema.aiStoryAssetBindings)
        .innerJoin(
          schema.assets,
          eq(schema.assets.id, schema.aiStoryAssetBindings.assetId)
        )
        .innerJoin(
          schema.assetAnalysisSnapshots,
          eq(
            schema.assetAnalysisSnapshots.snapshotId,
            schema.aiStoryAssetBindings.analysisSnapshotId
          )
        )
        .where(
          and(
            eq(schema.aiStoryAssetBindings.orgId, authority.orgId),
            eq(
              schema.aiStoryAssetBindings.workspaceId,
              authority.workspaceId
            ),
            eq(schema.aiStoryAssetBindings.storyId, authority.storyId),
            eq(
              schema.aiStoryAssetBindings.storyVersionId,
              authority.storyVersionId
            ),
            isNull(schema.assets.deletedAt),
            inArray(schema.aiStoryAssetBindings.bindingId, bindingIds)
          )
        )
    : [];
  const dna = authority.characterAuthority
    ? await new AiStoryProviderRuntimeRepository()
        .getCharacterDnaCompilationAuthority({
          orgId: authority.orgId,
          workspaceId: authority.workspaceId,
          campaignId: input.request.campaignId,
          storyId: authority.storyId,
          storyVersionId: authority.storyVersionId,
        })
    : null;
  const providerConfig = getAiProviderConfig(process.env);
  return {
    storyVersionId: story?.currentVersionId ?? "",
    assets: bindings.map((binding) => ({
      ...binding,
      contentHash: binding.contentHash ?? "",
    })),
    castSnapshotFingerprint: authority.castSnapshotFingerprint,
    characterAuthority: authority.characterAuthority
      ? {
          characterId: dna?.reusableCharacterId ?? "",
          characterVersionId: dna?.reusableCharacterVersionId ?? "",
          characterDnaVersionId: dna?.reusableCharacterVersionId ?? "",
          characterDnaFingerprint: dna?.characterDnaFingerprint ?? "",
        }
      : null,
    providerImplementationId:
      authority.providerCapability.implementationId,
    providerCapabilityVersion:
      authority.providerCapability.capabilityVersion,
    providerAvailable:
      authority.providerCapability.providerId === "seedance"
        ? isAiProviderReady(providerConfig, "seedance")
        : false,
  };
}

/**
 * Production Phase 6 bridge. It reads the authority references carried by the
 * existing outbox envelope and stops at the explicit pre-Provider boundary;
 * SceneProviderWorkerRuntime remains the commercial/transport owner.
 */
export async function authorizeAssetAwareProductionDispatch(
  dispatchId: string,
  dependencies: {
    readonly workerRepository?: Pick<
      SceneProviderWorkerRuntimeRepository,
      "loadValidatedBundleByDispatchId"
    >;
    readonly runtimeRepository?: Pick<
      AiStoryProviderRuntimeRepository,
      | "getExecutionAuthorityRecord"
      | "acceptExecutionAuthorityRecord"
      | "getCompiledRequest"
      | "getAttempt"
      | "claimSubmission"
      | "updateAttempt"
      | "acceptCompiledRequest"
      | "acceptAttempt"
    >;
    readonly loadCurrentExecutionAuthorityState?: typeof loadCurrentAssetAwareAuthorityState;
    readonly resolveHttpsAsset?: (input: {
      readonly assetId: string;
      readonly workspaceId: string;
      readonly storagePath?: string;
    }) => Promise<string>;
  } = {}
): Promise<"LEGACY" | "AUTHORIZED_PROVIDER_DISPATCH"> {
  const workerRepository =
    dependencies.workerRepository ?? new SceneProviderWorkerRuntimeRepository();
  const bundle = await workerRepository.loadValidatedBundleByDispatchId(
    dispatchId
  );
  if (!bundle) throw new Error("AI Story Dispatch authority is missing");
  const trace = bundle.envelope.executionContext.trace ?? {};
  const authorityKeys = [
    "executionAuthorityId",
    "executionAuthorityFingerprint",
    "assetAwareProviderAttemptId",
    "plannerSnapshotId",
    "providerResolutionId",
    "compileIntentId",
  ] as const;
  const present = authorityKeys.filter((key) => Boolean(trace[key]));
  if (present.length === 0) return "LEGACY";
  if (present.length !== authorityKeys.length) {
    throw new AiStoryExecutionAuthorityError(
      "STALE_EXECUTION_AUTHORITY",
      "Queue authority references are incomplete"
    );
  }
  const runtimeRepository =
    dependencies.runtimeRepository ?? new AiStoryProviderRuntimeRepository();
  const record = await runtimeRepository.getExecutionAuthorityRecord({
    providerAttemptId: trace.assetAwareProviderAttemptId!,
    executionAuthorityId: trace.executionAuthorityId!,
  });
  if (!record) {
    throw new AiStoryExecutionAuthorityError(
      "STALE_EXECUTION_AUTHORITY",
      "Durable execution authority was not found"
    );
  }
  const job = AiStoryProviderRuntimeJobSchema.parse(record.job);
  if (
    job.executionAuthorityFingerprint !== trace.executionAuthorityFingerprint ||
    job.plannerSnapshotId !== trace.plannerSnapshotId ||
    job.providerResolutionId !== trace.providerResolutionId ||
    job.compileIntentId !== trace.compileIntentId ||
    job.compiledRequestId !== trace.compiledRequestId ||
    job.requestFingerprint !== trace.compiledRequestFingerprint
  ) {
    throw new AiStoryExecutionAuthorityError(
      "STALE_EXECUTION_AUTHORITY",
      "Queue and durable execution authority differ"
    );
  }
  const request = await runtimeRepository.getCompiledRequest(
    job.compiledRequestId!
  );
  if (!request) {
    throw new AiStoryExecutionAuthorityError(
      "STALE_EXECUTION_AUTHORITY",
      "Compiled request is missing"
    );
  }
  const resolver = createWorkerProviderAssetAccessResolver();
  const runtime = new AiStoryCompiledRequestWorkerRuntime({
    repository: runtimeRepository,
    transport: {
      async submit() {
        throw new Error("Asset-Aware authority bridge cannot submit Provider work");
      },
      async poll() {
        throw new Error("Asset-Aware authority bridge cannot poll Provider work");
      },
    },
    assetAccess: {
      resolveHttpsAsset: dependencies.resolveHttpsAsset ??
        ((asset) => resolver.resolveProviderAccessibleUri({
          ...asset,
          orgId: request.orgId,
          campaignId: request.campaignId,
          ...(request.productMaterialSelection
            ? { productMaterialSelection: request.productMaterialSelection }
            : {}),
        })),
    },
    mediaIngest: {
      async ingest() {
        throw new Error("Asset-Aware authority bridge cannot ingest Provider media");
      },
    },
    executionAuthorityRepository:
      new DurableAiStoryCanonicalExecutionAuthorityRepository(
        runtimeRepository,
        job.providerAttemptId
      ),
    requireAssetAwareExecutionAuthority: true,
    loadCurrentExecutionAuthorityState:
      dependencies.loadCurrentExecutionAuthorityState ??
      loadCurrentAssetAwareAuthorityState,
    authorizedProviderDispatchBoundary: () => "HOLD",
  });
  const result = await runtime.authorizeProviderDispatch(job);
  if (
    result.authorizedProviderDispatchBoundaryReached !== true ||
    result.providerSubmitted !== false ||
    result.providerDispatchCount !== 0
  ) {
    throw new AiStoryExecutionAuthorityError(
      "STALE_EXECUTION_AUTHORITY",
      "Authorized Provider dispatch boundary was bypassed"
    );
  }
  return "AUTHORIZED_PROVIDER_DISPATCH";
}

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
  const episodeContinuity = new PgEpisodeContinuityRuntimeIntegration();
  const adapters =
    options.adapters ?? createProductionAiStoryCanonicalAdapterRegistry();
  const assemblyEngineSnapshotHash =
    await resolveProductionAssemblyEngineSnapshotHash();

  return new AiStoryRuntimeContinuationCoordinator({
    worker: {
      repository: workerRepo,
      adapters,
      workerId: options.leaseOwner ?? AI_STORY_RUNTIME_LEASE_OWNER,
      ...(process.env.AI_STORY_PROVIDER_DISPATCH_MODE === "certification_no_dispatch"
        ? {
            beforeCommercialReservation: () => {
              throw new Error("AI_STORY_CERTIFICATION_NO_DISPATCH_HOLD");
            },
          }
        : {}),
      commercialReservation: new AiStoryCertificationCommercialReservationGate(),
      requireCommercialReservation: true,
      requireProviderAttemptAuthority: true,
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
      materializeEpisodeContinuity: async (result) =>
        episodeContinuity.materializeAfterFinalStoryResult({ result }),
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
  const dispatchRepository = new ExecutionDispatchRepository();
  const postTerminalRetryDispatch = await dispatchRepository
    .claimAuthorizedPostTerminalRetryDispatch({
      workerId: leaseOwner,
    });
  const supersessionSuccessorDispatch = postTerminalRetryDispatch
    ? null
    : await dispatchRepository.claimAuthorizedSupersessionSuccessorDispatch({
        workerId: leaseOwner,
      });
  const recoveryDispatch = postTerminalRetryDispatch || supersessionSuccessorDispatch
    ? null
    : await dispatchRepository.claimAuthorizedRecoveryDispatch({
        workerId: leaseOwner,
      });
  const existingDispatch =
    postTerminalRetryDispatch ?? supersessionSuccessorDispatch ?? recoveryDispatch;
  const dispatchOutcome = existingDispatch
    ? { status: "DISPATCHED" as const, dispatch: existingDispatch }
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

  await (
    options.assetAwareDispatchAuthorizer ??
    authorizeAssetAwareProductionDispatch
  )(dispatchOutcome.dispatch.dispatchId);

  const coordinator = await getProductionAiStoryContinuationCoordinator({
    ...options,
    leaseOwner,
  });
  const continuation = await coordinator.continueFromDispatch(
    dispatchOutcome.dispatch.dispatchId
  );
  return { dispatchStatus: "DISPATCHED", ownership, continuation };
}
