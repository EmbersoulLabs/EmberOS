/**
 * Sprint 3 PR 3.7 Phase D — Canonical Execute PostgreSQL integration.
 * Requires RUN_DB_INTEGRATION_TESTS=1 and DATABASE_URL.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  closeDb,
  RuntimeAuthorizationPersistenceRepository,
  canonicalPersistenceHash,
} from "@ceo-agent/db";
import { CanonicalExecuteRequestSchema } from "@ceo-agent/shared";
import { authorizeAndExecuteExecutionPlan } from "../packages/agents/src/ai-story/authorize-and-execute-execution-plan";
import { CanonicalExecuteError } from "../packages/agents/src/ai-story/authorize-and-execute-execution-plan";
import { createCanonicalExecuteProviderRouter } from "../packages/agents/src/ai-story/canonical-execute-router";
import { RuntimeAuthorizationService } from "../packages/agents/src/ai-story/runtime-authorization-service";
import { PHASE_2A_IDS, PHASE_2A_WORKSPACE_B_IDS } from "./helpers/ai-story-phase-2a";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { applyPhaseECommercialSql } from "./helpers/commercial-phase-e-sql";
import {
  cleanupPr32Tenant,
  FixedSeedanceRouter,
  PR32_USER_A,
  seedPr32Tenant,
} from "./helpers/ai-story-pr32-scheduling";
import { prepareReadyForCanonicalExecute } from "./helpers/ai-story-pr37-phase-d-execute";

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

async function countAuthority(
  sql: Sql,
  executionPlanId: string,
  workspaceId: string
) {
  const auth = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM ai_story_runtime_authorized_facts
    WHERE execution_plan_id = ${executionPlanId}
  `;
  const routing = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM ai_story_scene_routing_decisions
    WHERE execution_plan_id = ${executionPlanId}
  `;
  const pe = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM provider_executions
    WHERE workspace_id = ${workspaceId}
  `;
  const envelopes = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM provider_execution_envelopes
    WHERE workspace_id = ${workspaceId}
  `;
  const outbox = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM provider_outbox_jobs j
    JOIN provider_executions e ON e.execution_id = j.execution_id
    WHERE e.workspace_id = ${workspaceId}
  `;
  return {
    auth: auth[0]?.c ?? 0,
    routing: routing[0]?.c ?? 0,
    pe: pe[0]?.c ?? 0,
    envelopes: envelopes[0]?.c ?? 0,
    outbox: outbox[0]?.c ?? 0,
  };
}

describeIntegration("Sprint 3 PR 3.7 Phase D Canonical Execute (Postgres)", () => {
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
      "../packages/db/sql/provider-execution-dispatch.sql",
      "../packages/db/sql/ai-story-scene-scheduling-v1.sql",
      "../packages/db/sql/ai-story-scene-routing-router-version-v1.sql",
      "../packages/db/sql/ai-story-scene-scheduling-rls-v1.sql",
    ]) {
      await applySqlFile(sql, relative);
    }
    await applyPhaseECommercialSql(sql);
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr37d");
  }, 180_000);

  afterAll(async () => {
    await cleanupPr32Tenant(sql);
    await cleanupPr32Tenant(sql, PHASE_2A_WORKSPACE_B_IDS);
    await sql.end();
    await closeDb();
  }, 60_000);

  async function reset(label: string) {
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, label);
  }

  it("1: single-scene Execute authorizes + schedules exactly once", async () => {
    await reset("d-single");
    const ready = await prepareReadyForCanonicalExecute({
      purpose: "d-single",
      sceneOrder: [0],
    });
    const first = await authorizeAndExecuteExecutionPlan({
      executionPlanId: ready.executionPlanId,
      actorUserId: ready.userId,
      ownership: ready.ownership,
      router: new FixedSeedanceRouter(),
    });
    expect(first.httpStatus).toBe(202);
    expect(first.response.scheduledSceneCount).toBe(1);
    const counts = await countAuthority(
      sql,
      ready.executionPlanId,
      PHASE_2A_IDS.workspaceId
    );
    expect(counts).toEqual({
      auth: 1,
      routing: 1,
      pe: 1,
      envelopes: 1,
      outbox: 1,
    });
  }, 120_000);

  it("2: multi-scene Execute schedules all required scenes", async () => {
    await reset("d-multi");
    const ready = await prepareReadyForCanonicalExecute({
      purpose: "d-multi",
      sceneOrder: [0, 1],
    });
    const result = await authorizeAndExecuteExecutionPlan({
      executionPlanId: ready.executionPlanId,
      actorUserId: ready.userId,
      ownership: ready.ownership,
      router: createCanonicalExecuteProviderRouter({
        router: new FixedSeedanceRouter(),
      }),
    });
    expect(result.response.scheduledSceneCount).toBe(2);
    const counts = await countAuthority(
      sql,
      ready.executionPlanId,
      PHASE_2A_IDS.workspaceId
    );
    expect(counts.auth).toBe(1);
    expect(counts.routing).toBe(2);
    expect(counts.pe).toBe(2);
    expect(counts.envelopes).toBe(2);
    expect(counts.outbox).toBe(2);
  }, 120_000);

  it("3: duplicate Execute converges identities", async () => {
    await reset("d-dup");
    const ready = await prepareReadyForCanonicalExecute({
      purpose: "d-dup",
      sceneOrder: [0],
    });
    const first = await authorizeAndExecuteExecutionPlan({
      executionPlanId: ready.executionPlanId,
      actorUserId: ready.userId,
      ownership: ready.ownership,
      router: new FixedSeedanceRouter(),
    });
    const second = await authorizeAndExecuteExecutionPlan({
      executionPlanId: ready.executionPlanId,
      actorUserId: ready.userId,
      ownership: ready.ownership,
      router: new FixedSeedanceRouter(),
    });
    expect(second.httpStatus).toBe(200);
    expect(second.response.runtimeAuthorizationId).toBe(
      first.response.runtimeAuthorizationId
    );
    expect(second.response.converged).toBe(true);
    const counts = await countAuthority(
      sql,
      ready.executionPlanId,
      PHASE_2A_IDS.workspaceId
    );
    expect(counts).toEqual({
      auth: 1,
      routing: 1,
      pe: 1,
      envelopes: 1,
      outbox: 1,
    });
  }, 120_000);

  it("4: 10-way concurrent Execute → one fact / required schedules", async () => {
    await reset("d-conc");
    const ready = await prepareReadyForCanonicalExecute({
      purpose: "d-conc",
      sceneOrder: [0, 1],
    });
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        authorizeAndExecuteExecutionPlan({
          executionPlanId: ready.executionPlanId,
          actorUserId: ready.userId,
          ownership: ready.ownership,
          router: new FixedSeedanceRouter(),
        })
      )
    );
    const authIds = new Set(results.map((r) => r.response.runtimeAuthorizationId));
    expect(authIds.size).toBe(1);
    const counts = await countAuthority(
      sql,
      ready.executionPlanId,
      PHASE_2A_IDS.workspaceId
    );
    expect(counts.auth).toBe(1);
    expect(counts.routing).toBe(2);
    expect(counts.pe).toBe(2);
    expect(counts.envelopes).toBe(2);
    expect(counts.outbox).toBe(2);
  }, 180_000);

  it("5-8: negative matrix — no authority writes", async () => {
    await reset("d-neg");
    const ready = await prepareReadyForCanonicalExecute({
      purpose: "d-neg",
      sceneOrder: [0],
    });

    // foreign workspace ownership
    await expect(
      authorizeAndExecuteExecutionPlan({
        executionPlanId: ready.executionPlanId,
        actorUserId: ready.userId,
        ownership: {
          ...ready.ownership,
          workspaceId: PHASE_2A_WORKSPACE_B_IDS.workspaceId,
        },
        router: new FixedSeedanceRouter(),
      })
    ).rejects.toBeTruthy();

    // unapproved review
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "d-unapproved");
    const compiled = await prepareReadyForCanonicalExecute({
      purpose: "d-unapproved-base",
      sceneOrder: [0],
    });
    // wipe story decision by creating fresh plan without story approve:
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "d-review");
    const {
      AiStorySceneExecutionPersistenceRepository,
      ExecutionPlanReviewRepository,
    } = await import("@ceo-agent/db");
    const { makePhase2aCompilation } = await import("./helpers/ai-story-phase-2a");
    const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({
        ids: PHASE_2A_IDS,
        instructionPurpose: `d-review-${crypto.randomUUID()}`,
        sceneOrder: [0],
      })
    );
    const planId = persisted.plan.storyExecutionId;
    const scenes = persisted.intents.map((i) => i.identity.sceneExecutionId);
    const review = new ExecutionPlanReviewRepository();
    await review.openReview({ executionPlanId: planId, openedBy: PR32_USER_A });
    for (const sceneExecutionId of scenes) {
      await review.appendSceneIntentDecision({
        executionPlanId: planId,
        sceneExecutionId,
        decision: "APPROVED",
        reviewedBy: PR32_USER_A,
      });
    }
    // no story decision / no assembly
    await expect(
      authorizeAndExecuteExecutionPlan({
        executionPlanId: planId,
        actorUserId: PR32_USER_A,
        ownership: {
          orgId: PHASE_2A_IDS.orgId,
          workspaceId: PHASE_2A_IDS.workspaceId,
          campaignId: PHASE_2A_IDS.campaignId,
          storyId: PHASE_2A_IDS.storyId,
          storyVersionId: PHASE_2A_IDS.storyVersionId,
          animationPackageId: PHASE_2A_IDS.animationPackageId,
          executionPlanId: planId,
        },
        router: new FixedSeedanceRouter(),
      })
    ).rejects.toMatchObject({ code: expect.stringMatching(/REVIEW|NOT_READY|ASSEMBLY/) });

    const counts = await countAuthority(sql, planId, PHASE_2A_IDS.workspaceId);
    expect(counts.auth).toBe(0);
    expect(counts.pe).toBe(0);
    expect(counts.envelopes).toBe(0);
    expect(counts.outbox).toBe(0);

    void ready;
    void compiled;
  }, 180_000);

  it("9: conflicting RuntimeAuthorization fails closed", async () => {
    await reset("d-conflict");
    const ready = await prepareReadyForCanonicalExecute({
      purpose: "d-conflict",
      sceneOrder: [0],
    });
    // Seed a conflicting fact with different QC identity.
    const review = await new (
      await import("@ceo-agent/db")
    ).ExecutionPlanReviewRepository().getLogicalProjection(ready.executionPlanId);
    const issued = new RuntimeAuthorizationService().authorize({
      ownership: ready.ownership,
      reviewDecisionId: review!.storyDecision!.factId,
      reviewHash: review!.storyDecision!.deterministicFingerprint,
      reviewDecision: "APPROVED",
      assemblyDefinitionId: ready.assembly.definition.assemblyDefinitionId,
      assemblyHash: ready.assembly.definition.deterministicFingerprint,
      orderedSceneExecutionIds: ready.sceneExecutionIds,
      qcResults: ready.sceneExecutionIds.map((sceneExecutionId, index) => ({
        qcResultId: crypto.randomUUID(),
        sceneExecutionId,
        status: "passed" as const,
        resultHash: canonicalPersistenceHash({
          conflict: true,
          sceneExecutionId,
          index,
        }),
      })),
      authorizedBy: ready.userId,
      authorizedAt: "2026-08-04T12:00:00.000Z",
      derivedReadiness: "READY_FOR_EXECUTION",
    });
    await new RuntimeAuthorizationPersistenceRepository().acceptOrReturn(issued.fact);

    await expect(
      authorizeAndExecuteExecutionPlan({
        executionPlanId: ready.executionPlanId,
        actorUserId: ready.userId,
        ownership: ready.ownership,
        router: new FixedSeedanceRouter(),
      })
    ).rejects.toBeTruthy();

    const counts = await countAuthority(
      sql,
      ready.executionPlanId,
      PHASE_2A_IDS.workspaceId
    );
    expect(counts.auth).toBe(1);
    expect(counts.pe).toBe(0);
    expect(counts.outbox).toBe(0);
  }, 120_000);

  it("10: scheduling replay converges after first Execute", async () => {
    await reset("d-replay");
    const ready = await prepareReadyForCanonicalExecute({
      purpose: "d-replay",
      sceneOrder: [0],
    });
    await authorizeAndExecuteExecutionPlan({
      executionPlanId: ready.executionPlanId,
      actorUserId: ready.userId,
      ownership: ready.ownership,
      router: new FixedSeedanceRouter(),
    });
    const replay = await authorizeAndExecuteExecutionPlan({
      executionPlanId: ready.executionPlanId,
      actorUserId: ready.userId,
      ownership: ready.ownership,
      router: new FixedSeedanceRouter(),
    });
    expect(replay.response.runtimeStatus).toBe("ALREADY_AUTHORIZED_AND_SCHEDULED");
    expect(replay.response.scheduledSceneCount).toBe(1);
  }, 120_000);

  it("request schema rejects injection fields", () => {
    expect(CanonicalExecuteRequestSchema.safeParse({ providerId: "x" }).success).toBe(
      false
    );
    expect(
      CanonicalExecuteRequestSchema.safeParse({ runtimeAuthorizationId: "x" }).success
    ).toBe(false);
    expect(CanonicalExecuteRequestSchema.safeParse({}).success).toBe(true);
  });

  it("rejected review denies Execute with zero PE/Outbox", async () => {
    await reset("d-rej");
    const {
      AiStorySceneExecutionPersistenceRepository,
      ExecutionPlanReviewRepository,
    } = await import("@ceo-agent/db");
    const { makePhase2aCompilation } = await import("./helpers/ai-story-phase-2a");
    const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({
        ids: PHASE_2A_IDS,
        instructionPurpose: `d-rej-${crypto.randomUUID()}`,
        sceneOrder: [0],
      })
    );
    const planId = persisted.plan.storyExecutionId;
    const scenes = persisted.intents.map((i) => i.identity.sceneExecutionId);
    const review = new ExecutionPlanReviewRepository();
    await review.openReview({ executionPlanId: planId, openedBy: PR32_USER_A });
    // Approve scenes then reject story → REJECTED logical status without Assembly.
    for (const sceneExecutionId of scenes) {
      await review.appendSceneIntentDecision({
        executionPlanId: planId,
        sceneExecutionId,
        decision: "APPROVED",
        reviewedBy: PR32_USER_A,
      });
    }
    await review.appendStoryDecision({
      executionPlanId: planId,
      decision: "REJECTED",
      reviewedBy: PR32_USER_A,
    });
    await expect(
      authorizeAndExecuteExecutionPlan({
        executionPlanId: planId,
        actorUserId: PR32_USER_A,
        ownership: {
          orgId: PHASE_2A_IDS.orgId,
          workspaceId: PHASE_2A_IDS.workspaceId,
          campaignId: PHASE_2A_IDS.campaignId,
          storyId: PHASE_2A_IDS.storyId,
          storyVersionId: PHASE_2A_IDS.storyVersionId,
          animationPackageId: PHASE_2A_IDS.animationPackageId,
          executionPlanId: planId,
        },
        router: new FixedSeedanceRouter(),
      })
    ).rejects.toBeInstanceOf(CanonicalExecuteError);

    const counts = await countAuthority(sql, planId, PHASE_2A_IDS.workspaceId);
    expect(counts.auth).toBe(0);
    expect(counts.pe).toBe(0);
    expect(counts.outbox).toBe(0);
  }, 120_000);
});
