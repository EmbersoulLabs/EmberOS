/**
 * Sprint 3 PR 3.7 Phase C — Postgres full-chain E2E helpers.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Sql } from "postgres";
import {
  AiStoryRuntimeContinuationCoordinator,
  AssemblyMediaAccessError,
  CanonicalAdapterRegistry,
  DeterministicCanonicalTestAdapter,
  createLocalAssemblyArtifactBlobStore,
  resolveWorkspaceScopedObjectKey,
  type DeterministicTestAdapterScenario,
} from "../../packages/agents/src/ai-story/index";
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
import { createExecutionDispatch } from "@ceo-agent/shared";
import type { CanonicalSceneResult } from "@ceo-agent/shared/server";
import { SceneSchedulingCoordinator } from "../../packages/agents/src/ai-story/scene-scheduling-coordinator";
import {
  FixedSeedanceRouter,
  PR32_USER_A,
  prepareAuthorizedSchedulingPlan,
} from "./ai-story-pr32-scheduling";

export function ffmpegAvailable(): boolean {
  try {
    execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"], {
      stdio: "ignore",
      windowsHide: true,
    });
    execFileSync(process.env.FFPROBE_PATH ?? "ffprobe", ["-version"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export async function generateFixtureClip(
  root: string,
  name: string,
  opts: { readonly seconds: number; readonly color: string }
): Promise<{ path: string; hash: string; uri: (workspaceId: string) => string }> {
  await mkdir(root, { recursive: true });
  const path = join(root, name);
  execFileSync(
    process.env.FFMPEG_PATH ?? "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${opts.color}:s=640x360:d=${opts.seconds}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${opts.seconds}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      path,
    ],
    { windowsHide: true }
  );
  const bytes = await readFile(path);
  const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return {
    path,
    hash,
    uri: (workspaceId: string) => `fixture://${workspaceId}/${name}`,
  };
}

export class WorkspaceMediaTestAdapter extends DeterministicCanonicalTestAdapter {
  constructor(
    scenario: DeterministicTestAdapterScenario,
    private readonly media: {
      readonly uri: string;
      readonly contentHash: string;
    },
    options?: { readonly providerId?: string; readonly adapterVersion?: string }
  ) {
    super(scenario, options);
  }

  override async lookup(
    input: Parameters<DeterministicCanonicalTestAdapter["lookup"]>[0]
  ): Promise<Awaited<ReturnType<DeterministicCanonicalTestAdapter["lookup"]>>> {
    const base = await super.lookup(input);
    if (base.canonicalProviderState !== "SUCCEEDED") return base;
    return {
      ...base,
      normalizedResultReference: this.media.uri,
      terminalMedia: {
        mediaType: "video/mp4",
        uriReference: this.media.uri,
        contentHash: this.media.contentHash,
        durationMs: 1000,
        width: 640,
        height: 360,
      },
      normalizedUsageFacts: { durationMs: 1000, units: 1, unitKind: "video" },
      normalizedCostMetadata: { currency: "USD", amount: 0.01, estimated: false },
    };
  }
}

export function createPhaseCAdapterRegistry(
  scenario: DeterministicTestAdapterScenario,
  media: { readonly uri: string; readonly contentHash: string }
): {
  readonly registry: CanonicalAdapterRegistry;
  readonly adapter: WorkspaceMediaTestAdapter;
} {
  const registry = new CanonicalAdapterRegistry();
  const adapter = new WorkspaceMediaTestAdapter(scenario, media, {
    providerId: "seedance",
    adapterVersion: "1.0.0",
  });
  registry.register("seedance", "1.0.0", () => adapter);
  return { registry, adapter };
}

/** Media access keyed by Scene media URI (fixture://workspace/...). */
export function createPhaseCMediaAccessPort(
  pathByUri: ReadonlyMap<string, string>,
  expectedOwnership?: { orgId: string; workspaceId: string }
) {
  return {
    async resolveToLocalPath(input: {
      ownership: { orgId: string; workspaceId: string; [k: string]: unknown };
      scene: {
        sceneOrder: number;
        sceneResultId: string;
        contentHash?: string;
        mediaReference: { uri: string; contentHash: string };
      };
      workDir: string;
    }) {
      const { ownership, scene, workDir } = input;
      if (
        expectedOwnership &&
        (ownership.orgId !== expectedOwnership.orgId ||
          ownership.workspaceId !== expectedOwnership.workspaceId)
      ) {
        throw new AssemblyMediaAccessError(
          "ASSEMBLY_MEDIA_UNAVAILABLE",
          "Cross-workspace media access is denied"
        );
      }
      resolveWorkspaceScopedObjectKey(ownership as never, scene.mediaReference.uri);
      const source = pathByUri.get(scene.mediaReference.uri);
      if (!source) {
        throw new AssemblyMediaAccessError(
          "ASSEMBLY_MEDIA_UNAVAILABLE",
          "Fixture media missing for Scene URI"
        );
      }
      await mkdir(workDir, { recursive: true });
      const target = join(workDir, `scene-${scene.sceneOrder}.mp4`);
      await copyFile(source, target);
      const bytes = await readFile(target);
      const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (scene.contentHash && contentHash !== scene.contentHash) {
        throw new AssemblyMediaAccessError(
          "ASSEMBLY_MEDIA_HASH_MISMATCH",
          "Fixture media content hash mismatch"
        );
      }
      return { localPath: target, contentHash };
    },
  };
}

