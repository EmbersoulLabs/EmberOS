/**
 * Sprint 3 Phase 2B PR 2B.1 — Human Review repository integration tests.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AiStorySceneExecutionPersistenceRepository,
  ExecutionPlanReviewIdentityConflictError,
  ExecutionPlanReviewOwnershipError,
  ExecutionPlanReviewRepository,
  ExecutionPlanReviewStateError,
  closeDb,
} from "@ceo-agent/db";
import {
  PHASE1_EXECUTION_LOCKED,
  assertPhase1ExecutionLocked,
  Phase1ExecutionLockedError,
} from "@ceo-agent/shared";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { makePhase2aCompilation, PHASE_2A_IDS } from "./helpers/ai-story-phase-2a";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

const REVIEWER_ID = "10000000-0000-4000-8000-000000000040";
const UNAUTH_REVIEWER_ID = "10000000-0000-4000-8000-000000000041";

const scenePlanPayload = {
  scenePlan: [
    { id: "scene-a", beatIds: ["beat-0"], purpose: "A", durationSec: 3, transition: "cut", continuityNotes: "", order: 0 },
    { id: "scene-b", beatIds: ["beat-1"], purpose: "B", durationSec: 3, transition: "cut", continuityNotes: "", order: 1 },
  ],
};

describeIntegration("Sprint 3 Phase 2B PR 2B.1 human review persistence", () => {
  let sql: Sql;
  const orgIds = [PHASE_2A_IDS.orgId];

  beforeAll(async () => {
    sql = createIntegrationSql();
    for (const relative of [
      "../packages/db/sql/ai-story-scene-execution-persistence-v1.sql",
      "../packages/db/sql/ai-story-human-review-persistence-v1.sql",
    ]) {
      const migration = readFileSync(resolve(__dirname, relative), "utf8");
      for (const statement of migration.split(";").map((part) => part.trim()).filter(Boolean)) {
        await sql.unsafe(statement);
      }
    }

    await sql`DELETE FROM ai_story_story_review_facts WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_intent_review_facts WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_review_opened_facts WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_intent_validation_results WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_executions WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_execution_plans WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_instruction_snapshots WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM workspace_members WHERE workspace_id = ${PHASE_2A_IDS.workspaceId}`;
    await sql`DELETE FROM campaign_asset_refs WHERE campaign_id = ${PHASE_2A_IDS.campaignId}`;
    await sql`DELETE FROM assets WHERE id = ${PHASE_2A_IDS.assetId}`;
    await sql`DELETE FROM ai_story_animation_packages WHERE id = ${PHASE_2A_IDS.animationPackageId}`;
    await sql`DELETE FROM ai_story_versions WHERE id = ${PHASE_2A_IDS.storyVersionId}`;
    await sql`DELETE FROM ai_stories WHERE id = ${PHASE_2A_IDS.storyId}`;
    await sql`DELETE FROM campaigns WHERE id = ${PHASE_2A_IDS.campaignId}`;
    await sql`DELETE FROM workspaces WHERE id = ${PHASE_2A_IDS.workspaceId}`;
    await sql`DELETE FROM organizations WHERE id = ANY(${orgIds})`;

    await sql`INSERT INTO organizations (id, name, slug) VALUES (${PHASE_2A_IDS.orgId}, 'Phase 2B.1', 'phase-2b1-review')`;
    await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.orgId}, 'Phase 2B.1', 'phase-2b1')`;
    await sql`INSERT INTO workspace_members (org_id, workspace_id, user_id, role) VALUES (${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${REVIEWER_ID}, 'operator')`;
    await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, 'Phase 2B.1')`;
    await sql`INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea) VALUES (${PHASE_2A_IDS.storyId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId}, 'Story', 'Idea')`;
    await sql`INSERT INTO ai_story_versions (id, story_id, version_number, structured_content, frozen_at) VALUES (${PHASE_2A_IDS.storyVersionId}, ${PHASE_2A_IDS.storyId}, 1, ${sql.json({})}, NOW())`;
    await sql`INSERT INTO ai_story_animation_packages (id, org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload) VALUES (${PHASE_2A_IDS.animationPackageId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.storyId}, ${PHASE_2A_IDS.storyVersionId}, 'ready_for_execution', ${sql.json(scenePlanPayload)})`;
    await sql`INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path) VALUES (${PHASE_2A_IDS.assetId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId}, 'image', 'phase-2b1/asset.png')`;
    await sql`INSERT INTO campaign_asset_refs (campaign_id, asset_id) VALUES (${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.assetId})`;
  }, 60_000);

  afterAll(async () => {
    await sql`DELETE FROM ai_story_story_review_facts WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_intent_review_facts WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_review_opened_facts WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_intent_validation_results WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_executions WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_execution_plans WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_instruction_snapshots WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM workspace_members WHERE workspace_id = ${PHASE_2A_IDS.workspaceId}`;
    await sql`DELETE FROM campaign_asset_refs WHERE campaign_id = ${PHASE_2A_IDS.campaignId}`;
    await sql`DELETE FROM assets WHERE id = ${PHASE_2A_IDS.assetId}`;
    await sql`DELETE FROM ai_story_animation_packages WHERE id = ${PHASE_2A_IDS.animationPackageId}`;
    await sql`DELETE FROM ai_story_versions WHERE id = ${PHASE_2A_IDS.storyVersionId}`;
    await sql`DELETE FROM ai_stories WHERE id = ${PHASE_2A_IDS.storyId}`;
    await sql`DELETE FROM campaigns WHERE id = ${PHASE_2A_IDS.campaignId}`;
    await sql`DELETE FROM workspaces WHERE id = ${PHASE_2A_IDS.workspaceId}`;
    await sql`DELETE FROM organizations WHERE id = ANY(${orgIds})`;
    await sql.end();
    await closeDb();
  }, 60_000);

  async function persistPlan() {
    const persistence = new AiStorySceneExecutionPersistenceRepository();
    return persistence.persistCompilation(makePhase2aCompilation());
  }

  it(
    "creates review, approves all Scenes and Story, derives APPROVED, stays execution-locked",
    async () => {
      const persisted = await persistPlan();
      const planId = persisted.plan.storyExecutionId;
      const review = new ExecutionPlanReviewRepository();

      const opened = await review.openReview({
        executionPlanId: planId,
        openedBy: REVIEWER_ID,
        openedAt: "2026-08-03T12:00:00.000Z",
      });
      const openedAgain = await review.openReview({
        executionPlanId: planId,
        openedBy: REVIEWER_ID,
        openedAt: "2026-08-03T13:00:00.000Z",
      });
      expect(openedAgain.factId).toBe(opened.factId);
      expect(openedAgain.openedAt).toBe(opened.openedAt);

      for (const intent of persisted.intents) {
        const decision = await review.appendSceneIntentDecision({
          executionPlanId: planId,
          sceneExecutionId: intent.identity.sceneExecutionId,
          decision: "APPROVED",
          reviewedBy: REVIEWER_ID,
          reviewedAt: "2026-08-03T12:10:00.000Z",
        });
        const replayed = await review.appendSceneIntentDecision({
          executionPlanId: planId,
          sceneExecutionId: intent.identity.sceneExecutionId,
          decision: "APPROVED",
          reviewedBy: REVIEWER_ID,
          reviewedAt: "2026-08-03T12:10:00.000Z",
        });
        expect(replayed.factId).toBe(decision.factId);
        expect(replayed.reviewedAt).toBe(decision.reviewedAt);
      }

      const story = await review.appendStoryDecision({
        executionPlanId: planId,
        decision: "APPROVED",
        reviewedBy: REVIEWER_ID,
        reviewedAt: "2026-08-03T12:20:00.000Z",
      });
      const storyReplay = await review.appendStoryDecision({
        executionPlanId: planId,
        decision: "APPROVED",
        reviewedBy: REVIEWER_ID,
        reviewedAt: "2026-08-03T12:20:00.000Z",
      });
      expect(storyReplay.factId).toBe(story.factId);

      const projection = await review.getLogicalProjection(planId);
      expect(projection?.status).toBe("APPROVED");
      expect(projection?.opened?.factId).toBe(opened.factId);
      expect(projection?.storyDecision?.factId).toBe(story.factId);

      const openedCount =
        await sql`SELECT count(*)::int AS count FROM ai_story_review_opened_facts WHERE execution_plan_id = ${planId}`;
      expect(openedCount[0]?.count).toBe(1);

      expect(() => assertPhase1ExecutionLocked()).toThrow(Phase1ExecutionLockedError);
      expect(PHASE1_EXECUTION_LOCKED).toBe("PHASE1_EXECUTION_LOCKED");
    },
    120_000
  );

  it(
    "rejects a Scene, derives REJECTED, and blocks REJECTED → APPROVED",
    async () => {
      const input = makePhase2aCompilation({ instructionPurpose: "reject-path" });
      const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
        input
      );
      const planId = persisted.plan.storyExecutionId;
      const review = new ExecutionPlanReviewRepository();
      await review.openReview({ executionPlanId: planId, openedBy: REVIEWER_ID });

      await review.appendSceneIntentDecision({
        executionPlanId: planId,
        sceneExecutionId: persisted.intents[0]!.identity.sceneExecutionId,
        decision: "REJECTED",
        reviewedBy: REVIEWER_ID,
        reviewedAt: "2026-08-03T14:00:00.000Z",
      });

      const projection = await review.getLogicalProjection(planId);
      expect(projection?.status).toBe("REJECTED");

      await expect(
        review.appendSceneIntentDecision({
          executionPlanId: planId,
          sceneExecutionId: persisted.intents[1]!.identity.sceneExecutionId,
          decision: "APPROVED",
          reviewedBy: REVIEWER_ID,
        })
      ).rejects.toBeInstanceOf(ExecutionPlanReviewStateError);

      await expect(
        review.appendStoryDecision({
          executionPlanId: planId,
          decision: "APPROVED",
          reviewedBy: REVIEWER_ID,
        })
      ).rejects.toBeInstanceOf(ExecutionPlanReviewStateError);
    },
    120_000
  );

  it(
    "fails closed for unauthorized reviewer and story approval without all scenes",
    async () => {
      const input = makePhase2aCompilation({ instructionPurpose: "auth-path" });
      const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
        input
      );
      const planId = persisted.plan.storyExecutionId;
      const review = new ExecutionPlanReviewRepository();

      await expect(
        review.openReview({ executionPlanId: planId, openedBy: UNAUTH_REVIEWER_ID })
      ).rejects.toBeInstanceOf(ExecutionPlanReviewOwnershipError);

      await review.openReview({ executionPlanId: planId, openedBy: REVIEWER_ID });
      await review.appendSceneIntentDecision({
        executionPlanId: planId,
        sceneExecutionId: persisted.intents[0]!.identity.sceneExecutionId,
        decision: "APPROVED",
        reviewedBy: REVIEWER_ID,
      });

      await expect(
        review.appendStoryDecision({
          executionPlanId: planId,
          decision: "APPROVED",
          reviewedBy: REVIEWER_ID,
        })
      ).rejects.toBeInstanceOf(ExecutionPlanReviewStateError);
    },
    120_000
  );

  it(
    "fails closed on conflicting Story review replay and verifies append-only counts",
    async () => {
      const input = makePhase2aCompilation({ instructionPurpose: "conflict-path" });
      const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
        input
      );
      const planId = persisted.plan.storyExecutionId;
      const review = new ExecutionPlanReviewRepository();
      await review.openReview({ executionPlanId: planId, openedBy: REVIEWER_ID });
      for (const intent of persisted.intents) {
        await review.appendSceneIntentDecision({
          executionPlanId: planId,
          sceneExecutionId: intent.identity.sceneExecutionId,
          decision: "APPROVED",
          reviewedBy: REVIEWER_ID,
        });
      }
      await review.appendStoryDecision({
        executionPlanId: planId,
        decision: "APPROVED",
        reviewedBy: REVIEWER_ID,
        rationale: "first",
      });

      await expect(
        review.appendStoryDecision({
          executionPlanId: planId,
          decision: "APPROVED",
          reviewedBy: REVIEWER_ID,
          rationale: "different-binding",
        })
      ).rejects.toBeInstanceOf(ExecutionPlanReviewIdentityConflictError);

      const storyCount =
        await sql`SELECT count(*)::int AS count FROM ai_story_story_review_facts WHERE execution_plan_id = ${planId}`;
      expect(storyCount[0]?.count).toBe(1);

      const outboxBefore = await sql`SELECT count(*)::int AS count FROM provider_outbox`.catch(
        () => [{ count: 0 }]
      );
      const outboxAfter = await sql`SELECT count(*)::int AS count FROM provider_outbox`.catch(
        () => outboxBefore
      );
      expect(outboxAfter[0]?.count).toBe(outboxBefore[0]?.count);
    },
    120_000
  );
});
