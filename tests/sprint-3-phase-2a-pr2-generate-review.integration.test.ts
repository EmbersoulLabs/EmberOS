/**
 * Sprint 3 Phase 2A PR2 — Generate Review auto-persist integration (DB).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { closeDb, getDb } from "@ceo-agent/db";
import { createGenerateReview } from "../packages/agents/src/ai-story/story-execution-orchestrator";
import {
  AnimationPackagePayloadSchema,
  CreativeContextSchema,
  DirectorThinkingSchema,
  PHASE1_EXECUTION_LOCKED,
  type AnimationPackagePayload,
} from "@ceo-agent/shared";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { PHASE_2A_IDS } from "./helpers/ai-story-phase-2a";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

function pr2AnimationPackage(assetId: string): AnimationPackagePayload {
  const story = {
    title: "Launch",
    summary: "A shopper discovers the brand.",
    objective: "Awareness",
    targetAudience: "Busy gift buyers",
    tone: "Warm",
    estimatedDuration: "30s",
    story: {
      opening: "The hero needs a gift.",
      development: "The brand solves the problem.",
      ending: "The hero shares the gift.",
    },
    keyMessages: ["Simple gifting"],
    cta: "Shop now",
    assetReferences: [assetId],
    warnings: [],
  };
  const creativeContext = CreativeContextSchema.parse({
    storyContext: {
      title: story.title,
      summary: story.summary,
      objective: story.objective,
      targetAudience: story.targetAudience,
      tone: story.tone,
      estimatedDuration: story.estimatedDuration,
      keyMessages: story.keyMessages,
      cta: story.cta,
    },
    characterContext: {
      characters: [
        {
          id: "hero",
          name: "Hero",
          role: "Customer",
          description: "Needs a meaningful gift.",
          motivation: "Make someone feel remembered.",
          visualNotes: "Smart casual.",
        },
      ],
      relationships: [],
    },
    worldContext: {
      locations: ["Apartment"],
      visualStyle: "Clean",
      lighting: "Soft",
      environment: "Urban home",
      objects: ["gift box"],
      timeline: "Morning",
      worldRules: ["Keep brand colors visible"],
    },
    narrativeContext: {
      arc: "Need to relief",
      pacing: "Quick",
      emotionalJourney: "Concern to delight",
      themes: ["thoughtfulness"],
      dialogue: [],
    },
    directorContext: {},
  });
  const directorThinking = DirectorThinkingSchema.parse({
    coreMessage: "Thoughtful gifting can be simple.",
    hero: "Hero",
    conflict: "No time to find a gift.",
    turningPoint: "Hero discovers the product.",
    climax: "Gift reveal lands emotionally.",
    takeaway: "Shop now for simple gifting.",
  });
  return AnimationPackagePayloadSchema.parse({
    story,
    characters: creativeContext.characterContext.characters,
    creativeContext: { ...creativeContext, directorContext: directorThinking },
    directorThinking,
    storyBeats: [
      {
        id: "beat-001",
        name: "Opening",
        purpose: "Introduce need",
        order: 0,
        summary: "Hero realizes a gift is needed.",
      },
      {
        id: "beat-002",
        name: "Discovery",
        purpose: "Show product",
        order: 1,
        summary: "Hero finds the product.",
      },
    ],
    scenePlan: [
      {
        id: "scene-001",
        beatIds: ["beat-001"],
        purpose: "Need",
        durationSec: 6,
        transition: "Cut",
        continuityNotes: "Warm light",
        order: 0,
      },
      {
        id: "scene-002",
        beatIds: ["beat-002"],
        purpose: "Discovery",
        durationSec: 8,
        transition: "Dissolve",
        continuityNotes: "Same apartment",
        order: 1,
      },
    ],
    shotPlan: [
      {
        id: "shot-001",
        sceneId: "scene-001",
        cameraType: "Close-up",
        cameraMovement: "Slow push",
        composition: "Product foreground",
        framing: "Vertical",
        lensSuggestion: "35mm",
        durationSec: 3,
        focus: "Gift box",
        emotion: "Concern",
        information: "Need established",
        order: 0,
      },
      {
        id: "shot-002",
        sceneId: "scene-001",
        cameraType: "Medium",
        cameraMovement: "Static",
        composition: "Hero center",
        framing: "Vertical",
        lensSuggestion: "50mm",
        durationSec: 3,
        focus: "Hero face",
        emotion: "Relief beginning",
        information: "Hero reacts",
        order: 1,
      },
      {
        id: "shot-003",
        sceneId: "scene-002",
        cameraType: "Close-up",
        cameraMovement: "Orbit",
        composition: "Product hero",
        framing: "Vertical",
        lensSuggestion: "35mm",
        durationSec: 8,
        focus: "Product label",
        emotion: "Delight",
        information: "Product solves need",
        order: 0,
      },
    ],
    characterContinuity: [
      {
        characterId: "hero",
        name: "Hero",
        appearance: "Smart casual",
        emotion: "Concern then delight",
        costume: "Neutral shirt",
        accessories: "Phone",
        age: "Adult",
        pose: "Leaning toward product",
        identity: "Customer hero",
      },
    ],
    worldContinuity: {
      location: "Apartment",
      lighting: "Soft morning light",
      environment: "Urban home",
      objects: ["gift box"],
      timeline: "One morning",
      worldRules: ["Keep brand colors visible"],
    },
    narrative: creativeContext.narrativeContext,
    narrativeIntegration: { consistent: true, issues: [], links: [] },
    status: "ready_for_execution",
  });
}

describeIntegration("Sprint 3 Phase 2A PR2 Generate Review persistence", () => {
  let sql: Sql;
  const orgIds = [PHASE_2A_IDS.orgId];
  const payload = pr2AnimationPackage(PHASE_2A_IDS.assetId);

  beforeAll(async () => {
    sql = createIntegrationSql();
    const migration = readFileSync(
      resolve(__dirname, "../packages/db/sql/ai-story-scene-execution-persistence-v1.sql"),
      "utf8"
    );
    for (const statement of migration.split(";").map((part) => part.trim()).filter(Boolean)) {
      await sql.unsafe(statement);
    }

    await sql`DELETE FROM ai_story_scene_intent_validation_results WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_executions WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_execution_plans WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_instruction_snapshots WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM campaign_asset_refs WHERE campaign_id = ${PHASE_2A_IDS.campaignId}`;
    await sql`DELETE FROM assets WHERE id = ${PHASE_2A_IDS.assetId}`;
    await sql`DELETE FROM ai_story_animation_packages WHERE id = ${PHASE_2A_IDS.animationPackageId}`;
    await sql`DELETE FROM ai_story_versions WHERE id = ${PHASE_2A_IDS.storyVersionId}`;
    await sql`DELETE FROM ai_stories WHERE id = ${PHASE_2A_IDS.storyId}`;
    await sql`DELETE FROM campaigns WHERE id = ${PHASE_2A_IDS.campaignId}`;
    await sql`DELETE FROM workspaces WHERE id = ${PHASE_2A_IDS.workspaceId}`;
    await sql`DELETE FROM organizations WHERE id = ANY(${orgIds})`;

    await sql`INSERT INTO organizations (id, name, slug) VALUES (${PHASE_2A_IDS.orgId}, 'Phase 2A PR2', 'phase-2a-pr2')`;
    await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.orgId}, 'Phase 2A PR2', 'phase-2a-pr2')`;
    await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, 'Phase 2A PR2')`;
    await sql`INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea, status) VALUES (${PHASE_2A_IDS.storyId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId}, 'Story', 'Idea', 'ready_for_execution')`;
    await sql`INSERT INTO ai_story_versions (id, story_id, version_number, structured_content, frozen_at) VALUES (${PHASE_2A_IDS.storyVersionId}, ${PHASE_2A_IDS.storyId}, 1, ${sql.json({})}, NOW())`;
    await sql`INSERT INTO ai_story_animation_packages (id, org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload) VALUES (${PHASE_2A_IDS.animationPackageId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.storyId}, ${PHASE_2A_IDS.storyVersionId}, 'ready_for_execution', ${sql.json(payload)})`;
    await sql`INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path) VALUES (${PHASE_2A_IDS.assetId}, ${PHASE_2A_IDS.orgId}, ${PHASE_2A_IDS.workspaceId}, ${PHASE_2A_IDS.campaignId}, 'image', 'phase-2a-pr2/asset.png')`;
    await sql`INSERT INTO campaign_asset_refs (campaign_id, asset_id) VALUES (${PHASE_2A_IDS.campaignId}, ${PHASE_2A_IDS.assetId})`;
  }, 60_000);

  afterAll(async () => {
    await sql`DELETE FROM ai_story_scene_intent_validation_results WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_executions WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_execution_plans WHERE org_id = ANY(${orgIds})`;
    await sql`DELETE FROM ai_story_scene_instruction_snapshots WHERE org_id = ANY(${orgIds})`;
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

  it(
    "Generate Review auto-persists and reloads the same IDs while remaining locked",
    async () => {
      const db = getDb();
      const outboxBefore = await sql`
        SELECT count(*)::int AS count FROM provider_outbox
      `.catch(() => [{ count: 0 }]);
      const jobsBefore =
        await sql`SELECT count(*)::int AS count FROM ai_story_execution_jobs`;

      const first = await createGenerateReview({
        db,
        campaignId: PHASE_2A_IDS.campaignId,
        storyId: PHASE_2A_IDS.storyId,
        workspaceId: PHASE_2A_IDS.workspaceId,
        orgId: PHASE_2A_IDS.orgId,
      });

      expect(first.overallQcStatus).not.toBe("failed");
      expect(first.persistenceStatus).toBe("persisted");
      expect(first.storyExecutionId).toBeTruthy();
      expect(first.sceneExecutionIds.length).toBeGreaterThan(0);
      expect(first.compilationHash).toBeTruthy();
      expect(first.executionAllowed).toBe(false);
      expect(first.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
      expect(first.validationSummary.overallQcStatus).toBe(first.overallQcStatus);

      const planRows =
        await sql`SELECT count(*)::int AS count FROM ai_story_execution_plans WHERE id = ${first.storyExecutionId}`;
      expect(planRows[0]?.count).toBe(1);

      const second = await createGenerateReview({
        db,
        campaignId: PHASE_2A_IDS.campaignId,
        storyId: PHASE_2A_IDS.storyId,
        workspaceId: PHASE_2A_IDS.workspaceId,
        orgId: PHASE_2A_IDS.orgId,
      });

      expect(second.persistenceStatus).toBe("reloaded");
      expect(second.storyExecutionId).toBe(first.storyExecutionId);
      expect(second.sceneExecutionIds).toEqual(first.sceneExecutionIds);
      expect(second.compilationHash).toBe(first.compilationHash);
      expect(second.executionAllowed).toBe(false);
      expect(second.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);

      const planRowsAfter =
        await sql`SELECT count(*)::int AS count FROM ai_story_execution_plans WHERE org_id = ${PHASE_2A_IDS.orgId}`;
      expect(planRowsAfter[0]?.count).toBe(1);

      const jobsAfter =
        await sql`SELECT count(*)::int AS count FROM ai_story_execution_jobs`;
      expect(jobsAfter[0]?.count).toBe(jobsBefore[0]?.count);

      const outboxAfter = await sql`
        SELECT count(*)::int AS count FROM provider_outbox
      `.catch(() => outboxBefore);
      expect(outboxAfter[0]?.count).toBe(outboxBefore[0]?.count);
    },
    120_000
  );
});
