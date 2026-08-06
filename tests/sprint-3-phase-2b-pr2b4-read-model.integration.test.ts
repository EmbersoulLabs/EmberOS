/**
 * Sprint 3 Phase 2B PR 2B.4 — DB integration for read model + repository-backed API flow.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import {
  makePhase2aCompilation,
  PHASE_2A_IDS,
  PHASE_2A_WORKSPACE_B_IDS,
} from "./helpers/ai-story-phase-2a";
import { buildExecutionPlanReviewAssemblyReadModel } from "../apps/web/src/lib/ai-story-review-assembly-read-model";
import { buildReviewHistoryReadModel } from "../apps/web/src/lib/ai-story-review-assembly-read-model";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

const USER_A = "10000000-0000-4000-8000-000000000040";

const scenePlanPayload = {
  scenePlan: [
    { id: "scene-a", beatIds: ["beat-0"], purpose: "A", durationSec: 3, transition: "cut", continuityNotes: "", order: 0 },
    { id: "scene-b", beatIds: ["beat-1"], purpose: "B", durationSec: 3, transition: "cut", continuityNotes: "", order: 1 },
  ],
};

async function seedTenant(sql: Sql, ids: typeof PHASE_2A_IDS, userId: string, label: string) {
  await sql`INSERT INTO organizations (id, name, slug) VALUES (${ids.orgId}, ${label}, ${`org-${label}`}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${ids.workspaceId}, ${ids.orgId}, ${label}, ${`ws-${label}`}) ON CONFLICT (id) DO NOTHING`;
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${ids.workspaceId} AND user_id = ${userId}`;
  await sql`INSERT INTO workspace_members (org_id, workspace_id, user_id, role) VALUES (${ids.orgId}, ${ids.workspaceId}, ${userId}, 'operator')`;
  await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${ids.campaignId}, ${ids.orgId}, ${ids.workspaceId}, ${label}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea) VALUES (${ids.storyId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, ${label}, 'Idea') ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO ai_story_versions (id, story_id, version_number, structured_content, frozen_at) VALUES (${ids.storyVersionId}, ${ids.storyId}, 1, ${sql.json({})}, NOW()) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO ai_story_animation_packages (id, org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload) VALUES (${ids.animationPackageId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, ${ids.storyId}, ${ids.storyVersionId}, 'ready_for_execution', ${sql.json(scenePlanPayload)}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path) VALUES (${ids.assetId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, 'image', ${`${label}/asset.png`}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO campaign_asset_refs (campaign_id, asset_id) VALUES (${ids.campaignId}, ${ids.assetId}) ON CONFLICT DO NOTHING`;
}

async function wipeOrg(sql: Sql, orgId: string, workspaceId: string, campaignId: string, ids: typeof PHASE_2A_IDS) {
  await sql`DELETE FROM ai_story_assembly_scene_memberships WHERE org_id = ${orgId}`;
  await sql`DELETE FROM ai_story_assembly_definitions WHERE org_id = ${orgId}`;
  await sql`DELETE FROM ai_story_story_review_facts WHERE org_id = ${orgId}`;
  await sql`DELETE FROM ai_story_scene_intent_review_facts WHERE org_id = ${orgId}`;
  await sql`DELETE FROM ai_story_review_opened_facts WHERE org_id = ${orgId}`;
  await sql`DELETE FROM ai_story_scene_intent_validation_results WHERE org_id = ${orgId}`;
  await sql`DELETE FROM ai_story_scene_executions WHERE org_id = ${orgId}`;
  await sql`DELETE FROM ai_story_execution_plans WHERE org_id = ${orgId}`;
  await sql`DELETE FROM ai_story_scene_instruction_snapshots WHERE org_id = ${orgId}`;
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${workspaceId}`;
  await sql`DELETE FROM campaign_asset_refs WHERE campaign_id = ${campaignId}`;
  await sql`DELETE FROM assets WHERE id = ${ids.assetId}`;
  await sql`DELETE FROM ai_story_animation_packages WHERE id = ${ids.animationPackageId}`;
  await sql`DELETE FROM ai_story_versions WHERE id = ${ids.storyVersionId}`;
  await sql`DELETE FROM ai_stories WHERE id = ${ids.storyId}`;
  await sql`DELETE FROM campaigns WHERE id = ${campaignId}`;
  await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
  await sql`DELETE FROM organizations WHERE id = ${orgId}`;
}

describeIntegration("Sprint 3 Phase 2B PR 2B.4 review/assembly read model integration", () => {
  let sql: Sql;
  let planId = "";
  let sceneIds: string[] = [];

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

    await wipeOrg(sql, PHASE_2A_IDS.orgId, PHASE_2A_IDS.workspaceId, PHASE_2A_IDS.campaignId, PHASE_2A_IDS);
    await seedTenant(sql, PHASE_2A_IDS, USER_A, "2b4-a");

    const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({ instructionPurpose: "pr2b4" })
    );
    planId = persisted.plan.storyExecutionId;
    sceneIds = persisted.intents.map((i) => i.identity.sceneExecutionId);
  }, 180_000);

  afterAll(async () => {
    await wipeOrg(sql, PHASE_2A_IDS.orgId, PHASE_2A_IDS.workspaceId, PHASE_2A_IDS.campaignId, PHASE_2A_IDS);
    await sql.end();
    await closeDb();
  }, 120_000);

  it("open → scene approve → story approve → assembly → readiness derived; execution always locked", async () => {
    const review = new ExecutionPlanReviewRepository();
    await review.openReview({ executionPlanId: planId, openedBy: USER_A });
    for (const sceneExecutionId of sceneIds) {
      await review.appendSceneIntentDecision({
        executionPlanId: planId,
        sceneExecutionId,
        decision: "APPROVED",
        reviewedBy: USER_A,
      });
    }
    await review.appendStoryDecision({
      executionPlanId: planId,
      decision: "APPROVED",
      reviewedBy: USER_A,
    });

    await expect(
      new ExecutionPlanAssemblyRepository().createOrReturnAssembly({
        executionPlanId: planId,
        createdBy: USER_A,
      })
    ).resolves.toMatchObject({ replayed: false });

    const [plan] = await sql<
      {
        id: string;
        org_id: string;
        workspace_id: string;
        campaign_id: string;
        story_id: string;
        story_version_id: string;
        animation_package_id: string;
      }[]
    >`SELECT * FROM ai_story_execution_plans WHERE id = ${planId}`;

    const { getDb } = await import("@ceo-agent/db");
    const ctx = {
      db: getDb(),
      userId: USER_A,
      campaignId: PHASE_2A_IDS.campaignId,
      storyId: PHASE_2A_IDS.storyId,
      executionPlanId: planId,
      orgId: plan!.org_id,
      workspaceId: plan!.workspace_id,
      plan: {
        id: plan!.id,
        orgId: plan!.org_id,
        workspaceId: plan!.workspace_id,
        campaignId: plan!.campaign_id,
        storyId: plan!.story_id,
        storyVersionId: plan!.story_version_id,
        animationPackageId: plan!.animation_package_id,
      } as never,
    };

    const readModel = await buildExecutionPlanReviewAssemblyReadModel(ctx);
    expect(readModel.review.status).toBe("APPROVED");
    expect(readModel.assemblyDefinition.status).toBe("PERSISTED");
    expect(readModel.executionPlan.readiness).toBe("READY_FOR_EXECUTION");
    expect(readModel.executionReadiness).toBe("READY_FOR_EXECUTION");
    expect(readModel.executionAllowed).toBe(false);
    expect(readModel.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
    expect(JSON.stringify(readModel)).not.toMatch(/"shots"|"prompt"|credentials/i);

    const history = await buildReviewHistoryReadModel(ctx);
    expect(history.events.some((e) => e.kind === "REVIEW_OPENED")).toBe(true);
    expect(history.events.filter((e) => e.kind === "SCENE_DECISION").length).toBe(sceneIds.length);
    expect(history.events.some((e) => e.kind === "STORY_DECISION")).toBe(true);
    expect(history.executionAllowed).toBe(false);
  }, 180_000);

  it("assembly blocked before review approved", async () => {
    const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({
        instructionPurpose: `pr2b4-blocked-${Date.now()}`,
      })
    );
    await new ExecutionPlanReviewRepository().openReview({
      executionPlanId: persisted.plan.storyExecutionId,
      openedBy: USER_A,
    });
    await expect(
      new ExecutionPlanAssemblyRepository().createOrReturnAssembly({
        executionPlanId: persisted.plan.storyExecutionId,
        createdBy: USER_A,
      })
    ).rejects.toMatchObject({ code: "ASSEMBLY_STATE_INVALID" });

    await sql`DELETE FROM ai_story_scene_intent_validation_results WHERE execution_plan_id = ${persisted.plan.storyExecutionId}`;
    await sql`DELETE FROM ai_story_scene_executions WHERE execution_plan_id = ${persisted.plan.storyExecutionId}`;
    await sql`DELETE FROM ai_story_review_opened_facts WHERE execution_plan_id = ${persisted.plan.storyExecutionId}`;
    await sql`DELETE FROM ai_story_execution_plans WHERE id = ${persisted.plan.storyExecutionId}`;
  }, 120_000);

  it("foreign workspace plan does not appear under workspace A ownership filter", async () => {
    await seedTenant(sql, PHASE_2A_WORKSPACE_B_IDS, "20000000-0000-4000-8000-000000000040", "2b4-b");
    const foreign = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      makePhase2aCompilation({
        ids: PHASE_2A_WORKSPACE_B_IDS,
        instructionPurpose: "pr2b4-foreign",
      })
    );
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM ai_story_execution_plans
      WHERE id = ${foreign.plan.storyExecutionId}
        AND campaign_id = ${PHASE_2A_IDS.campaignId}
        AND story_id = ${PHASE_2A_IDS.storyId}
    `;
    expect(rows).toHaveLength(0);
    await wipeOrg(
      sql,
      PHASE_2A_WORKSPACE_B_IDS.orgId,
      PHASE_2A_WORKSPACE_B_IDS.workspaceId,
      PHASE_2A_WORKSPACE_B_IDS.campaignId,
      PHASE_2A_WORKSPACE_B_IDS
    );
  }, 120_000);
});
