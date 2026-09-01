import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { createExecutionDispatch } from "@ceo-agent/shared";
import {
  AiStoryPreDispatchRecoveryRepository,
  ExecutionDispatchRepository,
  ExecutionEnvelopeRepository,
  SceneProviderWorkerRuntimeRepository,
  closeDb,
  getDb,
} from "@ceo-agent/db";
import { SceneProviderWorkerRuntime } from "../packages/agents/src/ai-story/scene-provider-worker-runtime";
import { SceneSchedulingCoordinator } from "../packages/agents/src/ai-story/scene-scheduling-coordinator";
import { createPr33TestAdapterRegistry } from "../packages/agents/src/ai-story/canonical-provider-test-adapters";
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

const integrationDbUrl = getIntegrationDbUrl();
if (RUN_DB_INTEGRATION && !integrationDbUrl) {
  throw new Error("DATABASE_URL is required when RUN_DB_INTEGRATION_TESTS=1");
}
const describeIntegration = RUN_DB_INTEGRATION ? describe : describe.skip;

describeIntegration("atomic AI Story pre-dispatch recovery", () => {
  let sqlClient: Sql;

  beforeAll(async () => {
    sqlClient = createIntegrationSql();
    await cleanupPr32Tenant(sqlClient);
    await seedPr32Tenant(sqlClient, undefined, PR32_USER_A, "pre-dispatch-recovery");
  }, 120_000);

  afterAll(async () => {
    await sqlClient`delete from admin_runtime_recovery_receipts where actor_user_id = ${PR32_USER_A}`;
    await cleanupPr32Tenant(sqlClient);
    await sqlClient.end();
    await closeDb();
  }, 60_000);

  it("converges two commands to one rearm and one claim without duplicate lineage", async () => {
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "pre-dispatch-recovery",
    });
    const scheduled = await new SceneSchedulingCoordinator({
      router: new FixedSeedanceRouter(),
    }).scheduleAuthorizedScene({
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId: prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
      actorUserId: PR32_USER_A,
    });
    const envelope = await new ExecutionEnvelopeRepository().getEnvelope(scheduled.envelopeId);
    expect(envelope).toBeTruthy();
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
    await new ExecutionDispatchRepository().createDispatch(dispatch);
    const worker = new SceneProviderWorkerRuntime({
      repository: new SceneProviderWorkerRuntimeRepository(),
      adapters: createPr33TestAdapterRegistry("not_accepted"),
    });
    const blocked = await worker.processDispatch({ dispatchId: dispatch.dispatchId });
    expect(blocked.result.workerState).toBe("NOT_ACCEPTED");
    expect(blocked.result.providerRequestId).toBeUndefined();

    const repository = new AiStoryPreDispatchRecoveryRepository();
    const command = {
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      orgId: scheduled.correlation.ownership.orgId,
      workspaceId: scheduled.correlation.ownership.workspaceId,
      actorUserId: PR32_USER_A,
      idempotencyKey: `recovery:${dispatch.dispatchId}`,
      reason: "integration concurrency proof",
    };
    const [left, right] = await Promise.all([
      repository.recover(command),
      repository.recover(command),
    ]);
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    expect(left.dispatchId).toBe(dispatch.dispatchId);
    expect(right.dispatchId).toBe(dispatch.dispatchId);

    const dispatchRepository = new ExecutionDispatchRepository();
    const claims = await Promise.all([
      dispatchRepository.claimAuthorizedRecoveryDispatch({ workerId: "worker-a" }),
      dispatchRepository.claimAuthorizedRecoveryDispatch({ workerId: "worker-b" }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);

    const [counts] = await sqlClient<{
      attempts: number;
      dispatches: number;
      outbox_jobs: number;
      receipts: number;
      archives: number;
      terminal_results: number;
    }[]>`
      select
        (select count(*)::int from provider_attempts where execution_id = ${scheduled.providerExecutionId}) attempts,
        (select count(*)::int from provider_execution_dispatches where job_id = ${scheduled.outboxJobId}) dispatches,
        (select count(*)::int from provider_outbox_jobs where job_id = ${scheduled.outboxJobId}) outbox_jobs,
        (select count(*)::int from admin_runtime_recovery_receipts where target_id = ${dispatch.dispatchId}) receipts,
        (select count(*)::int from ai_story_worker_attempt_observations where dispatch_id = ${dispatch.dispatchId} and observation_kind = 'PRE_DISPATCH_BLOCKED') archives,
        (select count(*)::int from ai_story_worker_execution_results where dispatch_id = ${dispatch.dispatchId}) terminal_results
    `;
    expect(counts).toEqual({
      attempts: 0,
      dispatches: 1,
      outbox_jobs: 1,
      receipts: 1,
      archives: 1,
      terminal_results: 0,
    });
  }, 120_000);

  it("authorizes the exact existing Dispatch when Worker never accepted it", async () => {
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "pre-dispatch-recovery-never-claimed",
    });
    const scheduled = await new SceneSchedulingCoordinator({
      router: new FixedSeedanceRouter(),
    }).scheduleAuthorizedScene({
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId: prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
      actorUserId: PR32_USER_A,
    });
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
    await new ExecutionDispatchRepository().createDispatch(dispatch);

    const repository = new AiStoryPreDispatchRecoveryRepository();
    const command = {
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      orgId: scheduled.correlation.ownership.orgId,
      workspaceId: scheduled.correlation.ownership.workspaceId,
      actorUserId: PR32_USER_A,
      idempotencyKey: `recovery-never-claimed:${dispatch.dispatchId}`,
      reason: "never-claimed recovery proof",
    };
    const first = await repository.recover(command);
    const replay = await repository.recover(command);
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(first.dispatchId).toBe(dispatch.dispatchId);
    expect(first.compiledRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.requestFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.providerId).toBe(scheduled.routingDecision.selectedProviderId);

    const [counts] = await sqlClient<{
      attempts: number;
      dispatches: number;
      outbox_jobs: number;
      receipts: number;
      archives: number;
      terminal_results: number;
    }[]>`
      select
        (select count(*)::int from provider_attempts where execution_id = ${scheduled.providerExecutionId}) attempts,
        (select count(*)::int from provider_execution_dispatches where job_id = ${scheduled.outboxJobId}) dispatches,
        (select count(*)::int from provider_outbox_jobs where job_id = ${scheduled.outboxJobId}) outbox_jobs,
        (select count(*)::int from admin_runtime_recovery_receipts where target_id = ${dispatch.dispatchId}) receipts,
        (select count(*)::int from ai_story_worker_attempt_observations where dispatch_id = ${dispatch.dispatchId}) archives,
        (select count(*)::int from ai_story_worker_execution_results where dispatch_id = ${dispatch.dispatchId}) terminal_results
    `;
    expect(counts).toEqual({
      attempts: 0,
      dispatches: 1,
      outbox_jobs: 1,
      receipts: 1,
      archives: 0,
      terminal_results: 0,
    });
  }, 120_000);

  it("rolls back every recovery mutation when timestamp normalization fails", async () => {
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "pre-dispatch-recovery-invalid-timestamp",
    });
    const scheduled = await new SceneSchedulingCoordinator({
      router: new FixedSeedanceRouter(),
    }).scheduleAuthorizedScene({
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId: prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
      actorUserId: PR32_USER_A,
    });
    const envelope = await new ExecutionEnvelopeRepository().getEnvelope(scheduled.envelopeId);
    expect(envelope).toBeTruthy();
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
    await new ExecutionDispatchRepository().createDispatch(dispatch);
    const worker = new SceneProviderWorkerRuntime({
      repository: new SceneProviderWorkerRuntimeRepository(),
      adapters: createPr33TestAdapterRegistry("not_accepted"),
    });
    await worker.processDispatch({ dispatchId: dispatch.dispatchId });

    const repository = new AiStoryPreDispatchRecoveryRepository(getDb(), () => {
      throw new Error("injected invalid timestamp");
    });
    await expect(repository.recover({
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      orgId: scheduled.correlation.ownership.orgId,
      workspaceId: scheduled.correlation.ownership.workspaceId,
      actorUserId: PR32_USER_A,
      idempotencyKey: `recovery-invalid-timestamp:${dispatch.dispatchId}`,
      reason: "rollback proof",
    })).rejects.toThrow("injected invalid timestamp");

    const [state] = await sqlClient<{
      attempts: number;
      receipts: number;
      archives: number;
      terminal_results: number;
      outbox_status: string;
      outbox_notes: string | null;
      dispatches: number;
    }[]>`
      select
        (select count(*)::int from provider_attempts where execution_id = ${scheduled.providerExecutionId}) attempts,
        (select count(*)::int from admin_runtime_recovery_receipts where target_id = ${dispatch.dispatchId}) receipts,
        (select count(*)::int from ai_story_worker_attempt_observations where dispatch_id = ${dispatch.dispatchId} and observation_kind = 'PRE_DISPATCH_BLOCKED') archives,
        (select count(*)::int from ai_story_worker_execution_results where dispatch_id = ${dispatch.dispatchId}) terminal_results,
        (select status from provider_outbox_jobs where job_id = ${scheduled.outboxJobId}) outbox_status,
        (select operator_notes from provider_outbox_jobs where job_id = ${scheduled.outboxJobId}) outbox_notes,
        (select count(*)::int from provider_execution_dispatches where job_id = ${scheduled.outboxJobId}) dispatches
    `;
    expect(state).toEqual({
      attempts: 0,
      receipts: 0,
      archives: 0,
      terminal_results: 1,
      outbox_status: "PENDING",
      outbox_notes: null,
      dispatches: 1,
    });
  }, 120_000);
});
