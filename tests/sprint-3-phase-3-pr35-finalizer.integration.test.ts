/**
 * Sprint 3 PR 3.5R1 — real PostgreSQL integration for Production Finalizer + Scene projection.
 * No mocks. Skips unless RUN_DB_INTEGRATION_TESTS=1 and DATABASE_URL is set.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { createExecutionDispatch } from "@ceo-agent/shared";
import {
  SceneSchedulingCoordinator,
} from "../packages/agents/src/ai-story/scene-scheduling-coordinator";
import {
  SceneFinalizationCoordinator,
  SceneFinalizationCoordinatorError,
} from "../packages/agents/src/ai-story/scene-finalization-coordinator";
import {
  closeDb,
  ExecutionEnvelopeRepository,
  ProviderExecutionFinalizationError,
  ProviderExecutionFinalizationRepository,
  ProviderLedgerRepository,
  ProviderOutboxRepository,
  SceneProjectionRepositoryImpl,
  SceneProviderWorkerRuntimeRepository,
} from "@ceo-agent/db";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { applyPhaseECommercialAuthorizationSql } from "./helpers/commercial-phase-e-sql";
import {
  FixedSeedanceRouter,
  PR32_USER_A,
  cleanupPr32Tenant,
  prepareAuthorizedSchedulingPlan,
  seedPr32Tenant,
} from "./helpers/ai-story-pr32-scheduling";
import {
  buildTerminalFailureWorkerResult,
  buildTerminalSuccessWorkerResult,
} from "./helpers/ai-story-pr35-finalizer";
import type { SceneProjectionValidatedBundle } from "@ceo-agent/shared";

const integrationDbUrl = getIntegrationDbUrl();
if (RUN_DB_INTEGRATION && !integrationDbUrl) {
  throw new Error("DATABASE_URL is required when RUN_DB_INTEGRATION_TESTS=1");
}
const describeIntegration = RUN_DB_INTEGRATION ? describe : describe.skip;

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

async function persistDispatch(
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
    routingDecision: {
      capabilityId: string;
      capabilityVersion: string;
    };
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
  `;
  return dispatch;
}

describeIntegration("Sprint 3 PR 3.5R1 Finalizer PostgreSQL integration", () => {
  let sql: Sql;
  const projectionRepo = () => new SceneProjectionRepositoryImpl();
  const finalizer = () => new ProviderExecutionFinalizationRepository();
  const ledger = () => new ProviderLedgerRepository();
  const outbox = () => new ProviderOutboxRepository();

  function coordinator() {
    const chain = projectionRepo();
    return new SceneFinalizationCoordinator({
      chain,
      bridge: { ledger: ledger(), outbox: outbox() },
      productionFinalizer: finalizer(),
      projection: chain,
    });
  }

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
      "../packages/db/sql/ai-story-scene-projection-v1.sql",
    ]) {
      await applySqlFile(sql, relative);
    }
    await applyPhaseECommercialAuthorizationSql(sql);
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr35r1");
  }, 180_000);

  afterAll(async () => {
    await cleanupPr32Tenant(sql);
    await sql.end();
    await closeDb();
  }, 60_000);

  async function scheduleScene() {
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "pr35r1",
    });
    const scheduled = await new SceneSchedulingCoordinator({
      router: new FixedSeedanceRouter(),
    }).scheduleAuthorizedScene({
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
      actorUserId: PR32_USER_A,
    });
    const envelope = await new ExecutionEnvelopeRepository().getEnvelope(
      scheduled.envelopeId
    );
    expect(envelope).toBeTruthy();
    const dispatch = await persistDispatch(sql, scheduled);
    return { prepared, scheduled, dispatch };
  }

  async function seedTerminalSuccessWorker(dispatchId: string) {
    const chain = projectionRepo();
    const loaded = await chain.loadValidatedBundleByDispatchId(dispatchId);
    expect(loaded).toBeTruthy();
    const worker = buildTerminalSuccessWorkerResult(loaded!, {
      providerExecutionId: loaded!.providerExecutionId,
      outboxJobId: loaded!.outboxJobId,
      dispatchId: loaded!.dispatch.dispatchId,
      routingDecisionId: loaded!.routingDecision.routingDecisionId,
      providerId: loaded!.routingDecision.selectedProviderId,
      adapterVersion: loaded!.routingDecision.selectedAdapterVersion,
      providerAttemptId: crypto.randomUUID(),
      workerExecutionResultId: crypto.randomUUID(),
    });
    await new SceneProviderWorkerRuntimeRepository().acceptOrReturnWorkerExecutionResult(
      worker
    );
    return worker;
  }

  it("successful finalization + usage/cost/outbox/execution once + projection", async () => {
    const { dispatch } = await scheduleScene();
    await seedTerminalSuccessWorker(dispatch.dispatchId);

    const outcome = await coordinator().finalizeAndProject({
      dispatchId: dispatch.dispatchId,
    });
    expect(outcome.outcome).toBe("PROJECTED");
    if (outcome.outcome !== "PROJECTED") throw new Error("expected PROJECTED");
    expect(outcome.finalizerInvoked).toBe(true);
    expect(outcome.sceneResult.status).toBe("SUCCEEDED");

    const [execution] = await sql<{ status: string; accepted_attempt_id: string }[]>`
      SELECT status, accepted_attempt_id FROM provider_executions
      WHERE execution_id = ${dispatch.executionId}
    `;
    const [job] = await sql<{ status: string }[]>`
      SELECT status FROM provider_outbox_jobs WHERE job_id = ${dispatch.jobId}
    `;
    const [usage] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM provider_attempt_usage
      WHERE attempt_id = ${outcome.sceneResult.providerAttemptId}
    `;
    const [cost] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM provider_attempt_costs
      WHERE attempt_id = ${outcome.sceneResult.providerAttemptId}
    `;
    const [scenes] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ai_story_scene_results
      WHERE scene_result_id = ${outcome.sceneResult.sceneResultId}
    `;

    expect(execution?.status).toBe("SUCCEEDED");
    expect(job?.status).toBe("COMPLETED");
    expect(usage?.count).toBe(1);
    expect(cost?.count).toBe(1);
    expect(scenes?.count).toBe(1);
  }, 180_000);

  it("replay converges without re-invoking Finalizer / rewriting usage", async () => {
    const { dispatch } = await scheduleScene();
    await seedTerminalSuccessWorker(dispatch.dispatchId);
    const first = await coordinator().finalizeAndProject({
      dispatchId: dispatch.dispatchId,
    });
    const second = await coordinator().finalizeAndProject({
      dispatchId: dispatch.dispatchId,
    });
    expect(first.outcome).toBe("PROJECTED");
    expect(second.outcome).toBe("PROJECTED");
    if (first.outcome !== "PROJECTED" || second.outcome !== "PROJECTED") {
      throw new Error("expected PROJECTED");
    }
    expect(first.finalizerInvoked).toBe(true);
    expect(second.finalizerInvoked).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.sceneResult.integrityHash).toBe(first.sceneResult.integrityHash);

    const [usage] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM provider_attempt_usage
      WHERE attempt_id = ${first.sceneResult.providerAttemptId}
    `;
    expect(usage?.count).toBe(1);
  }, 180_000);

  it("concurrent identical finalization accepts exactly once", async () => {
    const { dispatch } = await scheduleScene();
    await seedTerminalSuccessWorker(dispatch.dispatchId);
    const chain = projectionRepo();
    const workerResult = await chain.loadWorkerExecutionResultByDispatchId(
      dispatch.dispatchId
    );
    const bundle = await chain.loadValidatedBundleByDispatchId(dispatch.dispatchId);
    expect(workerResult && bundle).toBeTruthy();

    const bridgeModule = await import(
      "../packages/agents/src/ai-story/provider-worker-result-finalizer-bridge"
    );
    const bridge = new bridgeModule.ProviderWorkerResultFinalizerBridge({
      ledger: ledger(),
      outbox: outbox(),
    });
    const prepared = await bridge.prepareFinalizerInput({
      bundle: bundle!,
      workerResult: workerResult!,
    });

    const repo = finalizer();
    const settled = await Promise.allSettled([
      repo.finalize(prepared.finalizerInput),
      repo.finalize(prepared.finalizerInput),
    ]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((s) => s.status === "rejected")).toHaveLength(1);

    const [job] = await sql<{ status: string }[]>`
      SELECT status FROM provider_outbox_jobs WHERE job_id = ${dispatch.jobId}
    `;
    const [usage] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM provider_attempt_usage
      WHERE attempt_id = ${prepared.finalizerInput.attemptId}
    `;
    expect(job?.status).toBe("COMPLETED");
    expect(usage?.count).toBe(1);
  }, 180_000);

  it("conflicting finalization fails closed (success vs failure)", async () => {
    const { dispatch } = await scheduleScene();
    await seedTerminalSuccessWorker(dispatch.dispatchId);
    const outcome = await coordinator().finalizeAndProject({
      dispatchId: dispatch.dispatchId,
    });
    expect(outcome.outcome).toBe("PROJECTED");

    const chain = projectionRepo();
    const bundle = (await chain.loadValidatedBundleByDispatchId(
      dispatch.dispatchId
    )) as SceneProjectionValidatedBundle;
    const failureWorker = buildTerminalFailureWorkerResult(bundle, {
      failureCode: "PROVIDER_FAILED",
      providerExecutionId: dispatch.executionId,
      outboxJobId: dispatch.jobId,
      dispatchId: dispatch.dispatchId,
    });
    const bridgeModule = await import(
      "../packages/agents/src/ai-story/provider-worker-result-finalizer-bridge"
    );
    const bridge = new bridgeModule.ProviderWorkerResultFinalizerBridge({
      ledger: ledger(),
      outbox: outbox(),
    });
    await expect(
      bridge.prepareTerminalFailureFinalizerInput({
        bundle,
        workerResult: failureWorker,
      })
    ).rejects.toBeTruthy();

    await expect(
      finalizer().finalizeTerminalFailure({
        jobId: dispatch.jobId,
        executionId: dispatch.executionId,
        attemptId: failureWorker.providerAttemptId,
        workerId: "ai-story-finalizer-bridge",
        providerId: failureWorker.providerId,
        adapterVersion: failureWorker.adapterVersion,
        failureCode: "PROVIDER_FAILED",
        failureReason: "conflict",
        resultReference: `terminal-failure://${failureWorker.workerExecutionResultId}`,
        requestHash: bundle.envelope.requestHash,
        responseHash: failureWorker.deterministicIntegrityHash,
        dispatchTimestamp: bundle.dispatch.createdAt,
        executionDurationMs: 0,
      })
    ).rejects.toBeInstanceOf(ProviderExecutionFinalizationError);

    const [execution] = await sql<{ status: string }[]>`
      SELECT status FROM provider_executions WHERE execution_id = ${dispatch.executionId}
    `;
    expect(execution?.status).toBe("SUCCEEDED");
  }, 180_000);

  it("projection retry without Provider re-finalization after Tx B failure", async () => {
    const { dispatch } = await scheduleScene();
    await seedTerminalSuccessWorker(dispatch.dispatchId);

    const chain = projectionRepo();
    const failingProjection = {
      async acceptOrConvergeProjection() {
        throw new Error("Simulated Tx B rollback");
      },
    };
    const failingCoordinator = new SceneFinalizationCoordinator({
      chain,
      bridge: { ledger: ledger(), outbox: outbox() },
      productionFinalizer: finalizer(),
      projection: failingProjection,
    });

    await expect(
      failingCoordinator.finalizeAndProject({ dispatchId: dispatch.dispatchId })
    ).rejects.toBeInstanceOf(SceneFinalizationCoordinatorError);

    const [execution] = await sql<{ status: string }[]>`
      SELECT status FROM provider_executions WHERE execution_id = ${dispatch.executionId}
    `;
    const [job] = await sql<{ status: string }[]>`
      SELECT status FROM provider_outbox_jobs WHERE job_id = ${dispatch.jobId}
    `;
    expect(execution?.status).toBe("SUCCEEDED");
    expect(job?.status).toBe("COMPLETED");

    const recovered = await coordinator().finalizeAndProject({
      dispatchId: dispatch.dispatchId,
    });
    expect(recovered.outcome).toBe("PROJECTED");
    if (recovered.outcome !== "PROJECTED") throw new Error("expected PROJECTED");
    expect(recovered.finalizerInvoked).toBe(false);
    expect(recovered.sceneResult.status).toBe("SUCCEEDED");
  }, 180_000);

  it("projection conflict fails closed", async () => {
    const { dispatch, scheduled } = await scheduleScene();
    await seedTerminalSuccessWorker(dispatch.dispatchId);
    const first = await coordinator().finalizeAndProject({
      dispatchId: dispatch.dispatchId,
    });
    expect(first.outcome).toBe("PROJECTED");
    if (first.outcome !== "PROJECTED") throw new Error("expected PROJECTED");

    const conflictHash = `sha256:${"b".repeat(64)}`;
    await sql`
      UPDATE ai_story_scene_projection_correlations
      SET
        integrity_hash = ${conflictHash},
        correlation = jsonb_set(correlation, '{integrityHash}', to_jsonb(${conflictHash}::text))
      WHERE scene_execution_id = ${scheduled.routingDecision.sceneExecutionId}
    `;

    await expect(
      coordinator().finalizeAndProject({ dispatchId: dispatch.dispatchId })
    ).rejects.toMatchObject({ code: "SCENE_PROJECTION_CONFLICT" });
  }, 180_000);

  it("rollback of Tx A on usage conflict leaves execution/outbox non-terminal", async () => {
    const { dispatch } = await scheduleScene();
    const workerResult = await seedTerminalSuccessWorker(dispatch.dispatchId);
    const chain = projectionRepo();
    const bundle = await chain.loadValidatedBundleByDispatchId(dispatch.dispatchId);
    expect(bundle).toBeTruthy();

    const bridgeModule = await import(
      "../packages/agents/src/ai-story/provider-worker-result-finalizer-bridge"
    );
    const bridge = new bridgeModule.ProviderWorkerResultFinalizerBridge({
      ledger: ledger(),
      outbox: outbox(),
    });
    const prepared = await bridge.prepareFinalizerInput({
      bundle: bundle!,
      workerResult,
    });

    await ledger().recordUsage(prepared.finalizerInput.attemptId, {
      totalTokens: 999,
    });

    await expect(finalizer().finalize(prepared.finalizerInput)).rejects.toThrow(
      /usage conflicts/
    );

    const [execution] = await sql<{ status: string; accepted_result: unknown }[]>`
      SELECT status, accepted_result FROM provider_executions
      WHERE execution_id = ${dispatch.executionId}
    `;
    const [job] = await sql<{ status: string }[]>`
      SELECT status FROM provider_outbox_jobs WHERE job_id = ${dispatch.jobId}
    `;
    const [cost] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM provider_attempt_costs
      WHERE attempt_id = ${prepared.finalizerInput.attemptId}
    `;
    expect(execution?.accepted_result).toBeNull();
    expect(execution?.status).not.toBe("SUCCEEDED");
    expect(job?.status).toBe("CLAIMED");
    expect(cost?.count).toBe(0);
  }, 180_000);

  it("rollback of Tx B never rolls back accepted Provider finalization", async () => {
    const { dispatch } = await scheduleScene();
    await seedTerminalSuccessWorker(dispatch.dispatchId);
    const chain = projectionRepo();
    const failing = new SceneFinalizationCoordinator({
      chain,
      bridge: { ledger: ledger(), outbox: outbox() },
      productionFinalizer: finalizer(),
      projection: {
        async acceptOrConvergeProjection() {
          throw Object.assign(new Error("Tx B forced failure"), {
            code: "SCENE_PROJECTION_TRANSACTION_FAILED",
          });
        },
      },
    });
    await expect(
      failing.finalizeAndProject({ dispatchId: dispatch.dispatchId })
    ).rejects.toBeTruthy();

    const [execution] = await sql<{ status: string }[]>`
      SELECT status FROM provider_executions WHERE execution_id = ${dispatch.executionId}
    `;
    const [job] = await sql<{ status: string }[]>`
      SELECT status FROM provider_outbox_jobs WHERE job_id = ${dispatch.jobId}
    `;
    const [proj] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ai_story_scene_projection_correlations
      WHERE provider_execution_id = ${dispatch.executionId}
    `;
    expect(execution?.status).toBe("SUCCEEDED");
    expect(job?.status).toBe("COMPLETED");
    expect(proj?.count).toBe(0);
  }, 180_000);

  it("terminal failure finalization: DEAD_LETTER, no usage/cost, FAILED scene", async () => {
    const { dispatch } = await scheduleScene();
    const chain = projectionRepo();
    const loaded = await chain.loadValidatedBundleByDispatchId(dispatch.dispatchId);
    expect(loaded).toBeTruthy();
    const aligned = buildTerminalFailureWorkerResult(loaded!, {
      failureCode: "PROVIDER_FAILED",
      providerExecutionId: dispatch.executionId,
      outboxJobId: dispatch.jobId,
      dispatchId: dispatch.dispatchId,
      routingDecisionId: loaded!.routingDecision.routingDecisionId,
      providerId: loaded!.routingDecision.selectedProviderId,
      adapterVersion: loaded!.routingDecision.selectedAdapterVersion,
      providerAttemptId: crypto.randomUUID(),
      workerExecutionResultId: crypto.randomUUID(),
    });
    await new SceneProviderWorkerRuntimeRepository().acceptOrReturnWorkerExecutionResult(
      aligned
    );

    const outcome = await coordinator().finalizeAndProject({
      dispatchId: dispatch.dispatchId,
    });
    expect(outcome.outcome).toBe("PROJECTED");
    if (outcome.outcome !== "PROJECTED") throw new Error("expected PROJECTED");
    expect(outcome.sceneResult.status).toBe("FAILED");

    const [execution] = await sql<{ status: string }[]>`
      SELECT status FROM provider_executions WHERE execution_id = ${dispatch.executionId}
    `;
    const [job] = await sql<{ status: string; dead_letter_reason: string | null }[]>`
      SELECT status, dead_letter_reason FROM provider_outbox_jobs
      WHERE job_id = ${dispatch.jobId}
    `;
    const [usage] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM provider_attempt_usage
      WHERE attempt_id = ${aligned.providerAttemptId}
    `;
    const [cost] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM provider_attempt_costs
      WHERE attempt_id = ${aligned.providerAttemptId}
    `;
    expect(execution?.status).toBe("TERMINAL_FAILURE");
    expect(job?.status).toBe("DEAD_LETTER");
    expect(job?.dead_letter_reason).toMatch(/PROVIDER_FAILED/);
    expect(usage?.count).toBe(0);
    expect(cost?.count).toBe(0);
  }, 180_000);

  it("REJECTED and TIMEOUT project without Provider ownership duplication", async () => {
    for (const [code, status] of [
      ["PROVIDER_REJECTED", "REJECTED"],
      ["PROVIDER_TIMEOUT", "TIMEOUT"],
    ] as const) {
      const { dispatch } = await scheduleScene();
      const chain = projectionRepo();
      const loaded = await chain.loadValidatedBundleByDispatchId(dispatch.dispatchId);
      const worker = buildTerminalFailureWorkerResult(loaded!, {
        failureCode: code,
        providerExecutionId: dispatch.executionId,
        outboxJobId: dispatch.jobId,
        dispatchId: dispatch.dispatchId,
        routingDecisionId: loaded!.routingDecision.routingDecisionId,
        providerId: loaded!.routingDecision.selectedProviderId,
        adapterVersion: loaded!.routingDecision.selectedAdapterVersion,
        providerAttemptId: crypto.randomUUID(),
        workerExecutionResultId: crypto.randomUUID(),
      });
      await new SceneProviderWorkerRuntimeRepository().acceptOrReturnWorkerExecutionResult(
        worker
      );
      const outcome = await coordinator().finalizeAndProject({
        dispatchId: dispatch.dispatchId,
      });
      expect(outcome.outcome).toBe("PROJECTED");
      if (outcome.outcome !== "PROJECTED") throw new Error("expected PROJECTED");
      expect(outcome.sceneResult.status).toBe(status);
      const [job] = await sql<{ status: string }[]>`
        SELECT status FROM provider_outbox_jobs WHERE job_id = ${dispatch.jobId}
      `;
      expect(job?.status).toBe("DEAD_LETTER");
    }
  }, 240_000);

  it("cross workspace rejection at Finalizer bridge", async () => {
    const { dispatch } = await scheduleScene();
    const chain = projectionRepo();
    const loaded = await chain.loadValidatedBundleByDispatchId(dispatch.dispatchId);
    expect(loaded).toBeTruthy();
    const foreignWorkspace = "20000000-0000-4000-8000-000000000099";
    const tainted: SceneProjectionValidatedBundle = {
      ...loaded!,
      dispatch: {
        ...loaded!.dispatch,
        workspaceId: foreignWorkspace,
      },
    };
    const worker = buildTerminalSuccessWorkerResult(loaded!);
    const bridgeModule = await import(
      "../packages/agents/src/ai-story/provider-worker-result-finalizer-bridge"
    );
    const bridge = new bridgeModule.ProviderWorkerResultFinalizerBridge({
      ledger: ledger(),
      outbox: outbox(),
    });
    await expect(
      bridge.prepareFinalizerInput({ bundle: tainted, workerResult: worker })
    ).rejects.toMatchObject({ code: "BRIDGE_OWNERSHIP_VIOLATION" });
  }, 120_000);
});
