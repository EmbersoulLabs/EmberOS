import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  createExecutionDispatch,
  type ExecutionDispatch,
} from "@ceo-agent/shared";
import { buildAiStoryPreDispatchSuccessorBundle } from "@ceo-agent/agents";
import {
  AiStoryPreDispatchBundleSupersessionRepository,
  ExecutionDispatchRepository,
  SceneSchedulingRepository,
  canonicalPersistenceHash,
  closeDb,
  deterministicPersistenceUuid,
  type ScheduleAcceptedBundleInput,
} from "@ceo-agent/db";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import type { Phase2aIdSet } from "./helpers/ai-story-phase-2a";
import {
  FixedSeedanceRouter,
  PR32_USER_A,
  captureScheduleAcceptedBundleInput,
  cleanupPr32Tenant,
  prepareAuthorizedSchedulingPlan,
  seedPr32Tenant,
} from "./helpers/ai-story-pr32-scheduling";

const integrationDbUrl = getIntegrationDbUrl();
if (RUN_DB_INTEGRATION && !integrationDbUrl) {
  throw new Error("DATABASE_URL is required when RUN_DB_INTEGRATION_TESTS=1");
}
const describeIntegration = RUN_DB_INTEGRATION ? describe : describe.skip;

function ids(): Phase2aIdSet {
  return {
    orgId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    campaignId: crypto.randomUUID(),
    storyId: crypto.randomUUID(),
    storyVersionId: crypto.randomUUID(),
    animationPackageId: crypto.randomUUID(),
    assetId: crypto.randomUUID(),
  };
}

async function successorFrom(
  source: ScheduleAcceptedBundleInput,
  sourceDispatch: ExecutionDispatch,
  suffix: string
): Promise<{ input: ScheduleAcceptedBundleInput; dispatch: Awaited<ReturnType<typeof createExecutionDispatch>> }> {
  const createdAt = new Date(Date.parse(source.correlation.scheduledAt) + 1_000).toISOString();
  const compiledRequestId = deterministicPersistenceUuid("test-successor-compiled", { suffix });
  const requestFingerprint = canonicalPersistenceHash({
    source: source.compiledProviderRequest.requestFingerprint,
    suffix,
  });
  const compiledProviderRequest = {
    ...source.compiledProviderRequest,
    compiledRequestId,
    mappingVersion: `${source.compiledProviderRequest.mappingVersion}.successor`,
    compiledAt: createdAt,
    requestFingerprint,
  };
  const built = await buildAiStoryPreDispatchSuccessorBundle({
    source,
    sourceDispatch,
    compiledProviderRequest,
    targetContractVersion: `test.${suffix}`,
    createdAt,
  });
  return { input: built.successor, dispatch: built.dispatch };
}

