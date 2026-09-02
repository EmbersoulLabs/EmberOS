import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { createExecutionDispatch } from "@ceo-agent/shared";
import {
  ExecutionDispatchRepository,
  PostTerminalProviderRetryRepository,
  SceneSchedulingRepository,
  closeDb,
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

function fixtureIds(): Phase2aIdSet {
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

describeIntegration("AI Story post-terminal Provider retry PostgreSQL authority", () => {
  let sqlClient: Sql;
  const cleanup: Phase2aIdSet[] = [];

  beforeAll(async () => {
    sqlClient = createIntegrationSql();
    await sqlClient.unsafe(
      readFileSync(
        resolve(
          __dirname,
          "../packages/db/sql/ai-story-post-terminal-provider-retry-v1.sql"
        ),
        "utf8"
      )
    );
  }, 120_000);

  afterAll(async () => {
    for (const ids of cleanup) await cleanupPr32Tenant(sqlClient, ids);
    await sqlClient.end();
    await closeDb();
  }, 120_000);

  async function prepareTerminalSource(label: string) {
    const ids = fixtureIds();
    cleanup.push(ids);
    await seedPr32Tenant(sqlClient, ids, PR32_USER_A, label);
    const plan = await prepareAuthorizedSchedulingPlan({ purpose: label, ids });
    const schedule = await captureScheduleAcceptedBundleInput({
      executionPlanId: plan.executionPlanId,
      sceneExecutionId: plan.sceneExecutionIds[0]!,
      runtimeAuthorizationId: plan.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: plan.commercialAuthorizationId!,
      actorUserId: PR32_USER_A,
      router: new FixedSeedanceRouter(),
    });
    await new SceneSchedulingRepository().scheduleAcceptedBundle(schedule);
    const dispatch = await createExecutionDispatch({
      version: "1",
      dispatchId: `dispatch:${crypto.randomUUID()}`,
      jobId: schedule.outboxJob.jobId,
      executionId: schedule.providerExecution.identity.executionId,
      envelopeId: schedule.envelope.envelopeId,
      payloadReference: schedule.envelope.payloadReference,
      correlationId: schedule.correlation.correlationId,
      tenantId: ids.orgId,
      workspaceId: ids.workspaceId,
      capabilityId: schedule.routingDecision.capabilityId,
      capabilityVersion: schedule.routingDecision.capabilityVersion,
      requestHash: schedule.requestHash,
      envelopeHash: schedule.envelope.envelopeHash,
      workerHandoff: {
        envelopeId: schedule.envelope.envelopeId,
        payloadReference: schedule.envelope.payloadReference,
        dispatchContractVersion: "1",
      },
      status: "DISPATCHED",
      createdAt: schedule.correlation.scheduledAt,
    });
    await new ExecutionDispatchRepository().createDispatch(dispatch);

    const scopeId = crypto.randomUUID();
    const pricingId = crypto.randomUUID();
    const reservationId = crypto.randomUUID();
    const attemptId = `attempt:${crypto.randomUUID()}`;
    const workerResultId = crypto.randomUUID();
    const now = "2026-09-02T01:00:00.000Z";
    await sqlClient`
      insert into certification_commercial_scopes
        (certification_scope_id,environment,org_id,workspace_id,capability_key,status,
         max_provider_cost_usd,max_provider_submissions,spent_provider_cost_usd,
         reserved_provider_cost_usd,consumed_provider_submissions,reserved_provider_submissions,
         created_by,reason,created_at,integrity_hash,contract_version,scope_body)
      values (${scopeId},'STAGING',${ids.orgId},${ids.workspaceId},'ai_story.execute','ACTIVE',
        5,4,0.36,0,2,0,${PR32_USER_A},'test',${now},${`scope:${scopeId}`},'1',${sqlClient.json({})})
    `;
    await sqlClient`
      insert into provider_usd_pricing_rules
        (provider_usd_pricing_rule_id,provider_key,model_id,generation_mode,duration_seconds,
         aspect_ratio,resolution,currency,input_video_included,output_width_pixels,
         output_height_pixels,output_frame_rate,usd_per_million_tokens,cost_basis,source_url,
         version,effective_from,created_by,created_at,integrity_hash,contract_version,pricing_body)
      values (${pricingId},'seedance','dreamina-seedance-2-0-260128','FIRST_FRAME_IMAGE_TO_VIDEO',
        5,'9:16','480p','USD',false,480,854,24,0.69,'flat','https://example.invalid','1',
        ${now},${PR32_USER_A},${now},${`pricing:${pricingId}`},'1',${sqlClient.json({})})
    `;
    await sqlClient`
      insert into certification_commercial_reservations
        (certification_reservation_id,certification_scope_id,provider_usd_pricing_rule_id,
         org_id,workspace_id,execution_identity,reserved_cost_usd,settled_cost_usd,status,
         created_at,submitted_at,released_at,integrity_hash,contract_version,reservation_body)
      values (${reservationId},${scopeId},${pricingId},${ids.orgId},${ids.workspaceId},${attemptId},
        0.69,0,'RELEASED',${now},${now},${now},${`reservation:${reservationId}`},'1',${sqlClient.json({})})
    `;
    await sqlClient`
      insert into provider_attempts
        (attempt_id,execution_id,contract_version,attempt_number,provider_id,provider_version,
         model_version,request_hash,status,created_at)
      values (${attemptId},${schedule.providerExecution.identity.executionId},'1',1,'seedance','1.0.0',
        'dreamina-seedance-2-0-260128',${schedule.requestHash},'PENDING',${now})
    `;
    await sqlClient`
      insert into ai_story_provider_attempt_compiled_bindings
        (provider_attempt_id,compiled_request_id,org_id,workspace_id,scene_execution_id,
         idempotency_key,request_fingerprint,attempt_input_fingerprint,status,binding,created_at,updated_at)
      values (${attemptId},${schedule.compiledProviderRequest.compiledRequestId},${ids.orgId},
        ${ids.workspaceId},${schedule.correlation.sceneExecutionId},${`binding:${attemptId}`},
        ${schedule.compiledProviderRequest.requestFingerprint},${`input:${attemptId}`},'FAILED',
        ${sqlClient.json({})},${now},${now})
    `;
    const workerFact = {
      failureClassification: {
        code: "PROVIDER_NOT_ACCEPTED",
        retryable: false,
        terminal: true,
        reconciliationRequired: false,
        sanitizedMessage: "Provider rejected the request",
      },
    };
    await sqlClient`
      insert into ai_story_worker_execution_results
        (worker_execution_result_id,org_id,workspace_id,provider_execution_id,provider_attempt_id,
         dispatch_id,outbox_job_id,routing_decision_id,provider_id,adapter_version,router_version,
         worker_state,acceptance_classification,canonical_provider_state,reconciliation_required,
         deterministic_integrity_hash,worker_contract_version,result,produced_at)
      values (${workerResultId},${ids.orgId},${ids.workspaceId},${schedule.providerExecution.identity.executionId},
        ${attemptId},${dispatch.dispatchId},${schedule.outboxJob.jobId},${schedule.routingDecision.routingDecisionId},
        'seedance','1.0.0',1,'NOT_ACCEPTED','NOT_ACCEPTED','NOT_ACCEPTED',false,
        ${`worker:${workerResultId}`},'1',${sqlClient.json(workerFact)},${now})
    `;
    return { ids, plan, schedule, attemptId, workerResultId };
  }

  it("converges concurrent explicit human authorization and retains immutable history", async () => {
    const source = await prepareTerminalSource("post-terminal-concurrency");
    const command = {
      executionPlanId: source.plan.executionPlanId,
      sceneExecutionId: source.schedule.correlation.sceneExecutionId,
      workspaceId: source.ids.workspaceId,
      priorProviderAttemptId: source.attemptId,
      priorWorkerResultId: source.workerResultId,
      sourceCompiledRequestId:
        source.schedule.compiledProviderRequest.compiledRequestId,
      sourceCompiledRequestFingerprint:
        source.schedule.compiledProviderRequest.requestFingerprint,
      commercialAuthorizationId: source.plan.commercialAuthorizationId!,
      actorUserId: PR32_USER_A,
      humanDecision: "AUTHORIZE_ONE_RETRY" as const,
      failureClassification:
        "STAGING_SEEDANCE_FIRST_FRAME_I2V_MIXED_REFERENCE_ROLE_WIRE_CONTRACT_MISMATCH" as const,
      targetCompilerContractVersion:
        "seedance-first-frame-i2v-wire.v1" as const,
    };
    const repository = new PostTerminalProviderRetryRepository();
    const [left, right] = await Promise.all([
      repository.authorize(command),
      repository.authorize(command),
    ]);
    expect(left.authorizationId).toBe(right.authorizationId);
    expect(left.retryGeneration).toBe(2);
    const [counts] = await sqlClient<{
      authorizations: number;
      attempts: number;
      reservations: number;
      scene_results: number;
    }[]>`
      select
        (select count(*)::int from ai_story_post_terminal_provider_retry_authorizations where scene_execution_id=${command.sceneExecutionId}) authorizations,
        (select count(*)::int from provider_attempts where attempt_id=${source.attemptId}) attempts,
        (select count(*)::int from certification_commercial_reservations where execution_identity=${source.attemptId}) reservations,
        (select count(*)::int from ai_story_scene_results where provider_attempt_id=${source.attemptId}) scene_results
    `;
    expect(counts).toEqual({
      authorizations: 1,
      attempts: 1,
      reservations: 1,
      scene_results: 0,
    });
    await expect(
      sqlClient`update ai_story_post_terminal_provider_retry_authorizations set retry_reason='tamper' where authorization_id=${left.authorizationId}`
    ).rejects.toThrow(/IMMUTABLE/);
  }, 120_000);
});
