/**
 * Sprint 3 PR 3.5R1 — real PostgreSQL integration for Production Finalizer + Scene projection.
 * No mocks. Skips unless RUN_DB_INTEGRATION_TESTS=1 and DATABASE_URL is set.
 */
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
import { GeneratedSceneReviewService } from "../packages/agents/src/ai-story/generated-scene-review-service";
import { releaseNextEligibleScene } from "../packages/agents/src/ai-story/release-next-eligible-scene";
import {
  closeDb,
  AiStorySceneReleaseRepository,
  createGeneratedSceneReviewConnectionMetrics,
  ExecutionEnvelopeRepository,
  GeneratedSceneReviewRepository,
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
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr35r1");
  }, 180_000);

  afterAll(async () => {
    await cleanupPr32Tenant(sql);
    await sql.end();
    await closeDb();
  }, 60_000);

  async function scheduleScene(sceneOrder?: readonly number[]) {
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "pr35r1",
      sceneOrder,
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

  it("successful finalization and approval certification", async () => {
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

    const bindingService = new GeneratedSceneReviewService({
      now: () => new Date("2026-08-05T13:05:00.000Z"),
    });
    const approvalInput = {
      executionPlanId: outcome.sceneResult.executionPlanId,
      sceneExecutionId: outcome.sceneResult.sceneExecutionId,
      attemptId: outcome.sceneResult.providerAttemptId,
      actorUserId: PR32_USER_A,
      workspaceId: dispatch.workspaceId,
      executionAuthorization: {} as never,
    };

    // The JSON fact is an immutable-domain authority alongside indexed
    // columns. A forged/mismatched attempt identity must fail closed.
    const wrongAttemptId = `wrong-attempt-${crypto.randomUUID()}`;
    await sql`
      UPDATE ai_story_generated_scene_reviews
      SET fact = jsonb_set(fact, '{providerAttemptId}', to_jsonb(${wrongAttemptId}::text))
      WHERE scene_execution_id = ${outcome.sceneResult.sceneExecutionId}
        AND provider_attempt_id = ${outcome.sceneResult.providerAttemptId}
    `;
    await expect(
      bindingService.approve({ ...approvalInput, attemptId: wrongAttemptId })
    ).rejects.toBeTruthy();
    await sql`
      UPDATE ai_story_generated_scene_reviews
      SET fact = jsonb_set(fact, '{providerAttemptId}', to_jsonb(${outcome.sceneResult.providerAttemptId}::text))
      WHERE scene_execution_id = ${outcome.sceneResult.sceneExecutionId}
        AND provider_attempt_id = ${outcome.sceneResult.providerAttemptId}
    `;

    const wrongResultId = crypto.randomUUID();
    await sql`
      UPDATE ai_story_generated_scene_reviews
      SET fact = jsonb_set(fact, '{sceneResultId}', to_jsonb(${wrongResultId}::text))
      WHERE scene_execution_id = ${outcome.sceneResult.sceneExecutionId}
        AND provider_attempt_id = ${outcome.sceneResult.providerAttemptId}
    `;
    await expect(bindingService.approve(approvalInput)).rejects.toBeTruthy();
    await sql`
      UPDATE ai_story_generated_scene_reviews
      SET fact = jsonb_set(fact, '{sceneResultId}', to_jsonb(${outcome.sceneResult.sceneResultId}::text))
      WHERE scene_execution_id = ${outcome.sceneResult.sceneExecutionId}
        AND provider_attempt_id = ${outcome.sceneResult.providerAttemptId}
    `;

    const wrongSceneExecutionId = crypto.randomUUID();
    await sql`
      UPDATE ai_story_generated_scene_reviews
      SET fact = jsonb_set(fact, '{sceneExecutionId}', to_jsonb(${wrongSceneExecutionId}::text))
      WHERE scene_execution_id = ${outcome.sceneResult.sceneExecutionId}
        AND provider_attempt_id = ${outcome.sceneResult.providerAttemptId}
    `;
    await expect(bindingService.approve(approvalInput)).rejects.toBeTruthy();
    await sql`
      UPDATE ai_story_generated_scene_reviews
      SET fact = jsonb_set(fact, '{sceneExecutionId}', to_jsonb(${outcome.sceneResult.sceneExecutionId}::text))
      WHERE scene_execution_id = ${outcome.sceneResult.sceneExecutionId}
        AND provider_attempt_id = ${outcome.sceneResult.providerAttemptId}
    `;
    const [afterNegativeBindings] = await sql<{
      decision: string;
      decided_at: Date | null;
      decided_by: string | null;
    }[]>`
      SELECT decision, decided_at, decided_by FROM ai_story_generated_scene_reviews
      WHERE scene_execution_id = ${outcome.sceneResult.sceneExecutionId}
        AND provider_attempt_id = ${outcome.sceneResult.providerAttemptId}
    `;
    expect(afterNegativeBindings).toMatchObject({
      decision: "PENDING_REVIEW",
      decided_at: null,
      decided_by: null,
    });

    const failureService = new GeneratedSceneReviewService({
      now: () => new Date("2026-08-05T13:05:00.000Z"),
    });

    // A deterministic persistence failure must roll the decision back.
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION emberos_ci_fail_scene_review_update()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced generated review persistence failure';
      END $$
    `);
    await sql.unsafe(`
      CREATE TRIGGER emberos_ci_fail_scene_review_update
      BEFORE UPDATE ON ai_story_generated_scene_reviews
      FOR EACH ROW EXECUTE FUNCTION emberos_ci_fail_scene_review_update()
    `);
    await expect(failureService.approve(approvalInput)).rejects.toBeTruthy();
    await sql.unsafe(`DROP TRIGGER emberos_ci_fail_scene_review_update ON ai_story_generated_scene_reviews`);
    await sql.unsafe(`DROP FUNCTION emberos_ci_fail_scene_review_update()`);
    const [afterPersistenceFailure] = await sql<{ decision: string; decided_at: Date | null }[]>`
      SELECT decision, decided_at FROM ai_story_generated_scene_reviews
      WHERE scene_execution_id = ${outcome.sceneResult.sceneExecutionId}
        AND provider_attempt_id = ${outcome.sceneResult.providerAttemptId}
    `;
    expect(afterPersistenceFailure).toMatchObject({ decision: "PENDING_REVIEW", decided_at: null });

    // A conflicting canonical plan lock must fail within the repository's
    // bounded lock timeout and leave the review pending.
    let releasePlanLock!: () => void;
    const planLockHeld = new Promise<void>((resolve) => { releasePlanLock = resolve; });
    const planLockOwner = sql.begin(async (tx) => {
      await tx`SELECT id FROM ai_story_execution_plans
        WHERE id = ${outcome.sceneResult.executionPlanId} FOR UPDATE`;
      await planLockHeld;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const lockFailureStartedAt = performance.now();
    await expect(failureService.approve(approvalInput)).rejects.toBeTruthy();
    expect(performance.now() - lockFailureStartedAt).toBeLessThan(15_000);
    releasePlanLock();
    await planLockOwner;
    const [afterLockFailure] = await sql<{ decision: string; decided_at: Date | null }[]>`
      SELECT decision, decided_at FROM ai_story_generated_scene_reviews
      WHERE scene_execution_id = ${outcome.sceneResult.sceneExecutionId}
        AND provider_attempt_id = ${outcome.sceneResult.providerAttemptId}
    `;
    expect(afterLockFailure).toMatchObject({ decision: "PENDING_REVIEW", decided_at: null });

    const connectionMetrics = createGeneratedSceneReviewConnectionMetrics();
    const approvalService = new GeneratedSceneReviewService({
      reviewRepository: new GeneratedSceneReviewRepository(undefined, connectionMetrics),
      now: () => new Date("2026-08-05T13:05:00.000Z"),
    });
    const approvalStartedAt = performance.now();
    const approval = await approvalService.approve({
      ...approvalInput,
    });
    expect(performance.now() - approvalStartedAt).toBeLessThan(15_000);
    expect(approval.review.decision).toBe("APPROVED");
    expect(approval.review.providerAttemptId).toBe(outcome.sceneResult.providerAttemptId);
    expect(approval.review.sceneResultId).toBe(outcome.sceneResult.sceneResultId);
    expect(approval.review.decidedBy).toBe(PR32_USER_A);
    expect(approval.review.decidedAt).toBe("2026-08-05T13:05:00.000Z");
    expect(connectionMetrics).toMatchObject({
      connectionAcquireCount: 1,
      transactionCount: 1,
      secondCheckoutAttempts: 0,
      maxConcurrentConnectionsObserved: 1,
    });
    expect(connectionMetrics.connectionWaitMs).toBeGreaterThanOrEqual(0);
    expect(connectionMetrics.transactionDurationMs).toBeGreaterThan(0);
    console.info("generated_scene_approval_connection_certification", {
      ...connectionMetrics,
      approvalTotalDurationMs: Math.round(performance.now() - approvalStartedAt),
    });

    const replayMetrics = createGeneratedSceneReviewConnectionMetrics();
    const replayService = new GeneratedSceneReviewService({
      reviewRepository: new GeneratedSceneReviewRepository(undefined, replayMetrics),
      now: () => new Date("2026-08-05T13:05:00.000Z"),
    });

    const replay = await replayService.approve({
      ...approvalInput,
    });
    expect(replay.review.generatedSceneReviewId).toBe(
      approval.review.generatedSceneReviewId
    );
    expect(replayMetrics.secondCheckoutAttempts).toBe(0);
    const [reviewCount] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ai_story_generated_scene_reviews
      WHERE scene_execution_id = ${outcome.sceneResult.sceneExecutionId}
        AND provider_attempt_id = ${outcome.sceneResult.providerAttemptId}
    `;
    expect(reviewCount?.count).toBe(1);
  }, 180_000);

  it("concurrent next-scene release transitions Scene 2 once and leaves Scene 3 held", async () => {
    const { prepared, dispatch } = await scheduleScene([0, 1, 2]);
    await seedTerminalSuccessWorker(dispatch.dispatchId);
    const outcome = await coordinator().finalizeAndProject({ dispatchId: dispatch.dispatchId });
    expect(outcome.outcome).toBe("PROJECTED");
    if (outcome.outcome !== "PROJECTED") throw new Error("expected PROJECTED");

    await new GeneratedSceneReviewService({
      now: () => new Date("2026-08-05T14:00:00.000Z"),
    }).approve({
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      attemptId: outcome.sceneResult.providerAttemptId,
      actorUserId: PR32_USER_A,
      workspaceId: dispatch.workspaceId,
      executionAuthorization: {} as never,
    });

    const release = () => releaseNextEligibleScene({
      executionPlanId: prepared.executionPlanId,
      workspaceId: dispatch.workspaceId,
      actorUserId: PR32_USER_A,
      executionAuthorization: {
        allowed: true,
        accessMode: "ops",
        settlementMode: "none",
        authorizedBy: "ACTIVE_PLATFORM_ADMIN",
        policyVersion: "ai-story-exec-03.v1",
        reason: "next-scene-concurrency-test",
        providerCostAccounting: "ALLOWED",
      },
      router: new FixedSeedanceRouter(),
      now: () => new Date("2026-08-05T14:01:00.000Z"),
    });
    const outcomes = await Promise.allSettled([release(), release()]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    const releaseResults = outcomes
      .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof release>>> => result.status === "fulfilled")
      .map((result) => result.value);
    expect(releaseResults.filter((result) => result.newlyReleasedSceneCount === 1)).toHaveLength(1);
    expect(releaseResults.filter((result) => result.newlyReleasedSceneCount === 0)).toHaveLength(1);

    const rows = await new AiStorySceneReleaseRepository().list(prepared.executionPlanId);
    expect(rows.filter((row) => row.sceneOrder === 2 && row.releaseState === "RELEASED")).toHaveLength(1);
    expect(rows.filter((row) => row.sceneOrder === 3 && row.releaseState === "RELEASED")).toHaveLength(0);
    expect(rows.find((row) => row.sceneOrder === 3)?.releaseState).toBe("AUTHORIZED_NOT_RELEASED");
    const [scene2Units] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ai_story_scene_scheduling_correlations
      WHERE scene_execution_id = ${prepared.sceneExecutionIds[1]!}
    `;
    const [scene3Units] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ai_story_scene_scheduling_correlations
      WHERE scene_execution_id = ${prepared.sceneExecutionIds[2]!}
    `;
    expect(scene2Units?.count).toBe(1);
    expect(scene3Units?.count).toBe(0);
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