describeIntegration("AI Story pre-dispatch bundle supersession", () => {
  let sqlClient: Sql;
  const cleanupIds: Phase2aIdSet[] = [];

  beforeAll(async () => {
    sqlClient = createIntegrationSql();
    await sqlClient.unsafe(readFileSync(resolve(
      __dirname,
      "../packages/db/sql/ai-story-pre-dispatch-bundle-supersession-v1.sql"
    ), "utf8"));
  }, 120_000);

  afterAll(async () => {
    for (const fixture of cleanupIds) {
      await sqlClient.unsafe(
        "ALTER TABLE ai_story_pre_dispatch_bundle_supersessions DISABLE TRIGGER ai_story_bundle_supersession_immutable_v1"
      );
      try {
        await sqlClient`delete from ai_story_pre_dispatch_bundle_supersessions where org_id = ${fixture.orgId}`;
      } finally {
        await sqlClient.unsafe(
          "ALTER TABLE ai_story_pre_dispatch_bundle_supersessions ENABLE TRIGGER ai_story_bundle_supersession_immutable_v1"
        );
      }
      await cleanupPr32Tenant(sqlClient, fixture);
    }
    await sqlClient.end();
    await closeDb();
  }, 120_000);

  async function prepare(purpose: string) {
    const fixture = ids();
    cleanupIds.push(fixture);
    await seedPr32Tenant(sqlClient, fixture, PR32_USER_A, purpose);
    const prepared = await prepareAuthorizedSchedulingPlan({ purpose, ids: fixture });
    const sourceInput = await captureScheduleAcceptedBundleInput({
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId: prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
      actorUserId: PR32_USER_A,
      router: new FixedSeedanceRouter(),
    });
    await new SceneSchedulingRepository().scheduleAcceptedBundle(sourceInput);
    const sourceDispatch = await createExecutionDispatch({
      version: "1",
      dispatchId: `dispatch:${sourceInput.outboxJob.jobId}`,
      jobId: sourceInput.outboxJob.jobId,
      executionId: sourceInput.providerExecution.identity.executionId,
      envelopeId: sourceInput.envelope.envelopeId,
      payloadReference: sourceInput.envelope.payloadReference,
      correlationId: sourceInput.correlation.correlationId,
      tenantId: sourceInput.correlation.ownership.orgId,
      workspaceId: sourceInput.correlation.ownership.workspaceId,
      capabilityId: sourceInput.routingDecision.capabilityId,
      capabilityVersion: sourceInput.routingDecision.capabilityVersion,
      requestHash: sourceInput.envelope.requestHash,
      envelopeHash: sourceInput.envelope.envelopeHash,
      workerHandoff: {
        envelopeId: sourceInput.envelope.envelopeId,
        payloadReference: sourceInput.envelope.payloadReference,
        dispatchContractVersion: "1",
      },
      status: "DISPATCHED",
      createdAt: sourceInput.correlation.scheduledAt,
    });
    await new ExecutionDispatchRepository().createDispatch(sourceDispatch);
    return { fixture, sourceInput, sourceDispatch };
  }

  it("converges concurrent commands to one successor and excludes the old Dispatch", async () => {
    const { sourceInput, sourceDispatch } = await prepare("bundle-supersession-concurrency");
    const repository = new AiStoryPreDispatchBundleSupersessionRepository();
    const sourceIdentity = {
      compiledRequestId: sourceInput.compiledProviderRequest.compiledRequestId,
      requestFingerprint: sourceInput.compiledProviderRequest.requestFingerprint,
      correlationId: sourceInput.correlation.correlationId,
      outboxJobId: sourceInput.outboxJob.jobId,
      dispatchId: sourceDispatch.dispatchId,
    };
    const loaded = await repository.loadSourceBundle({
      sceneExecutionId: sourceInput.correlation.sceneExecutionId,
      source: sourceIdentity,
    });
    expect(loaded.bundle.compiledProviderRequest.compiledRequestId).toBe(sourceIdentity.compiledRequestId);
    expect(loaded.dispatch.dispatchId).toBe(sourceIdentity.dispatchId);
    const successor = await successorFrom(loaded.bundle, loaded.dispatch, crypto.randomUUID());
    const command = {
      orgId: sourceInput.correlation.ownership.orgId,
      workspaceId: sourceInput.correlation.ownership.workspaceId,
      sceneExecutionId: sourceInput.correlation.sceneExecutionId,
      source: sourceIdentity,
      successor: successor.input,
      successorDispatch: successor.dispatch,
      reason: "I2V_PROVIDER_INPUT_PROJECTION_DEFECT" as const,
      actorUserId: PR32_USER_A,
      idempotencyKey: `supersede:${sourceDispatch.dispatchId}:projection-v2`,
      targetContractVersion: "i2v-provider-input-projection.v2",
    };
    const [left, right] = await Promise.all([
      repository.supersede(command),
      repository.supersede(command),
    ]);
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    expect(left.successor.dispatchId).toBe(successor.dispatch.dispatchId);

    const [counts] = await sqlClient<{
      supersessions: number; active_compiled: number; active_correlations: number;
      active_outbox: number; active_dispatch: number; attempts: number; reservations: number;
    }[]>`
      select
        (select count(*)::int from ai_story_pre_dispatch_bundle_supersessions where scene_execution_id = ${command.sceneExecutionId}) supersessions,
        (select count(*)::int from ai_story_compiled_provider_requests c where c.scene_execution_id = ${command.sceneExecutionId}
          and not exists (select 1 from ai_story_pre_dispatch_bundle_supersessions s where s.source_compiled_request_id = c.compiled_request_id)) active_compiled,
        (select count(*)::int from ai_story_scene_scheduling_correlations c where c.scene_execution_id = ${command.sceneExecutionId}
          and not exists (select 1 from ai_story_pre_dispatch_bundle_supersessions s where s.source_correlation_id = c.correlation_id)) active_correlations,
        (select count(*)::int from provider_outbox_jobs o join ai_story_scene_scheduling_correlations c on c.outbox_job_id = o.job_id
          where c.scene_execution_id = ${command.sceneExecutionId} and not exists (select 1 from ai_story_pre_dispatch_bundle_supersessions s where s.source_outbox_job_id = o.job_id)) active_outbox,
        (select count(*)::int from provider_execution_dispatches d join ai_story_scene_scheduling_correlations c on c.outbox_job_id = d.job_id
          where c.scene_execution_id = ${command.sceneExecutionId} and not exists (select 1 from ai_story_pre_dispatch_bundle_supersessions s where s.source_dispatch_id = d.dispatch_id)) active_dispatch,
        (select count(*)::int from provider_attempts a join ai_story_scene_scheduling_correlations c on c.provider_execution_id = a.execution_id where c.scene_execution_id = ${command.sceneExecutionId}) attempts,
        (select count(*)::int from certification_commercial_reservations r join ai_story_provider_attempt_compiled_bindings b on b.provider_attempt_id = r.execution_identity where b.scene_execution_id = ${command.sceneExecutionId}) reservations
    `;
    expect(counts).toEqual({
      supersessions: 1,
      active_compiled: 1,
      active_correlations: 1,
      active_outbox: 1,
      active_dispatch: 1,
      attempts: 0,
      reservations: 0,
    });

    const active = await new SceneSchedulingRepository().getCorrelationBySceneExecutionId(command.sceneExecutionId);
    expect(active?.correlationId).toBe(successor.input.correlation.correlationId);
    const oldRecovery = await new ExecutionDispatchRepository().previewAuthorizedRecoveryDispatch();
    expect(oldRecovery?.dispatchId).not.toBe(sourceDispatch.dispatchId);
  }, 120_000);

  for (const stage of ["successor_compile", "successor_bundle", "supersession"] as const) {
    it(`rolls back the complete successor after ${stage}`, async () => {
      const { sourceInput, sourceDispatch } = await prepare(`bundle-supersession-${stage}`);
      const successor = await successorFrom(sourceInput, sourceDispatch, crypto.randomUUID());
      await expect(new AiStoryPreDispatchBundleSupersessionRepository().supersede({
        orgId: sourceInput.correlation.ownership.orgId,
        workspaceId: sourceInput.correlation.ownership.workspaceId,
        sceneExecutionId: sourceInput.correlation.sceneExecutionId,
        source: {
          compiledRequestId: sourceInput.compiledProviderRequest.compiledRequestId,
          requestFingerprint: sourceInput.compiledProviderRequest.requestFingerprint,
          correlationId: sourceInput.correlation.correlationId,
          outboxJobId: sourceInput.outboxJob.jobId,
          dispatchId: sourceDispatch.dispatchId,
        },
        successor: successor.input,
        successorDispatch: successor.dispatch,
        reason: "DETERMINISTIC_PRE_DISPATCH_AUTHORITY_DEFECT",
        actorUserId: PR32_USER_A,
        idempotencyKey: `crash:${sourceDispatch.dispatchId}:${stage}`,
        targetContractVersion: "test.v2",
        testFailureAfter: stage,
      })).rejects.toThrow(`test failure after ${stage}`);
      const [counts] = await sqlClient<{ compiled: number; correlations: number; outbox: number; dispatches: number; supersessions: number }[]>`
        select
          (select count(*)::int from ai_story_compiled_provider_requests where compiled_request_id = ${successor.input.compiledProviderRequest.compiledRequestId}) compiled,
          (select count(*)::int from ai_story_scene_scheduling_correlations where correlation_id = ${successor.input.correlation.correlationId}) correlations,
          (select count(*)::int from provider_outbox_jobs where job_id = ${successor.input.outboxJob.jobId}) outbox,
          (select count(*)::int from provider_execution_dispatches where dispatch_id = ${successor.dispatch.dispatchId}) dispatches,
          (select count(*)::int from ai_story_pre_dispatch_bundle_supersessions where source_dispatch_id = ${sourceDispatch.dispatchId}) supersessions
      `;
      expect(counts).toEqual({ compiled: 0, correlations: 0, outbox: 0, dispatches: 0, supersessions: 0 });
    }, 120_000);
  }
});
