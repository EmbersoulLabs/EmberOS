/**
 * Sprint 3 Phase 2B PR 2B.4 — Release Gate: live HTTP route handlers + real DB.
 *
 * Harness: vitest.integration.config.ts + RUN_DB_INTEGRATION_TESTS=1 + DATABASE_URL.
 * Mocks ONLY requireAuth identity. Real requireWorkspaceRole, ownership resolver,
 * canonical repositories, and PostgreSQL. RLS remains enabled (verified separately
 * by PR 2B.3 suite; API getDb() is privileged bypass by approved design).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import {
  AiStorySceneExecutionPersistenceRepository,
  closeDb,
} from "@ceo-agent/db";
import { PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
  isRlsEnabled,
  withAuthenticatedUser,
} from "./helpers/db-integration";
import {
  makePhase2aCompilation,
  type Phase2aIdSet,
} from "./helpers/ai-story-phase-2a";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

const OPERATOR_A = "30000000-0000-4000-8000-000000000040";
const VIEWER_A = "30000000-0000-4000-8000-000000000041";
const OPERATOR_B = "40000000-0000-4000-8000-000000000040";

const GATE_A: Phase2aIdSet = {
  orgId: "30000000-0000-4000-8000-000000000001",
  workspaceId: "30000000-0000-4000-8000-000000000002",
  campaignId: "30000000-0000-4000-8000-000000000003",
  storyId: "30000000-0000-4000-8000-000000000004",
  storyVersionId: "30000000-0000-4000-8000-000000000005",
  animationPackageId: "30000000-0000-4000-8000-000000000006",
  assetId: "30000000-0000-4000-8000-000000000007",
};

const GATE_B: Phase2aIdSet = {
  orgId: "40000000-0000-4000-8000-000000000001",
  workspaceId: "40000000-0000-4000-8000-000000000002",
  campaignId: "40000000-0000-4000-8000-000000000003",
  storyId: "40000000-0000-4000-8000-000000000004",
  storyVersionId: "40000000-0000-4000-8000-000000000005",
  animationPackageId: "40000000-0000-4000-8000-000000000006",
  assetId: "40000000-0000-4000-8000-000000000007",
};

const FORBIDDEN_RESPONSE_KEYS = new Set([
  "instructions",
  "instructionSnapshot",
  "instruction_snapshot",
  "prompt",
  "negativePrompt",
  "negative_prompt",
  "systemPrompt",
  "system_prompt",
  "providerPayload",
  "provider_payload",
  "providerRequest",
  "provider_request",
  "providerResponse",
  "provider_response",
  "providerCredentials",
  "apiKey",
  "api_key",
  "apiKeys",
  "DATABASE_URL",
  "storageUri",
  "storage_uri",
  "signedUrl",
  "signed_url",
  "canonicalProviderEnvelope",
  "providerEnvelope",
]);

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

function assertNoForbiddenKeys(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenKeys(item, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      expect(FORBIDDEN_RESPONSE_KEYS.has(key), `forbidden key at ${path}.${key}`).toBe(false);
      const lowered = key.toLowerCase();
      expect(lowered.includes("credential"), `credential-like key at ${path}.${key}`).toBe(false);
      expect(lowered.includes("apikey") || lowered.includes("api_key"), `api key at ${path}.${key}`).toBe(
        false
      );
      assertNoForbiddenKeys(child, `${path}.${key}`);
    }
  }
}

const scenePlanPayload = {
  scenePlan: [
    { id: "scene-a", beatIds: ["beat-0"], purpose: "A", durationSec: 3, transition: "cut", continuityNotes: "", order: 0 },
    { id: "scene-b", beatIds: ["beat-1"], purpose: "B", durationSec: 3, transition: "cut", continuityNotes: "", order: 1 },
  ],
};

async function seedTenant(
  sql: Sql,
  ids: Phase2aIdSet,
  members: Array<{ userId: string; role: string }>,
  label: string
) {
  await sql`INSERT INTO organizations (id, name, slug) VALUES (${ids.orgId}, ${label}, ${`org-${label}`}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${ids.workspaceId}, ${ids.orgId}, ${label}, ${`ws-${label}`}) ON CONFLICT (id) DO NOTHING`;
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${ids.workspaceId}`;
  for (const member of members) {
    await sql`INSERT INTO workspace_members (org_id, workspace_id, user_id, role) VALUES (${ids.orgId}, ${ids.workspaceId}, ${member.userId}, ${member.role})`;
  }
  await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${ids.campaignId}, ${ids.orgId}, ${ids.workspaceId}, ${label}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea) VALUES (${ids.storyId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, ${label}, 'Idea') ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO ai_story_versions (id, story_id, version_number, structured_content, frozen_at) VALUES (${ids.storyVersionId}, ${ids.storyId}, 1, ${sql.json({})}, NOW()) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO ai_story_animation_packages (id, org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload) VALUES (${ids.animationPackageId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, ${ids.storyId}, ${ids.storyVersionId}, 'ready_for_execution', ${sql.json(scenePlanPayload)}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path) VALUES (${ids.assetId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, 'image', ${`${label}/asset.png`}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO campaign_asset_refs (campaign_id, asset_id) VALUES (${ids.campaignId}, ${ids.assetId}) ON CONFLICT DO NOTHING`;
}

async function wipeOrg(sql: Sql, ids: Phase2aIdSet) {
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

function routeParams(extra: Record<string, string> = {}) {
  return Promise.resolve({
    id: GATE_A.campaignId,
    storyId: GATE_A.storyId,
    executionPlanId: planAId,
    ...extra,
  });
}

let planAId = "";
let planBId = "";
let sceneAIds: string[] = [];
let sceneBIds: string[] = [];

describeIntegration("Sprint 3 Phase 2B PR 2B.4 Release Gate — live HTTP + DB + RLS", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createIntegrationSql();
    for (const relative of [
      "../packages/db/sql/ai-story-scene-execution-persistence-v1.sql",
      "../packages/db/sql/ai-story-human-review-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-definition-persistence-v1.sql",
      "../packages/db/sql/ai-story-canonical-rls-v1.sql",
    ]) {
      const migration = readFileSync(resolve(__dirname, relative), "utf8");
      for (const statement of migration
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)) {
        await sql.unsafe(statement);
      }
    }

    expect(await isRlsEnabled(sql, "ai_story_execution_plans")).toBe(true);
    expect(await isRlsEnabled(sql, "ai_story_scene_instruction_snapshots")).toBe(true);

    await wipeOrg(sql, GATE_A);
    await wipeOrg(sql, GATE_B);
    await seedTenant(
      sql,
      GATE_A,
      [
        { userId: OPERATOR_A, role: "operator" },
        { userId: VIEWER_A, role: "client_viewer" },
      ],
      "2b4-gate-a"
    );
    await seedTenant(sql, GATE_B, [{ userId: OPERATOR_B, role: "operator" }], "2b4-gate-b");

    const persistedA = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({ ids: GATE_A, instructionPurpose: "2b4-gate-a" })
    );
    planAId = persistedA.plan.storyExecutionId;
    sceneAIds = persistedA.intents.map((i) => i.identity.sceneExecutionId);

    const persistedB = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({ ids: GATE_B, instructionPurpose: "2b4-gate-b" })
    );
    planBId = persistedB.plan.storyExecutionId;
    sceneBIds = persistedB.intents.map((i) => i.identity.sceneExecutionId);
  }, 180_000);

  afterAll(async () => {
    await wipeOrg(sql, GATE_A);
    await wipeOrg(sql, GATE_B);
    await sql.end();
    await closeDb();
  }, 120_000);

  it("Gate 1+2+auth: full review/assembly HTTP lifecycle with leak audit and locks", async () => {
    const { POST: postReview, GET: getReview } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/route"
    );
    const { POST: postSceneDecision } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/scenes/[sceneExecutionId]/decisions/route"
    );
    const { POST: postStoryDecision } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/decisions/route"
    );
    const { GET: getHistory } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/history/route"
    );
    const { POST: postAssembly, GET: getAssembly } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/assembly-definition/route"
    );
    const { POST: postExecute } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/route"
    );
    const { POST: postExport } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/export/route"
    );
    const { POST: postRegenAll } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/regenerate-all/route"
    );
    const { POST: postRetry } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/[jobId]/retry/route"
    );
    const { POST: postRegenOne } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/[jobId]/regenerate/route"
    );

    const execParams = Promise.resolve({ id: GATE_A.campaignId, storyId: GATE_A.storyId });
    const jobParams = Promise.resolve({
      id: GATE_A.campaignId,
      storyId: GATE_A.storyId,
      jobId: "30000000-0000-4000-8000-000000000099",
    });

    async function expectLocked(handler: () => Promise<Response>) {
      const response = await handler();
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.code).toBe(PHASE1_EXECUTION_LOCKED);
    }

    // Unauthenticated
    const { AuthError } = await import("../apps/web/src/lib/auth");
    requireAuth.mockRejectedValue(new AuthError());
    expect((await getReview(new Request("http://localhost"), { params: routeParams() })).status).toBe(
      401
    );

    // 1–2 open review + replay
    requireAuth.mockResolvedValue({ id: OPERATOR_A });
    const open1 = await postReview(new Request("http://localhost", { method: "POST" }), {
      params: routeParams(),
    });
    expect(open1.status).toBe(200);
    const openBody1 = await open1.json();
    expect(openBody1.opened.openedBy).toBe(OPERATOR_A);
    expect(openBody1.executionAllowed).toBe(false);
    expect(openBody1.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
    assertNoForbiddenKeys(openBody1);

    const open2 = await postReview(new Request("http://localhost", { method: "POST" }), {
      params: routeParams(),
    });
    expect(open2.status).toBe(200);
    const openBody2 = await open2.json();
    expect(openBody2.opened.factId).toBe(openBody1.opened.factId);
    expect(openBody2.opened.deterministicFingerprint).toBe(
      openBody1.opened.deterministicFingerprint
    );

    await expectLocked(() =>
      postExecute(new Request("http://localhost", { method: "POST" }), { params: execParams })
    );

    // 3 viewer can GET review
    requireAuth.mockResolvedValue({ id: VIEWER_A });
    const viewerGet = await getReview(new Request("http://localhost"), { params: routeParams() });
    expect(viewerGet.status).toBe(200);
    const viewerBody = await viewerGet.json();
    assertNoForbiddenKeys(viewerBody);
    expect(viewerBody.executionAllowed).toBe(false);

    // 4–5 viewer cannot POST decisions / assembly
    expect(
      (
        await postSceneDecision(
          new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ decision: "APPROVED" }),
          }),
          { params: routeParams({ sceneExecutionId: sceneAIds[0]! }) }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await postStoryDecision(
          new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ decision: "APPROVED" }),
          }),
          { params: routeParams() }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await postAssembly(new Request("http://localhost", { method: "POST", body: "{}" }), {
          params: routeParams(),
        })
      ).status
    ).toBe(403);

    // 6 foreign workspace plan under own campaign route → 404 (no existence leak)
    requireAuth.mockResolvedValue({ id: OPERATOR_A });
    expect(
      (
        await getReview(new Request("http://localhost"), {
          params: routeParams({ executionPlanId: planBId }),
        })
      ).status
    ).toBe(404);

    // 7 wrong campaign (foreign workspace) → approved non-leaking 403/404
    const wrongCampaignStatus = (
      await getReview(new Request("http://localhost"), {
        params: Promise.resolve({
          id: GATE_B.campaignId,
          storyId: GATE_A.storyId,
          executionPlanId: planAId,
        }),
      })
    ).status;
    expect([403, 404]).toContain(wrongCampaignStatus);

    // same workspace, wrong story id → 404
    expect(
      (
        await getReview(new Request("http://localhost"), {
          params: routeParams({ storyId: GATE_B.storyId }),
        })
      ).status
    ).toBe(404);

    // 10 payload reviewerId rejected
    expect(
      (
        await postSceneDecision(
          new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ decision: "APPROVED", reviewerId: OPERATOR_B }),
          }),
          { params: routeParams({ sceneExecutionId: sceneAIds[0]! }) }
        )
      ).status
    ).toBe(400);

    // Assembly before APPROVED → 409
    const earlyAssembly = await postAssembly(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: routeParams() }
    );
    expect(earlyAssembly.status).toBe(409);
    expect((await earlyAssembly.json()).code).toBe("ASSEMBLY_STATE_INVALID");

    // 12 Story APPROVED before all scenes → eligibility error
    const earlyStory = await postStoryDecision(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ decision: "APPROVED" }),
      }),
      { params: routeParams() }
    );
    expect(earlyStory.status).toBe(409);
    expect((await earlyStory.json()).code).toBe("STORY_REVIEW_NOT_ELIGIBLE");

    // 8–9 foreign / cross-plan scene fails closed
    const foreignScene = await postSceneDecision(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ decision: "APPROVED" }),
      }),
      { params: routeParams({ sceneExecutionId: sceneBIds[0]! }) }
    );
    expect(foreignScene.status).toBe(409);
    const foreignCode = (await foreignScene.json()).code;
    expect(["REVIEW_STATE_CONFLICT", "SCENE_REVIEW_NOT_ELIGIBLE", "OWNERSHIP_INTEGRITY_VIOLATION"]).toContain(
      foreignCode
    );

    // 13 Scene APPROVED append-only + identity from auth
    const approve1 = await postSceneDecision(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ decision: "APPROVED", comment: "ok-a" }),
      }),
      { params: routeParams({ sceneExecutionId: sceneAIds[0]! }) }
    );
    expect(approve1.status).toBe(200);
    const approve1Body = await approve1.json();
    expect(approve1Body.decision.reviewedBy).toBe(OPERATOR_A);
    expect(approve1Body.decision.decision).toBe("APPROVED");
    assertNoForbiddenKeys(approve1Body);

    // 17 equivalent replay
    const approve1Replay = await postSceneDecision(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ decision: "APPROVED", comment: "ok-a" }),
      }),
      { params: routeParams({ sceneExecutionId: sceneAIds[0]! }) }
    );
    expect(approve1Replay.status).toBe(200);
    expect((await approve1Replay.json()).decision.factId).toBe(approve1Body.decision.factId);

    // 18 conflicting decision (different comment → different fingerprint) still appends until terminal;
    // conflict case for assembly identity tested below. For scene identity conflict: reopen with
    // same fingerprint different fact is covered by repository; here assert changed comment creates
    // distinct factId (append-only), then continue approval path.
    const approve1b = await postSceneDecision(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ decision: "APPROVED", comment: "ok-a-2" }),
      }),
      { params: routeParams({ sceneExecutionId: sceneAIds[0]! }) }
    );
    expect(approve1b.status).toBe(200);
    expect((await approve1b.json()).decision.factId).not.toBe(approve1Body.decision.factId);

    await expectLocked(() =>
      postExport(new Request("http://localhost", { method: "POST" }), { params: execParams })
    );

    // Approve remaining scenes
    const approve2 = await postSceneDecision(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ decision: "APPROVED", comment: "ok-b" }),
      }),
      { params: routeParams({ sceneExecutionId: sceneAIds[1]! }) }
    );
    expect(approve2.status).toBe(200);

    await expectLocked(() =>
      postRegenAll(new Request("http://localhost", { method: "POST" }), { params: execParams })
    );

    // Story APPROVED
    const storyOk = await postStoryDecision(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ decision: "APPROVED", comment: "ship" }),
      }),
      { params: routeParams() }
    );
    expect(storyOk.status).toBe(200);
    const storyBody = await storyOk.json();
    expect(storyBody.decision.reviewedBy).toBe(OPERATOR_A);
    expect(storyBody.review.status).toBe("APPROVED");
    expect(storyBody.executionAllowed).toBe(false);

    await expectLocked(() =>
      postRetry(new Request("http://localhost", { method: "POST" }), { params: jobParams })
    );
    await expectLocked(() =>
      postRegenOne(new Request("http://localhost", { method: "POST" }), { params: jobParams })
    );

    // Assembly create + replay
    const assembly1 = await postAssembly(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: routeParams() }
    );
    expect(assembly1.status).toBe(200);
    const assemblyBody1 = await assembly1.json();
    expect(assemblyBody1.definition.createdBy).toBe(OPERATOR_A);
    expect(assemblyBody1.executionPlan.readiness).toBe("READY_FOR_EXECUTION");
    expect(assemblyBody1.review.status).toBe("APPROVED");
    expect(assemblyBody1.executionAllowed).toBe(false);
    expect(assemblyBody1.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
    assertNoForbiddenKeys(assemblyBody1);

    const assembly2 = await postAssembly(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: routeParams() }
    );
    expect(assembly2.status).toBe(200);
    const assemblyBody2 = await assembly2.json();
    expect(assemblyBody2.replayed).toBe(true);
    expect(assemblyBody2.definition.assemblyDefinitionId).toBe(
      assemblyBody1.definition.assemblyDefinitionId
    );

    // Changed ordering → 409 ASSEMBLY_IDENTITY_CONFLICT
    const conflictOrder = await postAssembly(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ orderedSceneExecutionIds: [...sceneAIds].reverse() }),
      }),
      { params: routeParams() }
    );
    expect(conflictOrder.status).toBe(409);
    expect((await conflictOrder.json()).code).toBe("ASSEMBLY_IDENTITY_CONFLICT");

    // Foreign scene membership → fail closed
    const foreignMembership = await postAssembly(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          orderedSceneExecutionIds: [sceneAIds[0], sceneBIds[0]],
        }),
      }),
      { params: routeParams() }
    );
    expect([400, 409]).toContain(foreignMembership.status);

    // GET assembly + history leak audit
    requireAuth.mockResolvedValue({ id: VIEWER_A });
    const assemblyGet = await getAssembly(new Request("http://localhost"), {
      params: routeParams(),
    });
    expect(assemblyGet.status).toBe(200);
    const assemblyGetBody = await assemblyGet.json();
    expect(assemblyGetBody.orderedSceneMemberships.length).toBe(sceneAIds.length);
    expect(assemblyGetBody.executionAllowed).toBe(false);
    expect(assemblyGetBody.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
    assertNoForbiddenKeys(assemblyGetBody);

    const history = await getHistory(new Request("http://localhost"), { params: routeParams() });
    expect(history.status).toBe(200);
    const historyBody = await history.json();
    assertNoForbiddenKeys(historyBody);
    const kinds = historyBody.events.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain("REVIEW_OPENED");
    expect(kinds).toContain("SCENE_DECISION");
    expect(kinds).toContain("STORY_DECISION");
    const times = historyBody.events.map((e: { at: string }) => e.at);
    expect([...times].sort()).toEqual(times);

    // READY_FOR_EXECUTION still locked
    requireAuth.mockResolvedValue({ id: OPERATOR_A });
    await expectLocked(() =>
      postExecute(new Request("http://localhost", { method: "POST" }), { params: execParams })
    );

    // Integrity drift → ASSEMBLY_INTEGRITY_VIOLATION on GET projection path
    await sql`
      UPDATE ai_story_assembly_definitions
      SET definition = definition || ${sql.json({ sceneCount: 999 })}::jsonb
      WHERE execution_plan_id = ${planAId}
    `;
    const integrityGet = await getAssembly(new Request("http://localhost"), {
      params: routeParams(),
    });
    expect(integrityGet.status).toBe(409);
    expect((await integrityGet.json()).code).toBe("ASSEMBLY_INTEGRITY_VIOLATION");
    // restore via wipe later
  }, 300_000);

  it("Gate: Scene REJECTED derives REJECTED and blocks later APPROVED", async () => {
    // Fresh plan for reject path
    const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({
        ids: GATE_A,
        instructionPurpose: `2b4-reject-${Date.now()}`,
      })
    );
    const planId = persisted.plan.storyExecutionId;
    const scenes = persisted.intents.map((i) => i.identity.sceneExecutionId);

    const { POST: postReview } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/route"
    );
    const { POST: postSceneDecision } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/scenes/[sceneExecutionId]/decisions/route"
    );
    const { POST: postStoryDecision } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/decisions/route"
    );

    requireAuth.mockResolvedValue({ id: OPERATOR_A });
    const params = Promise.resolve({
      id: GATE_A.campaignId,
      storyId: GATE_A.storyId,
      executionPlanId: planId,
    });

    expect(
      (await postReview(new Request("http://localhost", { method: "POST" }), { params })).status
    ).toBe(200);

    const rejected = await postSceneDecision(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ decision: "REJECTED", comment: "nope" }),
      }),
      { params: Promise.resolve({ ...(await params), sceneExecutionId: scenes[0]! }) }
    );
    expect(rejected.status).toBe(200);
    const rejectedBody = await rejected.json();
    expect(rejectedBody.review.status).toBe("REJECTED");
    expect(rejectedBody.decision.reviewedBy).toBe(OPERATOR_A);

    const laterApprove = await postStoryDecision(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ decision: "APPROVED" }),
      }),
      { params }
    );
    expect(laterApprove.status).toBe(409);
    expect(["REVIEW_STATE_CONFLICT", "STORY_REVIEW_NOT_ELIGIBLE"]).toContain(
      (await laterApprove.json()).code
    );
  }, 180_000);

  it("Gate 3 complement: authenticated RLS still rejects Snapshot INSERT and foreign plan SELECT", async () => {
    await expect(
      withAuthenticatedUser(sql, OPERATOR_A, async (tx) => {
        await tx`
          INSERT INTO ai_story_scene_instruction_snapshots (
            content_hash, snapshot_id, org_id, workspace_id, contract_version, instructions
          ) VALUES (
            ${`gate-${crypto.randomUUID().replace(/-/g, "")}`},
            ${crypto.randomUUID()},
            ${GATE_A.orgId},
            ${GATE_A.workspaceId},
            '1',
            ${tx.json({ leak: true })}
          )
        `;
      })
    ).rejects.toThrow(/row-level security/i);

    const foreignPlans = await withAuthenticatedUser(sql, OPERATOR_A, async (tx) => {
      return tx<{ id: string }[]>`
        SELECT id FROM ai_story_execution_plans WHERE id = ${planBId}
      `;
    });
    expect(foreignPlans).toHaveLength(0);

    const foreignSnap = await withAuthenticatedUser(sql, OPERATOR_A, async (tx) => {
      return tx<{ content_hash: string }[]>`
        SELECT content_hash FROM ai_story_scene_instruction_snapshots
        WHERE workspace_id = ${GATE_B.workspaceId}
      `;
    });
    expect(foreignSnap).toHaveLength(0);
  }, 60_000);

  it("Gate 4: queue/worker story-execution helpers remain PHASE1_EXECUTION_LOCKED", async () => {
    const { enqueueStoryExecution } = await import("../packages/queue/src/index");
    const { startExecutionJob, runExecutionJob } = await import(
      "../packages/agents/src/ai-story/story-execution-orchestrator"
    );
    await expect(Promise.resolve().then(() => enqueueStoryExecution({} as never))).rejects.toMatchObject({
      code: PHASE1_EXECUTION_LOCKED,
    });
    await expect(Promise.resolve().then(() => startExecutionJob({} as never))).rejects.toMatchObject({
      code: PHASE1_EXECUTION_LOCKED,
    });
    await expect(Promise.resolve().then(() => runExecutionJob("job"))).rejects.toMatchObject({
      code: PHASE1_EXECUTION_LOCKED,
    });
  });
});
