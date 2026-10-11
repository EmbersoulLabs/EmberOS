import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { closeDb } from "@ceo-agent/db";
import { acceptOriginalCharacterBeforeOutlineFreeze } from "../apps/web/src/lib/ai-story-character-proposal-acceptance";
import { getDb } from "@ceo-agent/db";
import { RUN_DB_INTEGRATION, cleanupRlsFixture, createIntegrationSql, getIntegrationDbUrl, seedRlsFixture, type RlsTestFixture } from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const storyId = "98000000-0000-4000-8000-000000000101";
const versionId = "98000000-0000-4000-8000-000000000102";
const draft = {
  title: "Quiet brand moment", summary: "A brand moment unfolds without a product.", objective: "Leave the audience with a clear feeling.",
  targetAudience: "People", tone: "Quiet", estimatedDuration: "15s",
  story: { opening: "The moment starts.", development: "The moment develops.", ending: "The moment settles." },
  keyMessages: ["Attention can be simple."], cta: "", assetReferences: [], warnings: [],
};
const proposalContext = {
  storyContext: draft, characterContext: { characters: [{ id: "proposed_character_1", name: "Origin", role: "Protagonist", description: "An original person with no reference image.", motivation: "Notice the quiet moment.", visualNotes: "No uploaded reference.", proposalOnly: true }], relationships: [] },
  worldContext: {}, narrativeContext: {}, directorContext: {},
};

describeIntegration("original character acceptance persists before outline freeze", () => {
  let sql: Sql;
  let fixture: RlsTestFixture;

  beforeAll(async () => {
    sql = createIntegrationSql();
    fixture = await seedRlsFixture(sql);
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-character-v1.sql"), "utf8"));
    await sql`insert into ai_stories(id, org_id, workspace_id, campaign_id, title, original_idea, status) values(${storyId}::uuid, ${fixture.orgId}::uuid, ${fixture.workspaceAId}::uuid, ${fixture.campaignAId}::uuid, 'Quiet brand moment', 'A short prompt with no assets', 'planning')`;
    await sql`insert into ai_story_versions(id, story_id, version_number, structured_content, frozen_at) values(${versionId}::uuid, ${storyId}::uuid, 1, ${sql.json(draft)}, now())`;
    await sql`update ai_stories set current_version_id = ${versionId}::uuid where id = ${storyId}::uuid`;
    await sql`insert into ai_story_animation_packages(org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload, consistency_report) values(${fixture.orgId}::uuid, ${fixture.workspaceAId}::uuid, ${fixture.campaignAId}::uuid, ${storyId}::uuid, ${versionId}::uuid, 'generating', ${sql.json({ kind: "planning_draft", completedStages: ["creative_context"], story: draft, creativeContext: proposalContext })}, ${sql.json({ consistent: false, issues: ["Planning draft incomplete"], links: [] })})`;
  }, 30_000);

  afterAll(async () => {
    await closeDb();
    if (!sql) return;
    await sql`delete from ai_story_animation_packages where story_id = ${storyId}::uuid`;
    await sql`delete from ai_story_creative_contexts where story_id = ${storyId}::uuid`;
    await sql`delete from ai_story_character_versions where org_id = ${fixture.orgId}::uuid`;
    await sql`delete from ai_story_characters where org_id = ${fixture.orgId}::uuid`;
    await sql`delete from ai_story_versions where story_id = ${storyId}::uuid`;
    await sql`delete from ai_stories where id = ${storyId}::uuid`;
    await cleanupRlsFixture(sql, fixture);
    await sql.end();
  }, 30_000);

  it("creates a reference-free Campaign Character and replaces the proposal before any outline exists", async () => {
    const accepted = await acceptOriginalCharacterBeforeOutlineFreeze({
      db: getDb(), orgId: fixture.orgId, workspaceId: fixture.workspaceAId, campaignId: fixture.campaignAId,
      storyId, actorUserId: fixture.userAId, proposalKey: "proposed_character_1",
      character: { name: "Origin", identity: "An original person with no reference image.", appearance: "No uploaded reference.", personality: "Quiet and attentive.", emotionalArc: "Notices the moment and lets it settle.", relationships: [], visualAssetIds: [] },
    });
    expect(accepted.characterId).toMatch(/^[0-9a-f-]{36}$/);
    expect(accepted.characterId).not.toBe("proposed_character_1");
    expect(accepted.creativeContext.characterContext.characters[0]?.id).toBe(accepted.characterId);
    expect(accepted.creativeContext.characterContext.characters[0]?.proposalOnly).toBeUndefined();
    const outlines = await sql<{ count: string }[]>`select count(*)::text as count from ai_story_outline_versions where story_id = ${storyId}::uuid`;
    expect(outlines[0]?.count).toBe("0");
    const packages = await sql<{ payload: { creativeContext?: { characterContext?: { characters?: { id?: string }[] } } } }[]>`select payload from ai_story_animation_packages where story_id = ${storyId}::uuid order by created_at desc limit 1`;
    expect(packages[0]?.payload.creativeContext?.characterContext?.characters?.[0]?.id).toBe(accepted.characterId);
    expect(JSON.stringify(packages[0]?.payload)).not.toContain("proposed_character_1");
  });
});
