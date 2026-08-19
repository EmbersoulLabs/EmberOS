/**
 * Sprint 3 PR 3.7 Phase E — HTTP security + GET side-effect evidence.
 *
 * Harness: vitest.integration.config.ts + RUN_DB_INTEGRATION_TESTS=1 + DATABASE_URL.
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
import { PRODUCT_RUNTIME_FORBIDDEN_RESPONSE_KEYS } from "@ceo-agent/shared";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { applyPhaseECommercialSql } from "./helpers/commercial-phase-e-sql";
import {
  makePhase2aCompilation,
  type Phase2aIdSet,
} from "./helpers/ai-story-phase-2a";
import { authorizeAndExecuteExecutionPlan } from "../packages/agents/src/ai-story/authorize-and-execute-execution-plan";
import { FixedSeedanceRouter } from "./helpers/ai-story-pr32-scheduling";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

const OPERATOR_A = "51000000-0000-4000-8000-000000000040";
const VIEWER_A = "51000000-0000-4000-8000-000000000041";
const OPERATOR_B = "61000000-0000-4000-8000-000000000040";

const GATE_A: Phase2aIdSet = {
  orgId: "51000000-0000-4000-8000-000000000001",
  workspaceId: "51000000-0000-4000-8000-000000000002",
  campaignId: "51000000-0000-4000-8000-000000000003",
  storyId: "51000000-0000-4000-8000-000000000004",
  storyVersionId: "51000000-0000-4000-8000-000000000005",
  animationPackageId: "51000000-0000-4000-8000-000000000006",
  assetId: "51000000-0000-4000-8000-000000000007",
};

const GATE_B: Phase2aIdSet = {
  orgId: "61000000-0000-4000-8000-000000000001",
  workspaceId: "61000000-0000-4000-8000-000000000002",
  campaignId: "61000000-0000-4000-8000-000000000003",
  storyId: "61000000-0000-4000-8000-000000000004",
  storyVersionId: "61000000-0000-4000-8000-000000000005",
  animationPackageId: "61000000-0000-4000-8000-000000000006",
  assetId: "61000000-0000-4000-8000-000000000007",
};

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

vi.mock("@ceo-agent/agents", async () => {
  const derive = await import(
    "../packages/agents/src/ai-story/derive-product-runtime-projection"
  );
  const execute = await import(
    "../packages/agents/src/ai-story/authorize-and-execute-execution-plan"
  );
  const { FixedSeedanceRouter } = await import("./helpers/ai-story-pr32-scheduling");
  return {
    deriveProductRuntimeProjection: derive.deriveProductRuntimeProjection,
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

vi.mock("@/lib/ai-story-final-story-playback", () => ({
  mintFinalStoryPlaybackUrl: async () => ({
    playbackUrl: "https://signed.example.test/final.mp4?token=test",
    expiresInSeconds: 900,
  }),
  FINAL_STORY_PLAYBACK_TTL_SECONDS: 900,
}));

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
  await sql`DELETE FROM ai_story_final_story_results WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_assembly_artifacts WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_assembly_job_facts WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_assembly_jobs WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_scene_results WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_worker_attempt_observations WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_worker_execution_results WHERE org_id = ${ids.orgId}`;
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
  const worker = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM ai_story_worker_execution_results
    WHERE workspace_id = ${workspaceId}
  `;
  const assembly = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM ai_story_assembly_jobs
    WHERE execution_plan_id = ${executionPlanId}
  `;
  const fsr = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM ai_story_final_story_results
    WHERE execution_plan_id = ${executionPlanId}
  `;
  return {
    auth: auth[0]?.c ?? 0,
    routing: routing[0]?.c ?? 0,
    pe: pe[0]?.c ?? 0,
    envelopes: envelopes[0]?.c ?? 0,
    outbox: outbox[0]?.c ?? 0,
    worker: worker[0]?.c ?? 0,
    assembly: assembly[0]?.c ?? 0,
    fsr: fsr[0]?.c ?? 0,
  };
}

function assertSafeBody(body: Record<string, unknown>) {
  for (const key of PRODUCT_RUNTIME_FORBIDDEN_RESPONSE_KEYS) {
    expect(body).not.toHaveProperty(key);
  }
}

async function prepareReadyPlan(ids: Phase2aIdSet, purpose: string) {
  const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
    makePhase2aCompilation({
      ids,
      instructionPurpose: `${purpose}-${crypto.randomUUID()}`,
      sceneOrder: [0],
    })
  );
  const executionPlanId = persisted.plan.storyExecutionId;
  const sceneExecutionIds = persisted.intents.map((i) => i.identity.sceneExecutionId);
  const review = new ExecutionPlanReviewRepository();
  await review.openReview({ executionPlanId, openedBy: OPERATOR_A });
  for (const sceneExecutionId of sceneExecutionIds) {
    await review.appendSceneIntentDecision({
      executionPlanId,
      sceneExecutionId,
      decision: "APPROVED",
      reviewedBy: OPERATOR_A,
    });
  }
  await review.appendStoryDecision({
    executionPlanId,
    decision: "APPROVED",
    reviewedBy: OPERATOR_A,
  });
  await new ExecutionPlanAssemblyRepository().createOrReturnAssembly({
    executionPlanId,
    createdBy: OPERATOR_A,
    orderedSceneExecutionIds: sceneExecutionIds,
  });
  return { executionPlanId, sceneExecutionIds };
}

describeIntegration("Sprint 3 PR 3.7 Phase E HTTP security + GET side effects", () => {
  let sql: Sql;
  let getRuntime: (
    request: Request,
    ctx: { params: Promise<Record<string, string>> }
  ) => Promise<Response>;
  let getFsr: typeof getRuntime;
  let postExecute: typeof getRuntime;

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
      "../packages/db/sql/ai-story-generated-scene-review-v1.sql",
      "../packages/db/sql/ai-story-assembly-job-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-runtime-artifact-v1.sql",
      "../packages/db/sql/ai-story-final-story-result-v1.sql",
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
      "pr37e-http-a"
    );
    await seedTenant(
      sql,
      GATE_B,
      [{ userId: OPERATOR_B, role: "operator" }],
      "pr37e-http-b"
    );

    ({ GET: getRuntime } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/runtime/route"
    ));
    ({ GET: getFsr } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/final-story-result/route"
    ));
    ({ POST: postExecute } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route"
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
      id: overrides.id ?? GATE_A.campaignId,
      storyId: overrides.storyId ?? GATE_A.storyId,
      executionPlanId: overrides.executionPlanId ?? planId,
    });
  }

  it("unauthenticated GET runtime → 401, zero effects", async () => {
    const { executionPlanId } = await prepareReadyPlan(GATE_A, "e-unauth");
    const before = await countEffects(sql, executionPlanId, GATE_A.workspaceId);
    const { AuthError } = await import("../apps/web/src/lib/auth");
    requireAuth.mockRejectedValueOnce(new AuthError());
    const res = await getRuntime(new Request("http://localhost/runtime"), {
      params: paramsFor(executionPlanId),
    });
    expect(res.status).toBe(401);
    expect(await countEffects(sql, executionPlanId, GATE_A.workspaceId)).toEqual(before);
  });

  it("viewer GET runtime → 200, canExecute=false, zero effects", async () => {
    const { executionPlanId } = await prepareReadyPlan(GATE_A, "e-viewer");
    const before = await countEffects(sql, executionPlanId, GATE_A.workspaceId);
    requireAuth.mockResolvedValueOnce({ id: VIEWER_A });
    const res = await getRuntime(new Request("http://localhost/runtime"), {
      params: paramsFor(executionPlanId),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    assertSafeBody(body);
    expect(body.status).toBe("READY_FOR_EXECUTION");
    expect(body.canExecute).toBe(false);
    expect(await countEffects(sql, executionPlanId, GATE_A.workspaceId)).toEqual(before);
  });

  it("operator GET runtime → 200, canExecute=true before Execute", async () => {
    const { executionPlanId } = await prepareReadyPlan(GATE_A, "e-operator");
    requireAuth.mockResolvedValueOnce({ id: OPERATOR_A });
    const res = await getRuntime(new Request("http://localhost/runtime"), {
      params: paramsFor(executionPlanId),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.canExecute).toBe(true);
    expect(body.runtimeAuthorizationId).toBeNull();
  });

  it("foreign workspace GET runtime → 403/404, zero effects", async () => {
    const { executionPlanId } = await prepareReadyPlan(GATE_A, "e-foreign-ws");
    const before = await countEffects(sql, executionPlanId, GATE_A.workspaceId);
    requireAuth.mockResolvedValueOnce({ id: OPERATOR_B });
    const res = await getRuntime(new Request("http://localhost/runtime"), {
      params: paramsFor(executionPlanId),
    });
    expect([403, 404]).toContain(res.status);
    expect(await countEffects(sql, executionPlanId, GATE_A.workspaceId)).toEqual(before);
  });

  it("foreign plan GET runtime → 404, zero effects", async () => {
    const { executionPlanId } = await prepareReadyPlan(GATE_A, "e-foreign-plan");
    const before = await countEffects(sql, executionPlanId, GATE_A.workspaceId);
    requireAuth.mockResolvedValueOnce({ id: OPERATOR_A });
    const res = await getRuntime(new Request("http://localhost/runtime"), {
      params: paramsFor(executionPlanId, {
        executionPlanId: "00000000-0000-4000-8000-000000009999",
      }),
    });
    expect(res.status).toBe(404);
    expect(await countEffects(sql, executionPlanId, GATE_A.workspaceId)).toEqual(before);
  });

  it("GET runtime after Execute remains observational", async () => {
    const { executionPlanId, sceneExecutionIds } = await prepareReadyPlan(
      GATE_A,
      "e-after-exec"
    );
    await authorizeAndExecuteExecutionPlan({
      executionPlanId,
      actorUserId: OPERATOR_A,
      ownership: {
        orgId: GATE_A.orgId,
        workspaceId: GATE_A.workspaceId,
        campaignId: GATE_A.campaignId,
        storyId: GATE_A.storyId,
        storyVersionId: GATE_A.storyVersionId,
        animationPackageId: GATE_A.animationPackageId,
        executionPlanId,
      },
      router: new FixedSeedanceRouter(),
    });
    const before = await countEffects(sql, executionPlanId, GATE_A.workspaceId);
    expect(before.auth).toBe(1);
    requireAuth.mockResolvedValueOnce({ id: OPERATOR_A });
    const res = await getRuntime(new Request("http://localhost/runtime"), {
      params: paramsFor(executionPlanId),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.canExecute).toBe(false);
    expect(["AUTHORIZED", "SCENES_RUNNING"]).toContain(body.status);
    expect(body.requiredSceneCount).toBe(sceneExecutionIds.length);
    expect(await countEffects(sql, executionPlanId, GATE_A.workspaceId)).toEqual(before);
  });

  it("GET final-story-result absent → 404, zero effects", async () => {
    const { executionPlanId } = await prepareReadyPlan(GATE_A, "e-fsr-absent");
    const before = await countEffects(sql, executionPlanId, GATE_A.workspaceId);
    requireAuth.mockResolvedValueOnce({ id: OPERATOR_A });
    const res = await getFsr(new Request("http://localhost/fsr"), {
      params: paramsFor(executionPlanId),
    });
    expect(res.status).toBe(404);
    expect(await countEffects(sql, executionPlanId, GATE_A.workspaceId)).toEqual(before);
  });

  it("viewer POST Execute still 403 (UI hide is not authority)", async () => {
    const { executionPlanId } = await prepareReadyPlan(GATE_A, "e-viewer-post");
    const before = await countEffects(sql, executionPlanId, GATE_A.workspaceId);
    requireAuth.mockResolvedValueOnce({ id: VIEWER_A });
    const res = await postExecute(
      new Request("http://localhost/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      { params: paramsFor(executionPlanId) }
    );
    expect(res.status).toBe(403);
    expect(await countEffects(sql, executionPlanId, GATE_A.workspaceId)).toEqual(before);
  });
});
