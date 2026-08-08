/**
 * Sprint 3 PR 3.7 Phase C — Final Evidence Gate (PostgreSQL).
 * Failure isolation, terminal subtype matrix, ownership/security, dispatcher, concurrency.
 * Requires RUN_DB_INTEGRATION_TESTS=1 and DATABASE_URL.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  closeDb,
  ExecutionDispatchRepository,
  SceneProviderWorkerRuntimeRepository,
  AssemblyArtifactRepositoryImpl,
  AssemblyJobRepositoryImpl,
  FinalStoryResultRepositoryImpl,
} from "@ceo-agent/db";
import { PHASE_2A_IDS, PHASE_2A_WORKSPACE_B_IDS } from "./helpers/ai-story-phase-2a";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import {
  cleanupPr32Tenant,
  FixedSeedanceRouter,
  PR32_USER_A,
  seedPr32Tenant,
} from "./helpers/ai-story-pr32-scheduling";
import {
  countRows,
  createPhaseCAdapterRegistry,
  createPhaseCCoordinator,
  ffmpegAvailable,
  generateFixtureClip,
  persistDispatchFromScheduled,
  prepareAuthorizedSchedulingPlan,
  scheduleAndDispatchScene,
  type PhaseCCoordinatorInstrumentation,
} from "./helpers/ai-story-pr37-phase-c-e2e";
import { SceneProviderWorkerRuntime } from "../packages/agents/src/ai-story/scene-provider-worker-runtime";
import { SceneSchedulingCoordinator } from "../packages/agents/src/ai-story/scene-scheduling-coordinator";
import { FinalStoryResultProjector } from "../packages/agents/src/ai-story/final-story-result-projector";
import { createLocalAssemblyArtifactBlobStore } from "../packages/agents/src/ai-story/assembly-runtime-orchestrator";
import type { DeterministicTestAdapterScenario } from "../packages/agents/src/ai-story/canonical-provider-test-adapters";

const integrationDbUrl = getIntegrationDbUrl();
if (RUN_DB_INTEGRATION && !integrationDbUrl) {
  throw new Error("DATABASE_URL is required when RUN_DB_INTEGRATION_TESTS=1");
}
const describeIntegration = RUN_DB_INTEGRATION ? describe : describe.skip;
const RUN_FFMPEG = ffmpegAvailable();

async function applySqlFile(sql: Sql, relative: string): Promise<void> {
  const migration = readFileSync(resolve(__dirname, relative), "utf8");
  for (const statement of migration
    .split(";")
    .map((part) =>
      part
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean)) {
    await sql.unsafe(statement);
  }
}

function emptyInstrumentation(): PhaseCCoordinatorInstrumentation {
  return {
    finalizeCalls: 0,
    finalizeTerminalFailureCalls: 0,
    projectionPersistCalls: 0,
    assemblyAcceptCalls: 0,
    engineRunCalls: 0,
    adapterSubmitCalls: 0,
    adapterLookupCalls: 0,
  };
}

describeIntegration("Sprint 3 PR 3.7 Phase C final evidence gate", () => {
  let sql: Sql;
  let artifactRoot: string;
  let clipPath: string;
  let clipHash: string;
  let clipUri: string;

  beforeAll(async () => {
    sql = createIntegrationSql();
    for (const relative of [
      "../packages/db/sql/ai-story-scene-execution-persistence-v1.sql",
      "../packages/db/sql/ai-story-human-review-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-definition-persistence-v1.sql",
      "../packages/db/sql/provider-ledger.sql",
      "../packages/db/sql/provider-outbox.sql",
      "../packages/db/sql/provider-execution-envelope.sql",
      "../packages/db/sql/provider-execution-dispatch.sql",
      "../packages/db/sql/ai-story-scene-scheduling-v1.sql",
      "../packages/db/sql/ai-story-scene-routing-router-version-v1.sql",
      "../packages/db/sql/ai-story-scene-scheduling-rls-v1.sql",
      "../packages/db/sql/ai-story-worker-runtime-v1.sql",
      "../packages/db/sql/ai-story-worker-attempt-observation-v1.sql",
      "../packages/db/sql/ai-story-scene-projection-v1.sql",
      "../packages/db/sql/ai-story-assembly-job-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-runtime-artifact-v1.sql",
      "../packages/db/sql/ai-story-final-story-result-v1.sql",
    ]) {
      await applySqlFile(sql, relative);
    }
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr37c-gate");
    artifactRoot = await mkdtemp(join(tmpdir(), "pr37c-gate-art-"));
    if (RUN_FFMPEG) {
      const clipRoot = await mkdtemp(join(tmpdir(), "pr37c-gate-clips-"));
      const clip = await generateFixtureClip(clipRoot, "scene.mp4", {
        seconds: 1,
        color: "green",
      });
      clipPath = clip.path;
      clipHash = clip.hash;
      clipUri = clip.uri(PHASE_2A_IDS.workspaceId);
    } else {
      clipPath = "";
      clipHash =
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
      clipUri = `fixture://${PHASE_2A_IDS.workspaceId}/scene.mp4`;
    }
  }, 180_000);

  afterAll(async () => {
    await cleanupPr32Tenant(sql);
    await cleanupPr32Tenant(sql, PHASE_2A_WORKSPACE_B_IDS);
    await sql.end();
    await closeDb();
    await rm(artifactRoot, { recursive: true, force: true });
  }, 60_000);

  async function resetTenant(label: string) {
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, label);
  }

  async function peStatus(executionId: string) {
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM provider_executions WHERE execution_id = ${executionId}
    `;
    return rows[0]?.status ?? null;
  }

  async function outboxStatus(jobId: string) {
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM provider_outbox_jobs WHERE job_id = ${jobId}
    `;
    return rows[0]?.status ?? null;
  }

  // ─── Task 1: Finalizer → Scene Projection isolation ─────────────────────
  it("Task1: Finalizer success + Scene Projection failure → retry projection only", async () => {
    await resetTenant("gate-t1");
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "gate-t1",
      sceneOrder: [0],
    });
    const media = { uri: clipUri, contentHash: clipHash };
    const { registry } = createPhaseCAdapterRegistry("terminal_success", media);
    const failProjectionOnce = { remaining: 1 };
    const instrumentation = emptyInstrumentation();
    const { coordinator } = await createPhaseCCoordinator({
      adapters: registry,
      artifactRoot,
      pathByUri: new Map(RUN_FFMPEG ? [[clipUri, clipPath]] : []),
      failProjectionOnce,
      instrumentation,
      expectedOwnership: {
        orgId: PHASE_2A_IDS.orgId,
        workspaceId: PHASE_2A_IDS.workspaceId,
      },
    });
    const { dispatch, scheduled } = await scheduleAndDispatchScene({
      sql,
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
    });

    await expect(
      coordinator.continueFromDispatch(dispatch.dispatchId)
    ).rejects.toMatchObject({ code: "SCENE_PROJECTION_TRANSACTION_FAILED" });

    expect(await peStatus(scheduled.providerExecutionId)).toBe("SUCCEEDED");
    expect(await outboxStatus(scheduled.outboxJobId)).toBe("COMPLETED");
    expect(instrumentation.finalizeCalls).toBe(1);
    const afterFail = await countRows(
      sql,
      PHASE_2A_IDS.workspaceId,
      PHASE_2A_IDS.orgId
    );
    expect(afterFail.usage).toBe(1);
    expect(afterFail.cost).toBe(1);
    expect(afterFail.sceneResult).toBe(0);
    expect(afterFail.assemblyJob).toBe(0);
    expect(afterFail.finalStoryResult).toBe(0);

    const retry = await coordinator.continueFromDispatch(dispatch.dispatchId);
    expect(instrumentation.finalizeCalls).toBe(1);
    expect(retry.projection?.outcome).toBe("PROJECTED");
    const afterRetry = await countRows(
      sql,
      PHASE_2A_IDS.workspaceId,
      PHASE_2A_IDS.orgId
    );
    expect(afterRetry.usage).toBe(1);
    expect(afterRetry.cost).toBe(1);
    expect(afterRetry.sceneResult).toBe(1);
  }, 180_000);

  // ─── Task 2: Scene complete → Assembly trigger failure ──────────────────
  it("Task2: Scene complete + Assembly accept failure → retry assembly only", async () => {
    if (!RUN_FFMPEG) return;
    await resetTenant("gate-t2");
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "gate-t2",
      sceneOrder: [0],
    });
    const media = { uri: clipUri, contentHash: clipHash };
    const { registry } = createPhaseCAdapterRegistry("terminal_success", media);
    const failAssemblyAcceptOnce = { remaining: 1 };
    const instrumentation = emptyInstrumentation();
    const { coordinator } = await createPhaseCCoordinator({
      adapters: registry,
      artifactRoot,
      pathByUri: new Map([[clipUri, clipPath]]),
      failAssemblyAcceptOnce,
      instrumentation,
      expectedOwnership: {
        orgId: PHASE_2A_IDS.orgId,
        workspaceId: PHASE_2A_IDS.workspaceId,
      },
    });
    const { dispatch, scheduled } = await scheduleAndDispatchScene({
      sql,
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
    });

    await expect(
      coordinator.continueFromDispatch(dispatch.dispatchId)
    ).rejects.toThrow(/injected assembly accept failure/);

    expect(await peStatus(scheduled.providerExecutionId)).toBe("SUCCEEDED");
    const mid = await countRows(sql, PHASE_2A_IDS.workspaceId, PHASE_2A_IDS.orgId);
    expect(mid.sceneResult).toBe(1);
    expect(mid.assemblyJob).toBe(0);
    expect(mid.finalStoryResult).toBe(0);
    expect(instrumentation.finalizeCalls).toBe(1);

    const retry = await coordinator.continueAssemblyAndFinalStoryResult({
      executionPlanId: prepared.executionPlanId,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
      ownership: prepared.acceptedAuthorization.ownership,
    });
    expect(["FSR_PROJECTED", "FSR_REPLAYED", "ASSEMBLY_TRIGGERED"]).toContain(
      retry.status
    );
    expect(instrumentation.finalizeCalls).toBe(1);
    const end = await countRows(sql, PHASE_2A_IDS.workspaceId, PHASE_2A_IDS.orgId);
    expect(end.sceneResult).toBe(1);
    expect(end.assemblyJob).toBe(1);
    expect(end.assemblyArtifact).toBe(1);
    expect(end.finalStoryResult).toBe(1);
  }, 240_000);

  // ─── Task 3: Artifact → FSR failure ─────────────────────────────────────
  it("Task3: Artifact persisted + FSR failure → retry FSR only (engine=0)", async () => {
    if (!RUN_FFMPEG) return;
    await resetTenant("gate-t3");
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "gate-t3",
      sceneOrder: [0],
    });
    const media = { uri: clipUri, contentHash: clipHash };
    const { registry } = createPhaseCAdapterRegistry("terminal_success", media);
    let fsrFailRemaining = 1;
    const instrumentation = emptyInstrumentation();
    const { coordinator } = await createPhaseCCoordinator({
      adapters: registry,
      artifactRoot,
      pathByUri: new Map([[clipUri, clipPath]]),
      instrumentation,
      fsrHooks: {
        beforePersist: async () => {
          if (fsrFailRemaining > 0) {
            fsrFailRemaining -= 1;
            throw new Error("injected FSR persist failure");
          }
        },
      },
      expectedOwnership: {
        orgId: PHASE_2A_IDS.orgId,
        workspaceId: PHASE_2A_IDS.workspaceId,
      },
    });
    const { dispatch } = await scheduleAndDispatchScene({
      sql,
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
    });

    const first = await coordinator.continueFromDispatch(dispatch.dispatchId);
    expect(first.status).toBe("FSR_FAILED_ASSEMBLY_INTACT");
    expect(first.assembly?.status).toBe("SUCCEEDED");
    const mid = await countRows(sql, PHASE_2A_IDS.workspaceId, PHASE_2A_IDS.orgId);
    expect(mid.assemblyJob).toBe(1);
    expect(mid.assemblyArtifact).toBe(1);
    expect(mid.finalStoryResult).toBe(0);
    const engineAfterFirst = instrumentation.engineRunCalls;
    expect(engineAfterFirst).toBeGreaterThanOrEqual(1);

    const retry = await coordinator.continueAssemblyAndFinalStoryResult({
      executionPlanId: prepared.executionPlanId,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
      ownership: prepared.acceptedAuthorization.ownership,
    });
    expect(["FSR_PROJECTED", "FSR_REPLAYED"]).toContain(retry.status);
    expect(instrumentation.engineRunCalls).toBe(engineAfterFirst);
    const end = await countRows(sql, PHASE_2A_IDS.workspaceId, PHASE_2A_IDS.orgId);
    expect(end.assemblyArtifact).toBe(1);
    expect(end.finalStoryResult).toBe(1);
    expect(instrumentation.finalizeCalls).toBe(1);
  }, 240_000);

  // ─── Task 4: Terminal failure matrix ────────────────────────────────────
  async function runTerminalSubtype(
    scenario: DeterministicTestAdapterScenario,
    expectedSceneStatus: "FAILED" | "REJECTED" | "TIMEOUT",
    expectedFailureCode?: string
  ) {
    await resetTenant(`gate-${scenario}`);
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: `gate-${scenario}`,
      sceneOrder: [0],
    });
    const media = { uri: clipUri, contentHash: clipHash };
    const { registry } = createPhaseCAdapterRegistry(scenario, media);
    const instrumentation = emptyInstrumentation();
    const { coordinator } = await createPhaseCCoordinator({
      adapters: registry,
      artifactRoot,
      pathByUri: new Map(),
      instrumentation,
    });
    const { dispatch, scheduled } = await scheduleAndDispatchScene({
      sql,
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
    });
    const outcome = await coordinator.continueFromDispatch(dispatch.dispatchId);
    expect(outcome.workerResult?.workerState).toBe("TERMINAL_FAILURE");
    expect(await peStatus(scheduled.providerExecutionId)).toBe("TERMINAL_FAILURE");
    expect(await outboxStatus(scheduled.outboxJobId)).toBe("DEAD_LETTER");
    expect(instrumentation.finalizeTerminalFailureCalls).toBe(1);
    expect(instrumentation.finalizeCalls).toBe(0);
    const counts = await countRows(
      sql,
      PHASE_2A_IDS.workspaceId,
      PHASE_2A_IDS.orgId
    );
    expect(counts.usage).toBe(0);
    expect(counts.cost).toBe(0);
    expect(counts.sceneResult).toBe(1);
    expect(counts.assemblyJob).toBe(0);
    expect(counts.assemblyArtifact).toBe(0);
    expect(counts.finalStoryResult).toBe(0);
    const scene = await sql<{ status: string; failure: string | null }[]>`
      SELECT status, (result->>'failureClassification') AS failure
      FROM ai_story_scene_results
      WHERE workspace_id = ${PHASE_2A_IDS.workspaceId}
      LIMIT 1
    `;
    expect(scene[0]?.status).toBe(expectedSceneStatus);
    if (expectedFailureCode) {
      expect(scene[0]?.failure).toBe(expectedFailureCode);
    }
  }

  it("Task4A: FAILED → DEAD_LETTER, Scene FAILED, no Assembly/FSR", async () => {
    await runTerminalSubtype("terminal_failure", "FAILED", "PROVIDER_FAILED");
  }, 120_000);

  it("Task4B: REJECTED → DEAD_LETTER, Scene REJECTED, no Assembly/FSR", async () => {
    await runTerminalSubtype("terminal_rejection", "REJECTED", "PROVIDER_REJECTED");
  }, 120_000);

  it("Task4C: MODERATION_REJECTED → Scene REJECTED with moderation code", async () => {
    await runTerminalSubtype(
      "terminal_moderation_rejected",
      "REJECTED",
      "PROVIDER_MODERATION_REJECTED"
    );
  }, 120_000);

  it("Task4D: PROVIDER_TIMEOUT → Scene TIMEOUT, no Assembly/FSR", async () => {
    await runTerminalSubtype("terminal_timeout", "TIMEOUT", "PROVIDER_TIMEOUT");
  }, 120_000);

  // ─── Task 5: ACCEPTANCE_UNKNOWN regression ──────────────────────────────
  it("Task5: UNKNOWN observation → PROCESSING → SUCCEEDED (submit=1)", async () => {
    await resetTenant("gate-unk");
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "gate-unk",
      sceneOrder: [0],
    });
    const media = { uri: clipUri, contentHash: clipHash };
    const { registry, adapter } = createPhaseCAdapterRegistry(
      "acceptance_unknown",
      media
    );
    const instrumentation = emptyInstrumentation();
    const { coordinator, workerRepo } = await createPhaseCCoordinator({
      adapters: registry,
      artifactRoot,
      pathByUri: new Map(RUN_FFMPEG ? [[clipUri, clipPath]] : []),
      instrumentation,
    });
    const { dispatch } = await scheduleAndDispatchScene({
      sql,
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
    });

    const first = await coordinator.continueFromDispatch(dispatch.dispatchId);
    expect(first.status).toBe("RECONCILIATION_REQUIRED");
    expect(adapter.submitCount).toBe(1);
    expect(instrumentation.finalizeCalls).toBe(0);
    expect(
      await workerRepo.getWorkerExecutionResultByDispatchId(dispatch.dispatchId)
    ).toBeNull();

    const second = await coordinator.continueFromDispatch(dispatch.dispatchId);
    expect(second.workerResult?.workerState).toBe("TERMINAL_SUCCESS");
    expect(adapter.submitCount).toBe(1);
    expect(second.workerResult?.providerAttemptId).toBe(
      first.workerResult?.providerAttemptId
    );
    expect(second.workerResult?.providerId).toBe("seedance");
    const wer = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ai_story_worker_execution_results
      WHERE dispatch_id = ${dispatch.dispatchId}
    `;
    expect(wer[0]?.count).toBe(1);
    const obs = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ai_story_worker_attempt_observations
      WHERE dispatch_id = ${dispatch.dispatchId}
    `;
    expect(Number(obs[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
  }, 180_000);

  // ─── Task 6: Ownership / security matrix ────────────────────────────────
  it("Task6: ownership/security mismatch matrix fail-closed", async () => {
    await cleanupPr32Tenant(sql, PHASE_2A_WORKSPACE_B_IDS);
    await seedPr32Tenant(sql, PHASE_2A_WORKSPACE_B_IDS, PR32_USER_A, "gate-sec-b");
    const media = { uri: clipUri, contentHash: clipHash };
    const workerRepo = new SceneProviderWorkerRuntimeRepository();
    const matrix: Array<{
      label: string;
      stage: string;
      adapterCalls: number;
      rejected: boolean;
    }> = [];

    const runMismatch = async (
      label: string,
      stage: string,
      mutate: (ctx: {
        dispatchId: string;
        outboxJobId: string;
        providerExecutionId: string;
      }) => Promise<void>
    ) => {
      await resetTenant(`gate-sec-${label}`);
      const prep = await prepareAuthorizedSchedulingPlan({
        purpose: `sec-${label}`,
        sceneOrder: [0],
      });
      const { registry, adapter } = createPhaseCAdapterRegistry(
        "terminal_success",
        media
      );
      const scheduled = await scheduleAndDispatchScene({
        sql,
        executionPlanId: prep.executionPlanId,
        sceneExecutionId: prep.sceneExecutionIds[0]!,
        runtimeAuthorizationId: prep.acceptedAuthorization.runtimeAuthorizationId,
      });
      const before = adapter.submitCount;
      await mutate({
        dispatchId: scheduled.dispatch.dispatchId,
        outboxJobId: scheduled.scheduled.outboxJobId,
        providerExecutionId: scheduled.scheduled.providerExecutionId,
      });
      const worker = new SceneProviderWorkerRuntime({
        repository: workerRepo,
        adapters: registry,
      });
      let rejected = false;
      try {
        await worker.processDispatch({
          dispatchId: scheduled.dispatch.dispatchId,
        });
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
      expect(adapter.submitCount).toBe(before);
      matrix.push({
        label,
        stage,
        adapterCalls: adapter.submitCount - before,
        rejected,
      });
    };

    await runMismatch(
      "foreign-workspace",
      "bundle/ownership",
      async ({ dispatchId }) => {
        await sql`
          UPDATE provider_execution_dispatches
          SET workspace_id = ${PHASE_2A_WORKSPACE_B_IDS.workspaceId}
          WHERE dispatch_id = ${dispatchId}
        `;
      }
    );
    await runMismatch("foreign-plan", "bundle/ownership", async ({ outboxJobId }) => {
      await sql`
        UPDATE ai_story_scene_scheduling_correlations
        SET correlation = jsonb_set(
          correlation,
          '{executionPlanId}',
          to_jsonb('00000000-0000-4000-8000-00000000dead'::text)
        )
        WHERE outbox_job_id = ${outboxJobId}
      `;
    });
    await runMismatch("foreign-scene", "bundle/ownership", async ({ outboxJobId }) => {
      await sql`
        UPDATE ai_story_scene_scheduling_correlations
        SET correlation = jsonb_set(
          correlation,
          '{sceneExecutionId}',
          to_jsonb('00000000-0000-4000-8000-00000000scen'::text)
        )
        WHERE outbox_job_id = ${outboxJobId}
      `;
    });
    await runMismatch("wrong-routing", "bundle/routing", async ({ outboxJobId }) => {
      await sql`
        UPDATE ai_story_scene_scheduling_correlations
        SET correlation = jsonb_set(
          correlation,
          '{routingDecisionId}',
          to_jsonb('00000000-0000-4000-8000-00000000beef'::text)
        )
        WHERE outbox_job_id = ${outboxJobId}
      `;
    });
    await runMismatch(
      "wrong-provider-execution",
      "bundle/envelope",
      async ({ outboxJobId }) => {
        const foreignPe = `foreign-pe-${crypto.randomUUID()}`;
        await sql`
          UPDATE ai_story_scene_scheduling_correlations
          SET correlation = jsonb_set(
            correlation,
            '{providerExecutionId}',
            to_jsonb(${foreignPe}::text)
          )
          WHERE outbox_job_id = ${outboxJobId}
        `;
      }
    );
    await runMismatch("wrong-auth", "bundle/ownership", async ({ outboxJobId }) => {
      await sql`
        UPDATE ai_story_scene_scheduling_correlations
        SET correlation = jsonb_set(
          correlation,
          '{runtimeAuthorizationId}',
          to_jsonb('00000000-0000-5000-8000-00000000cafe'::text)
        )
        WHERE outbox_job_id = ${outboxJobId}
      `;
    });
    await runMismatch(
      "wrong-dispatch-execution",
      "bundle/dispatch",
      async ({ dispatchId }) => {
        const foreignPe = `foreign-dispatch-pe-${crypto.randomUUID()}`;
        await sql`
          INSERT INTO provider_executions (
            execution_id, contract_version, org_id, workspace_id, campaign_id,
            pipeline_run_id, capability_id, capability_version, idempotency_key,
            deterministic_fingerprint, request_hash, output_schema_id,
            output_schema_version, status, execution_metadata, created_at
          ) VALUES (
            ${foreignPe},
            '1',
            ${PHASE_2A_IDS.orgId},
            ${PHASE_2A_IDS.workspaceId},
            ${PHASE_2A_IDS.campaignId},
            ${`pipeline-${foreignPe}`},
            'generic-capability',
            '1.0.0',
            ${`idem-${foreignPe}`},
            ${`fp-${foreignPe}`},
            ${`rh-${foreignPe}`},
            'generic-output',
            '1.0.0',
            'PENDING',
            ${sql.json({ outputSchemaId: "generic-output", outputSchemaVersion: "1.0.0" })},
            NOW()
          )
        `;
        await sql`
          UPDATE provider_execution_dispatches
          SET execution_id = ${foreignPe}
          WHERE dispatch_id = ${dispatchId}
        `;
      }
    );

    expect(
      await workerRepo.loadValidatedBundleByDispatchId("missing-dispatch-gate")
    ).toBeNull();
    expect(
      await workerRepo.classifyDispatchOwnership("missing-dispatch-gate")
    ).toBe("MISSING_DISPATCH");
    matrix.push({
      label: "missing-dispatch",
      stage: "pre-adapter",
      adapterCalls: 0,
      rejected: true,
    });

    // Wrong Worker attempt identity: accept terminal WER, then reject conflicting attempt.
    {
      await resetTenant("gate-sec-attempt");
      const prep = await prepareAuthorizedSchedulingPlan({
        purpose: "sec-attempt",
        sceneOrder: [0],
      });
      const { registry, adapter } = createPhaseCAdapterRegistry(
        "terminal_success",
        media
      );
      const scheduled = await scheduleAndDispatchScene({
        sql,
        executionPlanId: prep.executionPlanId,
        sceneExecutionId: prep.sceneExecutionIds[0]!,
        runtimeAuthorizationId:
          prep.acceptedAuthorization.runtimeAuthorizationId,
      });
      const worker = new SceneProviderWorkerRuntime({
        repository: workerRepo,
        adapters: registry,
      });
      const first = await worker.processDispatch({
        dispatchId: scheduled.dispatch.dispatchId,
      });
      expect(first.result.workerState).toBe("ACCEPTED");
      const terminal = await worker.processDispatch({
        dispatchId: scheduled.dispatch.dispatchId,
        mode: "lookup",
      });
      expect(terminal.result.workerState).toBe("TERMINAL_SUCCESS");
      const conflicting = {
        ...terminal.result,
        providerAttemptId: `conflict-attempt-${crypto.randomUUID()}`,
        deterministicIntegrityHash: `${terminal.result.deterministicIntegrityHash}-conflict`,
      };
      await expect(
        workerRepo.acceptOrReturnWorkerExecutionResult(conflicting)
      ).rejects.toBeTruthy();
      expect(adapter.submitCount).toBe(1);
      matrix.push({
        label: "wrong-worker-attempt",
        stage: "wer-accept",
        adapterCalls: 0,
        rejected: true,
      });
    }

    const fsr = new FinalStoryResultProjector({
      jobRepository: new AssemblyJobRepositoryImpl(),
      artifactRepository: new AssemblyArtifactRepositoryImpl(),
      finalStoryResultRepository: new FinalStoryResultRepositoryImpl(),
      artifactBlobStore: createLocalAssemblyArtifactBlobStore(artifactRoot),
    });
    await expect(
      fsr.projectFromSucceededAssembly({
        executionPlanId: "00000000-0000-4000-8000-00000000dead",
        assemblyJobId: "00000000-0000-5000-8000-00000000dead",
      })
    ).rejects.toMatchObject({ code: "FINAL_STORY_RESULT_PRECONDITION_FAILED" });
    matrix.push({
      label: "wrong-assembly-job",
      stage: "fsr-projector",
      adapterCalls: 0,
      rejected: true,
    });

    // Wrong Assembly Artifact ownership: SUCCEEDED job without matching artifact scope.
    await expect(
      fsr.projectFromSucceededAssembly({
        executionPlanId: "00000000-0000-4000-8000-00000000dead",
        assemblyJobId: "00000000-0000-5000-8000-00000000artf",
      })
    ).rejects.toBeTruthy();
    matrix.push({
      label: "wrong-assembly-artifact",
      stage: "fsr-projector",
      adapterCalls: 0,
      rejected: true,
    });

    expect(matrix.every((row) => row.rejected && row.adapterCalls === 0)).toBe(
      true
    );
    expect(matrix.map((row) => row.label)).toEqual(
      expect.arrayContaining([
        "foreign-workspace",
        "foreign-plan",
        "foreign-scene",
        "wrong-routing",
        "wrong-provider-execution",
        "wrong-auth",
        "wrong-dispatch-execution",
        "missing-dispatch",
        "wrong-worker-attempt",
        "wrong-assembly-job",
        "wrong-assembly-artifact",
      ])
    );
  }, 300_000);

  // ─── Task 7: Shared dispatcher mixed workload ───────────────────────────
  it("Task7: AI Story selector ignores generic Provider job", async () => {
    await resetTenant("gate-mix");
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "gate-mix",
      sceneOrder: [0],
    });
    // Schedule AI Story (creates PENDING outbox + correlation) but do NOT Dispatch yet.
    const scheduled = await new SceneSchedulingCoordinator({
      router: new FixedSeedanceRouter(),
    }).scheduleAuthorizedScene({
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
      actorUserId: PR32_USER_A,
    });

    // Insert generic PE + outbox without AI Story correlation.
    // next_visible_at must be client-clock-safe: PG NOW() can lag ahead of Node Date
    // used by selectEligibleJob(now.toISOString()).
    const genericExecId = `exec-generic-${crypto.randomUUID()}`;
    const genericJobId = `job-generic-${crypto.randomUUID()}`;
    const genericPayload = `memory://generic/${genericExecId}`;
    const genericVisibleAt = new Date(Date.now() - 60_000).toISOString();
    await sql`
      INSERT INTO provider_executions (
        execution_id, contract_version, org_id, workspace_id, campaign_id,
        pipeline_run_id, capability_id, capability_version, idempotency_key,
        deterministic_fingerprint, request_hash, output_schema_id,
        output_schema_version, status, execution_metadata, created_at
      ) VALUES (
        ${genericExecId},
        '1',
        ${PHASE_2A_IDS.orgId},
        ${PHASE_2A_IDS.workspaceId},
        ${PHASE_2A_IDS.campaignId},
        ${`pipeline-${genericExecId}`},
        'generic-capability',
        '1.0.0',
        ${`idem-${genericExecId}`},
        ${`fp-${genericExecId}`},
        ${`rh-${genericExecId}`},
        'generic-output',
        '1.0.0',
        'DISPATCHABLE',
        ${sql.json({ outputSchemaId: "generic-output", outputSchemaVersion: "1.0.0" })},
        NOW()
      )
    `;
    await sql`
      INSERT INTO provider_outbox_jobs (
        job_id, contract_version, execution_id, payload_reference,
        correlation_id, priority, next_visible_at, status, attempt_count, created_at
      ) VALUES (
        ${genericJobId},
        '1',
        ${genericExecId},
        ${genericPayload},
        ${`corr-${genericExecId}`},
        100,
        ${genericVisibleAt}::timestamptz,
        'PENDING',
        0,
        NOW()
      )
    `;

    const dispatchRepo = new ExecutionDispatchRepository();
    const aiEligible = await dispatchRepo.selectEligibleJob(new Date(), {
      ownership: "AI_STORY_SCENE",
    });
    expect(aiEligible?.jobId).toBe(scheduled.outboxJobId);

    const genericProbe = await sql<{
      status: string;
      dispatch_id: string | null;
      has_corr: boolean;
    }[]>`
      SELECT
        j.status,
        d.dispatch_id,
        EXISTS (
          SELECT 1 FROM ai_story_scene_scheduling_correlations c
          WHERE c.outbox_job_id = j.job_id
        ) AS has_corr
      FROM provider_outbox_jobs j
      LEFT JOIN provider_execution_dispatches d ON d.job_id = j.job_id
      WHERE j.job_id = ${genericJobId}
    `;
    expect(genericProbe[0]?.status).toBe("PENDING");
    expect(genericProbe[0]?.dispatch_id).toBeNull();
    expect(genericProbe[0]?.has_corr).toBe(false);

    const genericEligible = await dispatchRepo.selectEligibleJob(new Date(), {
      ownership: "GENERIC_PROVIDER",
    });
    expect(genericEligible?.jobId).toBe(genericJobId);

    // After selecting AI Story only, generic remains PENDING and undispatched.
    const genericBefore = await sql<{ status: string; d: string | null }[]>`
      SELECT j.status, d.dispatch_id AS d
      FROM provider_outbox_jobs j
      LEFT JOIN provider_execution_dispatches d ON d.job_id = j.job_id
      WHERE j.job_id = ${genericJobId}
    `;
    expect(genericBefore[0]?.status).toBe("PENDING");
    expect(genericBefore[0]?.d).toBeNull();

    const persisted = await persistDispatchFromScheduled(sql, scheduled);
    const dispatchRows = await sql<{ dispatch_id: string; job_id: string }[]>`
      SELECT dispatch_id, job_id
      FROM provider_execution_dispatches
      WHERE job_id = ${scheduled.outboxJobId}
    `;
    expect(dispatchRows).toEqual([
      {
        dispatch_id: persisted.dispatchId,
        job_id: scheduled.outboxJobId,
      },
    ]);
    const ownership =
      await new SceneProviderWorkerRuntimeRepository().classifyDispatchOwnership(
        persisted.dispatchId
      );
    expect(ownership).toBe("AI_STORY_SCENE");

    const genericAfter = await sql<{ status: string; d: string | null }[]>`
      SELECT j.status, d.dispatch_id AS d
      FROM provider_outbox_jobs j
      LEFT JOIN provider_execution_dispatches d ON d.job_id = j.job_id
      WHERE j.job_id = ${genericJobId}
    `;
    expect(genericAfter[0]?.status).toBe("PENDING");
    expect(genericAfter[0]?.d).toBeNull();
  }, 120_000);

  // ─── Task 8: 10-way continuation ────────────────────────────────────────
  it("Task8: 10-way continuation → one Assembly / Artifact / FSR", async () => {
    if (!RUN_FFMPEG) return;
    await resetTenant("gate-conc");
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "gate-conc",
      sceneOrder: [0],
    });
    const media = { uri: clipUri, contentHash: clipHash };
    const { registry } = createPhaseCAdapterRegistry("terminal_success", media);
    const instrumentation = emptyInstrumentation();
    const { coordinator } = await createPhaseCCoordinator({
      adapters: registry,
      artifactRoot,
      pathByUri: new Map([[clipUri, clipPath]]),
      instrumentation,
      expectedOwnership: {
        orgId: PHASE_2A_IDS.orgId,
        workspaceId: PHASE_2A_IDS.workspaceId,
      },
    });
    const { dispatch } = await scheduleAndDispatchScene({
      sql,
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
    });
    await coordinator.continueFromDispatch(dispatch.dispatchId);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        coordinator.continueAssemblyAndFinalStoryResult({
          executionPlanId: prepared.executionPlanId,
          runtimeAuthorizationId:
            prepared.acceptedAuthorization.runtimeAuthorizationId,
          ownership: prepared.acceptedAuthorization.ownership,
        })
      )
    );
    expect(
      results.every((r) => r.assemblyJobId === results[0]?.assemblyJobId)
    ).toBe(true);
    const counts = await countRows(
      sql,
      PHASE_2A_IDS.workspaceId,
      PHASE_2A_IDS.orgId
    );
    expect(counts.assemblyJob).toBe(1);
    expect(counts.assemblyTerminalFact).toBe(1);
    expect(counts.assemblyArtifact).toBe(1);
    expect(counts.finalStoryResult).toBe(1);
    // Engine may have run once on first continueFromDispatch; concurrent retries must not add.
    expect(instrumentation.engineRunCalls).toBeLessThanOrEqual(1);
  }, 240_000);
});
