import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { SceneSchedulingCoordinator } from "../packages/agents/src/ai-story/scene-scheduling-coordinator";
import {
  AI_STORY_PRODUCTION_VERIFICATION_POLICY_VERSION,
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
  cleanupPr32Tenant,
  prepareAuthorizedSchedulingPlan,
  seedPr32Tenant,
} from "./helpers/ai-story-pr32-scheduling";

const integrationDbUrl = getIntegrationDbUrl();
if (RUN_DB_INTEGRATION && !integrationDbUrl) {
  throw new Error("DATABASE_URL is required when RUN_DB_INTEGRATION_TESTS=1");
}
const describeIntegration = RUN_DB_INTEGRATION ? describe : describe.skip;

function freshIds(): Phase2aIdSet {
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

describeIntegration("PROD-VERIFY scene scheduling timeout boundary", () => {
  let sql: Sql;
  const ids = freshIds();

  beforeAll(async () => {
    sql = createIntegrationSql();
    await seedPr32Tenant(sql, ids, PR32_USER_A, "prod-verify-scheduling");
  }, 60_000);

  afterAll(async () => {
    await cleanupPr32Tenant(sql, ids);
    await sql.end();
    await closeDb();
  }, 60_000);

  it("persists a three-scene terminal verification schedule with one max-one transaction", async () => {
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "production-verification-post-release",
      ids,
      sceneOrder: [0, 1, 2],
      skipCommercialAuthorization: true,
    });
    const sceneExecutionId = prepared.sceneExecutionIds[0]!;
    const timings: Array<{ step: string; durationMs: number }> = [];
    let boundary: {
      connectionAcquireCount: number;
      transactionCount: number;
      secondCheckoutAttempts: number;
      serialDbRoundTripCount: number;
      poolWaitMs: number;
      commitMs: number;
    } | null = null;
    const startedAt = performance.now();
    const bundle = await new SceneSchedulingCoordinator({
      router: new FixedSeedanceRouter(),
    }).scheduleAuthorizedScene({
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId,
      runtimeAuthorizationId: prepared.acceptedAuthorization.runtimeAuthorizationId,
      actorUserId: PR32_USER_A,
      executionAuthorization: {
        allowed: true,
        accessMode: "ops",
        settlementMode: "none",
        authorizedBy: "ACTIVE_PLATFORM_ADMIN",
        policyVersion: "ai-story-exec-03.v1",
        reason: "production-like-zero-provider-boundary",
        providerCostAccounting: "ALLOWED",
      },
      productionVerification: {
        verificationMode: true,
        verificationPolicyVersion:
          AI_STORY_PRODUCTION_VERIFICATION_POLICY_VERSION,
        authorizedBy: "ACTIVE_PLATFORM_ADMIN",
        createdBy: PR32_USER_A,
      },
      observeTiming: (value) => timings.push(value),
      observePersistenceBoundary: (value) => {
        boundary = value;
      },
    });
    const durationMs = performance.now() - startedAt;

    const [state] = await sql<{
      provider_id: string | null;
      release_count: number;
      released_count: number;
      held_count: number;
      verification_count: number;
      correlation_count: number;
      outbox_count: number;
      outbox_status: string | null;
      provider_attempt_count: number;
    }[]>`
      SELECT
        (SELECT selected_provider_id FROM ai_story_scene_routing_decisions
          WHERE scene_execution_id = ${sceneExecutionId} LIMIT 1) AS provider_id,
        (SELECT count(*)::int FROM ai_story_scene_release_states
          WHERE execution_plan_id = ${prepared.executionPlanId}) AS release_count,
        (SELECT count(*)::int FROM ai_story_scene_release_states
          WHERE execution_plan_id = ${prepared.executionPlanId}
            AND release_state = 'RELEASED') AS released_count,
        (SELECT count(*)::int FROM ai_story_scene_release_states
          WHERE execution_plan_id = ${prepared.executionPlanId}
            AND release_state = 'AUTHORIZED_NOT_RELEASED') AS held_count,
        (SELECT count(*)::int FROM ai_story_execute_verifications
          WHERE execution_plan_id = ${prepared.executionPlanId}) AS verification_count,
        (SELECT count(*)::int FROM ai_story_scene_scheduling_correlations
          WHERE execution_plan_id = ${prepared.executionPlanId}) AS correlation_count,
        (SELECT count(*)::int FROM provider_outbox_jobs
          WHERE job_id = ${bundle.outboxJobId}) AS outbox_count,
        (SELECT status FROM provider_outbox_jobs
          WHERE job_id = ${bundle.outboxJobId}) AS outbox_status,
        (SELECT count(*)::int FROM provider_attempts
          WHERE execution_id = ${bundle.providerExecutionId}) AS provider_attempt_count
    `;

    expect(state).toEqual({
      provider_id: "seedance",
      release_count: 3,
      released_count: 1,
      held_count: 2,
      verification_count: 1,
      correlation_count: 1,
      outbox_count: 1,
      outbox_status: "CANCELLED",
      provider_attempt_count: 0,
    });
    expect(boundary).toMatchObject({
      connectionAcquireCount: 1,
      transactionCount: 1,
      secondCheckoutAttempts: 0,
      serialDbRoundTripCount: 9,
    });
    expect([...new Set(timings.map((value) => value.step))]).toEqual(
      expect.arrayContaining([
        "release_state_load",
        "routing_decision_write",
        "verification_identity_write",
        "scheduling_correlation_write",
        "verification_outbox_write",
        "transaction_commit",
      ])
    );
    expect(durationMs).toBeLessThan(15_000);
    console.info(JSON.stringify({
      event: "AI_STORY_POST_RELEASE_SCHEDULING_INTEGRATION_PROOF",
      durationMs,
      boundary,
      timings,
      providerId: state?.provider_id,
      releaseCount: state?.release_count,
      releasedCount: state?.released_count,
      heldCount: state?.held_count,
      outboxStatus: state?.outbox_status,
      providerAttemptCount: state?.provider_attempt_count,
    }));
  }, 120_000);
});
