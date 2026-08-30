/**
 * Sprint 3 PR 3.7 Phase D — Final HTTP Security Evidence Gate.
 *
 * Harness: vitest.integration.config.ts + RUN_DB_INTEGRATION_TESTS=1 + DATABASE_URL.
 * Mocks ONLY requireAuth identity (+ agents barrel shim for vitest resolution).
 * Real requireWorkspaceRole, ownership resolver, PostgreSQL, and the Execute route.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import {
  AiStorySceneExecutionPersistenceRepository,
  ExecutionPlanAssemblyRepository,
  ExecutionPlanReviewRepository,
  closeDb,
} from "@ceo-agent/db";
import { PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { applyPhaseECommercialSql } from "./helpers/commercial-phase-e-sql";
import { applyProductionLikeVideoRoutingEnv } from "./helpers/ai-story-prod-fix-01-env";
import {
  makePhase2aCompilation,
  type Phase2aIdSet,
} from "./helpers/ai-story-phase-2a";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

const OPERATOR_A = "31000000-0000-4000-8000-000000000040";
const VIEWER_A = "31000000-0000-4000-8000-000000000041";
const OPERATOR_B = "41000000-0000-4000-8000-000000000040";

const GATE_A: Phase2aIdSet = {
  orgId: "31000000-0000-4000-8000-000000000001",
  workspaceId: "31000000-0000-4000-8000-000000000002",
  campaignId: "31000000-0000-4000-8000-000000000003",
  storyId: "31000000-0000-4000-8000-000000000004",
  storyVersionId: "31000000-0000-4000-8000-000000000005",
  animationPackageId: "31000000-0000-4000-8000-000000000006",
  assetId: "31000000-0000-4000-8000-000000000007",
};

const GATE_B: Phase2aIdSet = {
  orgId: "41000000-0000-4000-8000-000000000001",
  workspaceId: "41000000-0000-4000-8000-000000000002",
  campaignId: "41000000-0000-4000-8000-000000000003",
  storyId: "41000000-0000-4000-8000-000000000004",
  storyVersionId: "41000000-0000-4000-8000-000000000005",
  animationPackageId: "41000000-0000-4000-8000-000000000006",
  assetId: "41000000-0000-4000-8000-000000000007",
};

const FORBIDDEN_RESPONSE_KEYS = [
  "providerId",
  "adapterVersion",
  "providerRequestId",
  "routingDecisionId",
  "providerExecutionId",
  "outboxJobId",
  "dispatchId",
  "workerAttemptId",
  "apiKey",
  "credentials",
  "signedUrl",
] as const;

const requireAuth = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getAuthUser: vi.fn(),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../apps/web/src/lib/auth")>(
    "../apps/web/src/lib/auth"
  );
  return {
    ...actual,
    requireAuth: () => requireAuth(),
  };
});

/** Vitest cannot resolve full @ceo-agent/agents barrel (platform-specs); shim Execute surface. */
vi.mock("@ceo-agent/agents", async () => {
  const execute = await import(
    "../packages/agents/src/ai-story/authorize-and-execute-execution-plan"
  );
  const router = await import(
    "../packages/agents/src/ai-story/canonical-execute-router"
  );
  const { FixedSeedanceRouter } = await import("./helpers/ai-story-pr32-scheduling");
  return {
    authorizeAndExecuteExecutionPlan: execute.authorizeAndExecuteExecutionPlan,
    CanonicalExecuteError: execute.CanonicalExecuteError,
    createCanonicalExecuteProviderRouter: () => new FixedSeedanceRouter(),
    enterCanonicalProductExecutePath: execute.enterCanonicalProductExecutePath,
  };
});

vi.mock("@/lib/ai-story-canonical-execute-router", async () => {
  const { FixedSeedanceRouter } = await import("./helpers/ai-story-pr32-scheduling");
  return {
    createCanonicalExecuteProviderRouter: () => new FixedSeedanceRouter(),
  };
});

const scenePlanPayload = {
  scenePlan: [
    {
      id: "scene-a",
      beatIds: ["beat-0"],
      purpose: "A",
      durationSec: 3,
      transition: "cut",
      continuityNotes: "",
      order: 0,
    },
    {
      id: "scene-b",
      beatIds: ["beat-1"],
      purpose: "B",
      durationSec: 3,
      transition: "cut",
      continuityNotes: "",
      order: 1,
    },
  ],
};

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