export async function persistDispatchFromScheduled(
  sql: Sql,
  scheduled: {
    outboxJobId: string;
    providerExecutionId: string;
    envelopeId: string;
    payloadReference: string;
    correlation: {
      correlationId: string;
      ownership: { orgId: string; workspaceId: string };
      scheduledAt: string;
    };
    routingDecision: { capabilityId: string; capabilityVersion: string };
    requestHash: string;
    envelopeHash: string;
  }
) {
  const dispatch = await createExecutionDispatch({
    version: "1",
    dispatchId: `dispatch:${scheduled.outboxJobId}`,
    jobId: scheduled.outboxJobId,
    executionId: scheduled.providerExecutionId,
    envelopeId: scheduled.envelopeId,
    payloadReference: scheduled.payloadReference,
    correlationId: scheduled.correlation.correlationId,
    tenantId: scheduled.correlation.ownership.orgId,
    workspaceId: scheduled.correlation.ownership.workspaceId,
    capabilityId: scheduled.routingDecision.capabilityId,
    capabilityVersion: scheduled.routingDecision.capabilityVersion,
    requestHash: scheduled.requestHash,
    envelopeHash: scheduled.envelopeHash,
    workerHandoff: {
      envelopeId: scheduled.envelopeId,
      payloadReference: scheduled.payloadReference,
      dispatchContractVersion: "1",
    },
    status: "DISPATCHED",
    createdAt: scheduled.correlation.scheduledAt,
  });

  await sql`
    INSERT INTO provider_execution_dispatches (
      dispatch_id, version, job_id, execution_id, envelope_id,
      payload_reference, correlation_id, org_id, workspace_id,
      capability_id, capability_version, request_hash, envelope_hash,
      worker_handoff, dispatch_hash, status, created_at
    ) VALUES (
      ${dispatch.dispatchId},
      ${dispatch.version},
      ${dispatch.jobId},
      ${dispatch.executionId},
      ${dispatch.envelopeId},
      ${dispatch.payloadReference},
      ${dispatch.correlationId},
      ${dispatch.tenantId},
      ${dispatch.workspaceId},
      ${dispatch.capabilityId},
      ${dispatch.capabilityVersion},
      ${dispatch.requestHash},
      ${dispatch.envelopeHash},
      ${sql.json(dispatch.workerHandoff)},
      ${dispatch.dispatchHash},
      ${dispatch.status},
      ${dispatch.createdAt}
    )
    ON CONFLICT (job_id) DO NOTHING
  `;
  const [existing] = await sql<{
    dispatch_id: string;
    dispatch_hash: string;
    execution_id: string;
  }[]>`
    SELECT dispatch_id, dispatch_hash, execution_id
    FROM provider_execution_dispatches
    WHERE job_id = ${dispatch.jobId}
    LIMIT 1
  `;
  if (!existing) {
    throw new Error("Dispatch persistence did not produce an accepted record");
  }
  if (
    existing.dispatch_id !== dispatch.dispatchId ||
    existing.dispatch_hash !== dispatch.dispatchHash ||
    existing.execution_id !== dispatch.executionId
  ) {
    throw new Error(
      "Existing Dispatch conflicts with requested Dispatch identity"
    );
  }
  return dispatch;
}

export type PhaseCCoordinatorInstrumentation = {
  finalizeCalls: number;
  finalizeTerminalFailureCalls: number;
  projectionPersistCalls: number;
  assemblyAcceptCalls: number;
  engineRunCalls: number;
  adapterSubmitCalls: number;
  adapterLookupCalls: number;
};

