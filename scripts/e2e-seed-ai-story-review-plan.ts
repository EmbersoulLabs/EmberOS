/**
 * Seed an Execution Plan under an existing campaign/story for PR 2B.5 browser E2E.
 * Usage (env): E2E_SEED_ORG_ID, E2E_SEED_WORKSPACE_ID, E2E_SEED_CAMPAIGN_ID, E2E_SEED_STORY_ID, DATABASE_URL
 * Prints JSON: { executionPlanId }
 */
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  AiStorySceneExecutionPersistenceRepository,
  closeDb,
} from "@ceo-agent/db";
import { createIntegrationSql } from "../tests/helpers/db-integration";
import { makePhase2aCompilation } from "../tests/helpers/ai-story-phase-2a";

config({ path: resolve("apps/worker/.env") });
config({ path: resolve(".env.local") });
config({ path: resolve(".env.e2e.local") });

process.env.RUN_DB_INTEGRATION_TESTS = "1";

async function main() {
  const orgId = process.env.E2E_SEED_ORG_ID?.trim();
  const workspaceId = process.env.E2E_SEED_WORKSPACE_ID?.trim();
  const campaignId = process.env.E2E_SEED_CAMPAIGN_ID?.trim();
  const storyId = process.env.E2E_SEED_STORY_ID?.trim();
  if (!orgId || !workspaceId || !campaignId || !storyId) {
    throw new Error("Missing E2E_SEED_* ids");
  }
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL required");
  }

  const sql = createIntegrationSql();
  const storyVersionId = randomUUID();
  const animationPackageId = randomUUID();
  const assetId = randomUUID();
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

  try {
    await sql`
      UPDATE ai_stories
      SET status = 'generate_review'
      WHERE id = ${storyId}
    `;

    const versions = await sql<{ id: string }[]>`
      SELECT id FROM ai_story_versions WHERE story_id = ${storyId} ORDER BY version_number DESC LIMIT 1
    `;
    const versionId = versions[0]?.id ?? storyVersionId;
    if (!versions[0]) {
      await sql`
        INSERT INTO ai_story_versions (id, story_id, version_number, structured_content, frozen_at)
        VALUES (${versionId}, ${storyId}, 1, ${sql.json({ title: "Review UI story" })}, NOW())
      `;
      await sql`
        UPDATE ai_stories SET current_version_id = ${versionId} WHERE id = ${storyId}
      `;
    }

    const packages = await sql<{ id: string }[]>`
      SELECT id FROM ai_story_animation_packages WHERE story_id = ${storyId} LIMIT 1
    `;
    const packageId = packages[0]?.id ?? animationPackageId;
    if (!packages[0]) {
      await sql`
        INSERT INTO ai_story_animation_packages (
          id, org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload
        ) VALUES (
          ${packageId},
          ${orgId},
          ${workspaceId},
          ${campaignId},
          ${storyId},
          ${versionId},
          'ready_for_execution',
          ${sql.json(scenePlanPayload)}
        )
      `;
    }

    try {
      await sql`
        INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path)
        VALUES (
          ${assetId},
          ${orgId},
          ${workspaceId},
          ${campaignId},
          'image',
          ${`${workspaceId}/e2e-review-asset.png`}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    } catch {
      // best-effort
    }

    const compilation = makePhase2aCompilation({
      ids: {
        orgId,
        workspaceId,
        campaignId,
        storyId,
        storyVersionId: versionId,
        animationPackageId: packageId,
        assetId,
      },
      instructionPurpose: `e2e-ui-${Date.now()}`,
    });

    const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
      compilation
    );
    process.stdout.write(
      JSON.stringify({ executionPlanId: persisted.plan.storyExecutionId }) + "\n"
    );
  } finally {
    await sql.end({ timeout: 5 });
    await closeDb();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