async function seedTenant(
  sql: Sql,
  ids: Phase2aIdSet,
  members: Array<{ userId: string; role: string }>,
  label: string
) {
  await sql`INSERT INTO organizations (id, name, slug) VALUES (${ids.orgId}, ${label}, ${`org-${label}-${crypto.randomUUID().slice(0, 6)}`}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${ids.workspaceId}, ${ids.orgId}, ${label}, ${`ws-${label}-${crypto.randomUUID().slice(0, 6)}`}) ON CONFLICT (id) DO NOTHING`;
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${ids.workspaceId}`;
  for (const member of members) {
    await sql`
      INSERT INTO workspace_members (org_id, workspace_id, user_id, role)
      VALUES (${ids.orgId}, ${ids.workspaceId}, ${member.userId}, ${member.role})
    `;
  }
  await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${ids.campaignId}, ${ids.orgId}, ${ids.workspaceId}, ${label}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea) VALUES (${ids.storyId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, ${label}, 'Idea') ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO ai_story_versions (id, story_id, version_number, structured_content, frozen_at) VALUES (${ids.storyVersionId}, ${ids.storyId}, 1, ${sql.json({})}, NOW()) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO ai_story_animation_packages (id, org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload) VALUES (${ids.animationPackageId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, ${ids.storyId}, ${ids.storyVersionId}, 'ready_for_execution', ${sql.json(scenePlanPayload)}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path) VALUES (${ids.assetId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, 'image', ${`${ids.workspaceId}/${label}/asset.png`}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO campaign_asset_refs (campaign_id, asset_id) VALUES (${ids.campaignId}, ${ids.assetId}) ON CONFLICT DO NOTHING`;
}

async function wipeOrg(sql: Sql, ids: Phase2aIdSet) {
  await sql`DELETE FROM provider_execution_dispatches WHERE workspace_id = ${ids.workspaceId}`;
  await sql`DELETE FROM ai_story_scene_scheduling_correlations WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_scene_routing_decisions WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_runtime_authorized_facts WHERE org_id = ${ids.orgId}`;
  await sql`
    DELETE FROM provider_outbox_jobs
    WHERE execution_id IN (
      SELECT execution_id FROM provider_executions WHERE workspace_id = ${ids.workspaceId}
    )
  `;
  await sql`DELETE FROM provider_execution_envelopes WHERE workspace_id = ${ids.workspaceId}`;
  await sql`DELETE FROM provider_executions WHERE workspace_id = ${ids.workspaceId}`;
  await sql`DELETE FROM ai_story_assembly_scene_memberships WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_assembly_definitions WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_story_review_facts WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_scene_intent_review_facts WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_review_opened_facts WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_scene_intent_validation_results WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_scene_executions WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_execution_plans WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_scene_instruction_snapshots WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${ids.workspaceId}`;
  await sql`DELETE FROM campaign_asset_refs WHERE campaign_id = ${ids.campaignId}`;
  await sql`DELETE FROM assets WHERE id = ${ids.assetId}`;
  await sql`DELETE FROM ai_story_animation_packages WHERE id = ${ids.animationPackageId}`;
  await sql`DELETE FROM ai_story_versions WHERE id = ${ids.storyVersionId}`;
  await sql`DELETE FROM ai_stories WHERE id = ${ids.storyId}`;
  await sql`DELETE FROM campaigns WHERE id = ${ids.campaignId}`;
  await sql`DELETE FROM workspaces WHERE id = ${ids.workspaceId}`;
  await sql`DELETE FROM organizations WHERE id = ${ids.orgId}`;
}

