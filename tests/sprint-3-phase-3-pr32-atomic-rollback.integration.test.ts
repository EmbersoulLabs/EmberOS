/**
 * Sprint 3 PR 3.2 — Scene Scheduling atomic rollback integration tests.
 * Live DB only; skips unless RUN_DB_INTEGRATION_TESTS=1.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  SceneSchedulingRepository,
  closeDb,
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

const FAILURE_STAGES = [
  "runtime_authorization",
  "routing_decision",
  "compiled_request",
  "provider_execution",
  "outbox",
  "envelope",
  "correlation",
] as const;

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

async function countSchedulingRows(sql: Sql, input: ScheduleAcceptedBundleInput) {
  const rows = await sql<{
    auth_count: number;
    routing_count: number;
    provider_count: number;
    envelope_count: number;
    outbox_count: number;
    correlation_count: number;
    compiled_request_count: number;
  }[]>`
    SELECT
      (SELECT count(*)::int FROM ai_story_runtime_authorized_facts
        WHERE runtime_authorization_id = ${input.runtimeAuthorizedFact.runtimeAuthorizationId}) AS auth_count,
      (SELECT count(*)::int FROM ai_story_scene_routing_decisions
        WHERE scene_execution_id = ${input.routingDecision.sceneExecutionId}) AS routing_count,
      (SELECT count(*)::int FROM provider_executions
        WHERE execution_id = ${input.providerExecution.identity.executionId}) AS provider_count,
      (SELECT count(*)::int FROM provider_execution_envelopes
        WHERE envelope_id = ${input.envelope.envelopeId}) AS envelope_count,
      (SELECT count(*)::int FROM provider_outbox_jobs
        WHERE job_id = ${input.outboxJob.jobId}) AS outbox_count,
      (SELECT count(*)::int FROM ai_story_scene_scheduling_correlations
        WHERE correlation_id = ${input.correlation.correlationId}) AS correlation_count,
      (SELECT count(*)::int FROM ai_story_compiled_provider_requests
        WHERE compiled_request_id = ${input.compiledProviderRequest.compiledRequestId}) AS compiled_request_count
  `;
  return rows[0]!;
}

describeIntegration("Sprint 3 PR 3.2 scene scheduling atomic rollback", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createIntegrationSql();
    for (const relative of [
      "../packages/db/sql/ai-story-scene-execution-persistence-v1.sql",
      "../packages/db/sql/ai-story-human-review-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-definition-persistence-v1.sql",
      "../packages/db/sql/provider-ledger.sql",
      "../packages/db/sql/provider-outbox.sql",
      "../packages/db/sql/provider-execution-envelope.sql",
      "../packages/db/sql/ai-story-scene-scheduling-v1.sql",
      "../packages/db/sql/ai-story-scene-routing-router-version-v1.sql",
      "../packages/db/sql/ai-story-scene-scheduling-rls-v1.sql",
      "../packages/db/sql/ai-story-staged-release-v1.sql",
      "../packages/db/sql/ai-story-provider-runtime-v1.sql",
      "../packages/db/sql/commercial-persistence-v1.sql",
      "../packages/db/sql/credits-settlement-v1.sql",
      "../packages/db/sql/commercial-authorization-v1.sql",
    ]) {
      await applySqlFile(sql, relative);
    }
  }, 120_000);

  afterAll(async () => {
    await sql.end();
    await closeDb();
  }, 60_000);

  for (const stage of FAILURE_STAGES) {
    it(`rolls back all six scheduling families after ${stage}`, async () => {
      const ids = freshIds();
      await seedPr32Tenant(sql, ids, PR32_USER_A, `pr32-rollback-${stage}`);
      try {
        const prepared = await prepareAuthorizedSchedulingPlan({
          purpose: `rollback-${stage}`,
          ids,
        });
        const captured = await captureScheduleAcceptedBundleInput({
          executionPlanId: prepared.executionPlanId,
          sceneExecutionId: prepared.sceneExecutionIds[0]!,
          runtimeAuthorizationId:
            prepared.issuedAuthorization.runtimeAuthorizationId,
          commercialAuthorizationId: prepared.commercialAuthorizationId!,
          actorUserId: PR32_USER_A,
          router: new FixedSeedanceRouter(),
        });
        expect(await countSchedulingRows(sql, captured)).toEqual({
          auth_count: 1,
          routing_count: 0,
          provider_count: 0,
          envelope_count: 0,
          outbox_count: 0,
          correlation_count: 0,
          compiled_request_count: 0,
        });

        await expect(
          new SceneSchedulingRepository().scheduleAcceptedBundle({
            ...captured,
            testFailureAfter: stage,
          })
        ).rejects.toMatchObject({
          code: "IDENTITY_CONFLICT",
          message: `test failure after ${stage}`,
        });

        expect(await countSchedulingRows(sql, captured)).toEqual({
          auth_count: 1,
          routing_count: 0,
          provider_count: 0,
          envelope_count: 0,
          outbox_count: 0,
          correlation_count: 0,
          compiled_request_count: 0,
        });
      } finally {
        await cleanupPr32Tenant(sql, ids);
      }
    }, 120_000);
  }
});