export async function createPhaseCCoordinator(input: {
  readonly adapters: CanonicalAdapterRegistry;
  readonly artifactRoot: string;
  readonly pathByUri: Map<string, string>;
  readonly expectedOwnership?: { orgId: string; workspaceId: string };
  readonly fsrHooks?: {
    beforePersist?: () => void | Promise<void>;
  };
  readonly failProjectionOnce?: { remaining: number; message?: string };
  readonly failAssemblyAcceptOnce?: { remaining: number; message?: string };
  readonly instrumentation?: PhaseCCoordinatorInstrumentation;
  readonly trackedAdapter?: {
    submitCount: number;
    lookupCount: number;
  };
}) {
  const workerRepo = new SceneProviderWorkerRuntimeRepository();
  const projectionRepo = new SceneProjectionRepositoryImpl();
  const validationRepo = new AssemblyValidationRepositoryImpl();
  const jobRepo = new AssemblyJobRepositoryImpl();
  const artifactRepo = new AssemblyArtifactRepositoryImpl();
  const fsrRepo = new FinalStoryResultRepositoryImpl();
  const mediaAccess = createPhaseCMediaAccessPort(
    input.pathByUri,
    input.expectedOwnership
  );
  const instrumentation = input.instrumentation ?? {
    finalizeCalls: 0,
    finalizeTerminalFailureCalls: 0,
    projectionPersistCalls: 0,
    assemblyAcceptCalls: 0,
    engineRunCalls: 0,
    adapterSubmitCalls: 0,
    adapterLookupCalls: 0,
  };

  const productionFinalizer = new ProviderExecutionFinalizationRepository();
  const wrappedFinalizer = {
    finalize: async (
      ...args: Parameters<ProviderExecutionFinalizationRepository["finalize"]>
    ) => {
      instrumentation.finalizeCalls += 1;
      return productionFinalizer.finalize(...args);
    },
    finalizeTerminalFailure: async (
      ...args: Parameters<
        ProviderExecutionFinalizationRepository["finalizeTerminalFailure"]
      >
    ) => {
      instrumentation.finalizeTerminalFailureCalls += 1;
      return productionFinalizer.finalizeTerminalFailure(...args);
    },
  };

  const projectionPort = {
    acceptOrConvergeProjection: async (
      projInput: Parameters<
        SceneProjectionRepositoryImpl["acceptOrConvergeProjection"]
      >[0]
    ) => {
      instrumentation.projectionPersistCalls += 1;
      if (input.failProjectionOnce && input.failProjectionOnce.remaining > 0) {
        input.failProjectionOnce.remaining -= 1;
        const err = new Error(
          input.failProjectionOnce.message ?? "injected scene projection failure"
        );
        (err as { code?: string }).code = "SCENE_PROJECTION_TRANSACTION_FAILED";
        throw err;
      }
      return projectionRepo.acceptOrConvergeProjection(projInput);
    },
  };

  const wrappedJobRepo = new Proxy(jobRepo, {
    get(target, prop, receiver) {
      if (prop === "acceptOrConverge") {
        return async (
          job: Parameters<AssemblyJobRepositoryImpl["acceptOrConverge"]>[0]
        ) => {
          instrumentation.assemblyAcceptCalls += 1;
          if (
            input.failAssemblyAcceptOnce &&
            input.failAssemblyAcceptOnce.remaining > 0
          ) {
            input.failAssemblyAcceptOnce.remaining -= 1;
            throw new Error(
              input.failAssemblyAcceptOnce.message ??
                "injected assembly accept failure"
            );
          }
          return target.acceptOrConverge(job);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });

  const { runDeterministicAssemblyRuntime } = await import(
    "../../packages/agents/src/ai-story/assembly-runtime-orchestrator"
  );

  return {
    instrumentation,
    coordinator: new AiStoryRuntimeContinuationCoordinator({
      worker: { repository: workerRepo, adapters: input.adapters },
      finalization: {
        chain: projectionRepo,
        bridge: {
          ledger: new ProviderLedgerRepository(),
          outbox: {
            findJob: (jobId: string) => new ProviderOutboxRepository().findJob(jobId),
            releaseLease: (leaseInput) =>
              new ProviderOutboxRepository().releaseLease(leaseInput),
            claimOrRenewForFinalization: async (leaseInput) => {
              await new ProviderOutboxRepository().claimOrRenewForFinalization(
                leaseInput
              );
            },
          },
        },
        productionFinalizer: wrappedFinalizer,
        projection: projectionPort,
      },
      assemblyValidation: { repository: validationRepo },
      jobRepository: wrappedJobRepo,
      artifactRepository: artifactRepo,
      mediaAccess,
      blobStore: createLocalAssemblyArtifactBlobStore(input.artifactRoot),
      finalStoryResult: {
        finalStoryResultRepository: fsrRepo,
        hooks: input.fsrHooks,
      },
      runAssembly: async (runtimeInput) => {
        return runDeterministicAssemblyRuntime({
          ...runtimeInput,
          hooks: {
            beforeEngineRun: () => {
              instrumentation.engineRunCalls += 1;
            },
          },
        });
      },
      loadAssemblyRuntimeSources: async ({ executionPlanId }) => {
        const definition = await validationRepo.getAssemblyDefinition(executionPlanId);
        if (!definition) throw new Error("Assembly Definition missing");
        const memberships = await validationRepo.listMemberships(
          definition.assemblyDefinitionId
        );
        const sceneResults = await validationRepo.listCanonicalSceneResults(
          executionPlanId
        );
        return {
          definition,
          memberships,
          sceneResults: sceneResults as CanonicalSceneResult[],
        };
      },
    }),
    workerRepo,
    validationRepo,
    jobRepo,
    artifactRepo,
    fsrRepo,
    projectionRepo,
  };
}

export async function scheduleAndDispatchScene(input: {
  readonly sql: Sql;
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
  readonly runtimeAuthorizationId: string;
}) {
  const scheduled = await new SceneSchedulingCoordinator({
    router: new FixedSeedanceRouter(),
  }).scheduleAuthorizedScene({
    executionPlanId: input.executionPlanId,
    sceneExecutionId: input.sceneExecutionId,
    runtimeAuthorizationId: input.runtimeAuthorizationId,
    actorUserId: PR32_USER_A,
  });
  const dispatch = await persistDispatchFromScheduled(input.sql, scheduled);
  return { scheduled, dispatch };
}

export async function countRows(
  sql: Sql,
  workspaceId: string,
  orgId: string
): Promise<Record<string, number>> {
  const q = async (query: Promise<unknown>) => {
    const rows = (await query) as Array<{ count: number }>;
    return Number(rows[0]?.count ?? 0);
  };
  return {
    runtimeAuthorization: await q(sql`
      SELECT count(*)::int AS count FROM ai_story_runtime_authorized_facts
      WHERE workspace_id = ${workspaceId}
    `),
    routingDecision: await q(sql`
      SELECT count(*)::int AS count FROM ai_story_scene_routing_decisions
      WHERE workspace_id = ${workspaceId}
    `),
    providerExecution: await q(sql`
      SELECT count(*)::int AS count FROM provider_executions
      WHERE workspace_id = ${workspaceId}
    `),
    envelope: await q(sql`
      SELECT count(*)::int AS count FROM provider_execution_envelopes
      WHERE workspace_id = ${workspaceId}
    `),
    outbox: await q(sql`
      SELECT count(*)::int AS count FROM provider_outbox_jobs
      WHERE execution_id IN (
        SELECT execution_id FROM provider_executions WHERE workspace_id = ${workspaceId}
      )
    `),
    dispatch: await q(sql`
      SELECT count(*)::int AS count FROM provider_execution_dispatches
      WHERE workspace_id = ${workspaceId}
    `),
    workerObservation: await q(sql`
      SELECT count(*)::int AS count FROM ai_story_worker_attempt_observations
      WHERE workspace_id = ${workspaceId}
    `),
    workerEvidence: await q(sql`
      SELECT count(*)::int AS count FROM ai_story_worker_execution_results
      WHERE workspace_id = ${workspaceId}
    `),
    providerAttempt: await q(sql`
      SELECT count(*)::int AS count FROM provider_attempts
      WHERE execution_id IN (
        SELECT execution_id FROM provider_executions WHERE workspace_id = ${workspaceId}
      )
    `),
    usage: await q(sql`
      SELECT count(*)::int AS count FROM provider_attempt_usage
      WHERE attempt_id IN (
        SELECT attempt_id FROM provider_attempts
        WHERE execution_id IN (
          SELECT execution_id FROM provider_executions WHERE workspace_id = ${workspaceId}
        )
      )
    `),
    cost: await q(sql`
      SELECT count(*)::int AS count FROM provider_attempt_costs
      WHERE attempt_id IN (
        SELECT attempt_id FROM provider_attempts
        WHERE execution_id IN (
          SELECT execution_id FROM provider_executions WHERE workspace_id = ${workspaceId}
        )
      )
    `),
    sceneResult: await q(sql`
      SELECT count(*)::int AS count FROM ai_story_scene_results
      WHERE workspace_id = ${workspaceId}
    `),
    assemblyJob: await q(sql`
      SELECT count(*)::int AS count FROM ai_story_assembly_jobs
      WHERE workspace_id = ${workspaceId}
    `),
    assemblyTerminalFact: await q(sql`
      SELECT count(*)::int AS count FROM ai_story_assembly_job_facts
      WHERE org_id = ${orgId} AND fact_kind = 'SUCCEEDED'
    `),
    assemblyArtifact: await q(sql`
      SELECT count(*)::int AS count FROM ai_story_assembly_artifacts
      WHERE workspace_id = ${workspaceId}
    `),
    finalStoryResult: await q(sql`
      SELECT count(*)::int AS count FROM ai_story_final_story_results
      WHERE workspace_id = ${workspaceId}
    `),
  };
}

export { prepareAuthorizedSchedulingPlan };