async function countEffects(sql: Sql, executionPlanId: string, workspaceId: string) {
  const auth = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM ai_story_runtime_authorized_facts
    WHERE execution_plan_id = ${executionPlanId}
  `;
  const routing = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM ai_story_scene_routing_decisions
    WHERE execution_plan_id = ${executionPlanId}
  `;
  const pe = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM provider_executions WHERE workspace_id = ${workspaceId}
  `;
  const envelopes = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM provider_execution_envelopes
    WHERE workspace_id = ${workspaceId}
  `;
  const outbox = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM provider_outbox_jobs j
    JOIN provider_executions p ON p.execution_id = j.execution_id
    WHERE p.workspace_id = ${workspaceId}
  `;
  return {
    auth: auth[0]?.c ?? 0,
    routing: routing[0]?.c ?? 0,
    pe: pe[0]?.c ?? 0,
    envelopes: envelopes[0]?.c ?? 0,
    outbox: outbox[0]?.c ?? 0,
  };
}

function assertSafeExecuteBody(body: Record<string, unknown>) {
  for (const key of FORBIDDEN_RESPONSE_KEYS) {
    expect(body).not.toHaveProperty(key);
  }
  expect(body).toHaveProperty("executionPlanId");
  expect(body).toHaveProperty("runtimeAuthorizationId");
  expect(body).toHaveProperty("runtimeStatus");
  expect(body).toHaveProperty("runtimeProjectionVersion");
  expect(body).toHaveProperty("scheduledSceneCount");
}

async function prepareReadyPlan(input: {
  ids: Phase2aIdSet;
  purpose: string;
  sceneOrder?: readonly number[];
  userId?: string;
}) {
  const userId = input.userId ?? OPERATOR_A;
  const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
    makePhase2aCompilation({
      ids: input.ids,
      instructionPurpose: `${input.purpose}-${crypto.randomUUID()}`,
      sceneOrder: input.sceneOrder ?? [0],
    })
  );
  const executionPlanId = persisted.plan.storyExecutionId;
  const sceneExecutionIds = persisted.intents.map((i) => i.identity.sceneExecutionId);
  const review = new ExecutionPlanReviewRepository();
  await review.openReview({ executionPlanId, openedBy: userId });
  for (const sceneExecutionId of sceneExecutionIds) {
    await review.appendSceneIntentDecision({
      executionPlanId,
      sceneExecutionId,
      decision: "APPROVED",
      reviewedBy: userId,
    });
  }
  await review.appendStoryDecision({
    executionPlanId,
    decision: "APPROVED",
    reviewedBy: userId,
  });
  await new ExecutionPlanAssemblyRepository().createOrReturnAssembly({
    executionPlanId,
    createdBy: userId,
    orderedSceneExecutionIds: sceneExecutionIds,
  });
  return { executionPlanId, sceneExecutionIds, requiredSceneCount: sceneExecutionIds.length };
}

describeIntegration("Sprint 3 PR 3.7 Phase D Final HTTP Security Evidence Gate", () => {
  let sql: Sql;
  let postExecute: (
    request: Request,
    ctx: { params: Promise<Record<string, string>> }
  ) => Promise<Response>;
  let postLegacyExecute: typeof postExecute;
  let postLegacyRetry: typeof postExecute;
  let postLegacyRegenerate: typeof postExecute;
  let postLegacyExport: typeof postExecute;

  beforeAll(async () => {
    applyProductionLikeVideoRoutingEnv();
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

    await wipeOrg(sql, GATE_A);
    await wipeOrg(sql, GATE_B);
    await seedTenant(
      sql,
      GATE_A,
      [
        { userId: OPERATOR_A, role: "operator" },
        { userId: VIEWER_A, role: "client_viewer" },
      ],
      "pr37d-http-a"
    );
    await seedTenant(
      sql,
      GATE_B,
      [{ userId: OPERATOR_B, role: "operator" }],
      "pr37d-http-b"
    );

    ({ POST: postExecute } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route"
    ));
    ({ POST: postLegacyExecute } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/route"
    ));
    ({ POST: postLegacyRetry } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/[jobId]/retry/route"
    ));
    ({ POST: postLegacyRegenerate } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/[jobId]/regenerate/route"
    ));
    ({ POST: postLegacyExport } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/export/route"
    ));
  }, 180_000);

  afterAll(async () => {
    await wipeOrg(sql, GATE_A);
    await wipeOrg(sql, GATE_B);
    await sql.end();
    await closeDb();
  }, 60_000);

  function paramsFor(
    planId: string,
    overrides: Partial<{ id: string; storyId: string; executionPlanId: string }> = {}
  ) {
    return Promise.resolve({
      id: GATE_A.campaignId,
      storyId: GATE_A.storyId,
      executionPlanId: planId,
      ...overrides,
    });
  }

  it("Task2: unauthenticated → 401 and zero side effects", async () => {
    const ready = await prepareReadyPlan({ ids: GATE_A, purpose: "http-unauth" });
    const before = await countEffects(sql, ready.executionPlanId, GATE_A.workspaceId);
    const { AuthError } = await import("../apps/web/src/lib/auth");
    requireAuth.mockRejectedValue(new AuthError());
    const res = await postExecute(
      new Request("http://localhost/execute", { method: "POST", body: "{}" }),
      { params: paramsFor(ready.executionPlanId) }
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UNAUTHORIZED");
    expect(body).not.toHaveProperty("executionPlanId");
    const after = await countEffects(sql, ready.executionPlanId, GATE_A.workspaceId);
    expect(after).toEqual(before);
    expect(after.auth).toBe(0);
    expect(after.pe).toBe(0);
    expect(after.outbox).toBe(0);
  }, 120_000);

  it("Task3: viewer → 403 and zero scheduling", async () => {
    const ready = await prepareReadyPlan({ ids: GATE_A, purpose: "http-viewer" });
    requireAuth.mockResolvedValue({ id: VIEWER_A });
    const res = await postExecute(
      new Request("http://localhost/execute", { method: "POST", body: "{}" }),
      { params: paramsFor(ready.executionPlanId) }
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("FORBIDDEN");
    const after = await countEffects(sql, ready.executionPlanId, GATE_A.workspaceId);
    expect(after).toEqual({
      auth: 0,
      routing: 0,
      pe: 0,
      envelopes: 0,
      outbox: 0,
    });
  }, 120_000);

  it("Task4+5: operator Execute + duplicate HTTP converge", async () => {
    await wipeOrg(sql, GATE_A);
    await seedTenant(
      sql,
      GATE_A,
      [
        { userId: OPERATOR_A, role: "operator" },
        { userId: VIEWER_A, role: "client_viewer" },
      ],
      "pr37d-http-op"
    );
    const ready = await prepareReadyPlan({
      ids: GATE_A,
      purpose: "http-op",
      sceneOrder: [0, 1],
    });
    requireAuth.mockResolvedValue({ id: OPERATOR_A });

    const first = await postExecute(
      new Request("http://localhost/execute", { method: "POST", body: "{}" }),
      { params: paramsFor(ready.executionPlanId) }
    );
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as Record<string, unknown>;
    assertSafeExecuteBody(firstBody);
    expect(firstBody.scheduledSceneCount).toBe(2);
    expect(firstBody.converged).toBe(false);

    const second = await postExecute(
      new Request("http://localhost/execute", { method: "POST", body: "{}" }),
      { params: paramsFor(ready.executionPlanId) }
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as Record<string, unknown>;
    assertSafeExecuteBody(secondBody);
    expect(secondBody.runtimeAuthorizationId).toBe(firstBody.runtimeAuthorizationId);
    expect(secondBody.converged).toBe(true);

    const counts = await countEffects(sql, ready.executionPlanId, GATE_A.workspaceId);
    expect(counts).toEqual({
      auth: 1,
      routing: 2,
      pe: 2,
      envelopes: 2,
      outbox: 2,
    });
  }, 180_000);

  it("Task6: 10 concurrent HTTP Execute → one fact / required schedules", async () => {
    await wipeOrg(sql, GATE_A);
    await seedTenant(
      sql,
      GATE_A,
      [{ userId: OPERATOR_A, role: "operator" }],
      "pr37d-http-conc"
    );
    const ready = await prepareReadyPlan({
      ids: GATE_A,
      purpose: "http-conc",
      sceneOrder: [0],
    });
    requireAuth.mockResolvedValue({ id: OPERATOR_A });
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        postExecute(
          new Request("http://localhost/execute", { method: "POST", body: "{}" }),
          { params: paramsFor(ready.executionPlanId) }
        )
      )
    );
    const bodies = await Promise.all(responses.map((r) => r.json()));
    const authIds = new Set(
      bodies.map((b: { runtimeAuthorizationId?: string }) => b.runtimeAuthorizationId)
    );
    expect(authIds.size).toBe(1);
    expect(responses.every((r) => r.status === 200 || r.status === 202)).toBe(true);
    const counts = await countEffects(sql, ready.executionPlanId, GATE_A.workspaceId);
    expect(counts.auth).toBe(1);
    expect(counts.routing).toBe(1);
    expect(counts.pe).toBe(1);
    expect(counts.envelopes).toBe(1);
    expect(counts.outbox).toBe(1);
  }, 180_000);

  it("Task7: foreign workspace operator → 403, zero effects", async () => {
    await wipeOrg(sql, GATE_A);
    await seedTenant(
      sql,
      GATE_A,
      [{ userId: OPERATOR_A, role: "operator" }],
      "pr37d-http-fw"
    );
    const ready = await prepareReadyPlan({ ids: GATE_A, purpose: "http-fw" });
    requireAuth.mockResolvedValue({ id: OPERATOR_B });
    const res = await postExecute(
      new Request("http://localhost/execute", { method: "POST", body: "{}" }),
      { params: paramsFor(ready.executionPlanId) }
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("FORBIDDEN");
    expect(body).not.toMatchObject({
      runtimeAuthorizationId: expect.anything(),
    });
    const counts = await countEffects(sql, ready.executionPlanId, GATE_A.workspaceId);
    expect(counts).toEqual({
      auth: 0,
      routing: 0,
      pe: 0,
      envelopes: 0,
      outbox: 0,
    });
  }, 120_000);

  it("Task8: foreign resource chain → 404 fail-closed", async () => {
    await wipeOrg(sql, GATE_A);
    await wipeOrg(sql, GATE_B);
    await seedTenant(
      sql,
      GATE_A,
      [{ userId: OPERATOR_A, role: "operator" }],
      "pr37d-http-chain-a"
    );
    await seedTenant(
      sql,
      GATE_B,
      [{ userId: OPERATOR_B, role: "operator" }],
      "pr37d-http-chain-b"
    );
    const planA = await prepareReadyPlan({
      ids: GATE_A,
      purpose: "http-chain-a",
      userId: OPERATOR_A,
    });
    const planB = await prepareReadyPlan({
      ids: GATE_B,
      purpose: "http-chain-b",
      userId: OPERATOR_B,
    });
    requireAuth.mockResolvedValue({ id: OPERATOR_A });

    const foreignStory = await postExecute(
      new Request("http://localhost/execute", { method: "POST", body: "{}" }),
      {
        params: paramsFor(planA.executionPlanId, {
          id: GATE_A.campaignId,
          storyId: GATE_B.storyId,
        }),
      }
    );
    expect(foreignStory.status).toBe(404);

    const foreignPlan = await postExecute(
      new Request("http://localhost/execute", { method: "POST", body: "{}" }),
      {
        params: paramsFor(planB.executionPlanId, {
          id: GATE_A.campaignId,
          storyId: GATE_A.storyId,
          executionPlanId: planB.executionPlanId,
        }),
      }
    );
    expect(foreignPlan.status).toBe(404);

    const countsA = await countEffects(sql, planA.executionPlanId, GATE_A.workspaceId);
    const countsB = await countEffects(sql, planB.executionPlanId, GATE_B.workspaceId);
    expect(countsA.auth).toBe(0);
    expect(countsA.outbox).toBe(0);
    expect(countsB.auth).toBe(0);
    expect(countsB.outbox).toBe(0);
  }, 180_000);

  it("Task9: forbidden body fields → 422; empty {} accepted", async () => {
    await wipeOrg(sql, GATE_A);
    await seedTenant(
      sql,
      GATE_A,
      [{ userId: OPERATOR_A, role: "operator" }],
      "pr37d-http-body"
    );
    const ready = await prepareReadyPlan({ ids: GATE_A, purpose: "http-body" });
    requireAuth.mockResolvedValue({ id: OPERATOR_A });

    const forbiddenBodies = [
      { providerId: "seedance" },
      { adapterVersion: "1.0.0" },
      { sceneIds: ["x"] },
      { routingDecisionId: "x" },
      { providerExecutionId: "x" },
      { runtimeAuthorizationId: "x" },
      { workspaceId: GATE_A.workspaceId },
      { artifactId: "x" },
      { ready: true },
    ];
    for (const payload of forbiddenBodies) {
      const res = await postExecute(
        new Request("http://localhost/execute", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
        { params: paramsFor(ready.executionPlanId) }
      );
      expect(res.status).toBe(422);
      const mid = await countEffects(sql, ready.executionPlanId, GATE_A.workspaceId);
      expect(mid.auth).toBe(0);
      expect(mid.outbox).toBe(0);
    }

    const ok = await postExecute(
      new Request("http://localhost/execute", { method: "POST", body: "{}" }),
      { params: paramsFor(ready.executionPlanId) }
    );
    expect(ok.status).toBe(202);
  }, 180_000);

  it("Task10: legacy mutation routes remain PHASE1_EXECUTION_LOCKED", async () => {
    requireAuth.mockResolvedValue({ id: OPERATOR_A });
    const legacyParams = Promise.resolve({
      id: GATE_A.campaignId,
      storyId: GATE_A.storyId,
      jobId: "00000000-0000-4000-8000-000000000099",
    });
    const locked = async (fn: () => Promise<Response>) => {
      const res = await fn();
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe(PHASE1_EXECUTION_LOCKED);
    };
    await locked(() =>
      postLegacyExecute(new Request("http://localhost", { method: "POST" }), {
        params: legacyParams,
      })
    );
    await locked(() =>
      postLegacyRetry(new Request("http://localhost", { method: "POST" }), {
        params: legacyParams,
      })
    );
    await locked(() =>
      postLegacyRegenerate(new Request("http://localhost", { method: "POST" }), {
        params: legacyParams,
      })
    );
    await locked(() =>
      postLegacyExport(new Request("http://localhost", { method: "POST" }), {
        params: legacyParams,
      })
    );
  }, 60_000);

  it("Task13: negative readiness via HTTP → 4xx and zero PE/Outbox", async () => {
    await wipeOrg(sql, GATE_A);
    await seedTenant(
      sql,
      GATE_A,
      [{ userId: OPERATOR_A, role: "operator" }],
      "pr37d-http-ready"
    );
    requireAuth.mockResolvedValue({ id: OPERATOR_A });

    // Review not approved (opened only).
    const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({
        ids: GATE_A,
        instructionPurpose: `http-not-ready-${crypto.randomUUID()}`,
        sceneOrder: [0],
      })
    );
    const planId = persisted.plan.storyExecutionId;
    await new ExecutionPlanReviewRepository().openReview({
      executionPlanId: planId,
      openedBy: OPERATOR_A,
    });
    const notApproved = await postExecute(
      new Request("http://localhost/execute", { method: "POST", body: "{}" }),
      { params: paramsFor(planId) }
    );
    expect(notApproved.status).toBeGreaterThanOrEqual(400);
    expect(notApproved.status).toBeLessThan(500);
    let counts = await countEffects(sql, planId, GATE_A.workspaceId);
    expect(counts.auth).toBe(0);
    expect(counts.pe).toBe(0);
    expect(counts.outbox).toBe(0);

    // Approved review but Assembly missing.
    const scenes = persisted.intents.map((i) => i.identity.sceneExecutionId);
    const review = new ExecutionPlanReviewRepository();
    for (const sceneExecutionId of scenes) {
      await review.appendSceneIntentDecision({
        executionPlanId: planId,
        sceneExecutionId,
        decision: "APPROVED",
        reviewedBy: OPERATOR_A,
      });
    }
    await review.appendStoryDecision({
      executionPlanId: planId,
      decision: "APPROVED",
      reviewedBy: OPERATOR_A,
    });
    const noAssembly = await postExecute(
      new Request("http://localhost/execute", { method: "POST", body: "{}" }),
      { params: paramsFor(planId) }
    );
    expect(noAssembly.status).toBeGreaterThanOrEqual(400);
    expect(noAssembly.status).toBeLessThan(500);
    counts = await countEffects(sql, planId, GATE_A.workspaceId);
    expect(counts.auth).toBe(0);
    expect(counts.outbox).toBe(0);
  }, 180_000);

  it("Task12: selective unlock is not a global/process flag", async () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../packages/agents/src/ai-story/authorize-and-execute-execution-plan.ts"
      ),
      "utf8"
    );
    expect(source).toMatch(/enterCanonicalProductExecutePath/);
    expect(source).toMatch(/Intentional no-op/);
    expect(source).not.toMatch(/globalThis|process\.env|PHASE1_EXECUTION_UNLOCKED/);
    expect(source).not.toMatch(/assertPhase1ExecutionLocked\s*=/);
    const lock = readFileSync(
      resolve(__dirname, "../packages/shared/src/ai-story-phase1-execution-lock.ts"),
      "utf8"
    );
    expect(lock).toMatch(/throw new Phase1ExecutionLockedError/);
  });
});
