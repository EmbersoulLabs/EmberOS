import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { AiStoryScriptSemanticProposalAuthorityService, closeDb } from "@ceo-agent/db";
import { AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION } from "@ceo-agent/shared";
import { RUN_DB_INTEGRATION, cleanupRlsFixture, createIntegrationSql, getIntegrationDbUrl, seedRlsFixture, withAuthenticatedUser, type RlsTestFixture } from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const id = (n: number) => `73000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const I = { story: id(1), versionA: id(2), versionB: id(3), character: id(4) };
const fingerprint = `sha256:${"a".repeat(64)}`;
const draft = { title: "Harbor", summary: "A watch", objective: "Continue", targetAudience: "Crews", tone: "Steady", estimatedDuration: "12s", story: { opening: "Dark", development: "Lantern", ending: "Lit" }, keyMessages: [], cta: "", assetReferences: [], warnings: [] };

function proposal(action: string) {
  return {
    contractVersion: AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
    scenes: [{
      scenePlanItemId: "scene-plan-0",
      sceneFunction: "INTRODUCE" as const,
      sceneFunctionRegistryVersion: 1 as const,
      sceneStateIn: [],
      sceneStateDeltas: [],
      sceneStateOut: [],
      entries: [{ type: "ACTION" as const, subjectId: I.character, action, storyEffect: "The watch starts." }],
      newInformation: ["The watch has started."],
      newActionOutcomes: ["The watch is underway."],
    }],
  };
}

describeIntegration("COMMERCIAL_STORY semantic proposal PostgreSQL authority", () => {
  let sql: Sql;
  let fixture: RlsTestFixture;
  let proposalId = "";
  const service = () => new AiStoryScriptSemanticProposalAuthorityService();
  const scope = () => ({
    orgId: fixture.orgId, workspaceId: fixture.workspaceAId, campaignId: fixture.campaignAId,
    storyId: I.story, storyVersionId: I.versionA, actorUserId: fixture.userAId, requireCurrentFrozenStoryVersion: false,
  });

  beforeAll(async () => {
    sql = createIntegrationSql();
    fixture = await seedRlsFixture(sql);
    await sql.unsafe(`DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-script-semantic-proposal-v1.sql"), "utf8"));
    await sql.unsafe("GRANT USAGE ON SCHEMA public TO authenticated; GRANT SELECT, INSERT ON ai_story_script_semantic_proposals TO authenticated");
    await sql`insert into ai_stories(id, org_id, workspace_id, campaign_id, title, original_idea, status) values(${I.story}::uuid, ${fixture.orgId}::uuid, ${fixture.workspaceAId}::uuid, ${fixture.campaignAId}::uuid, 'Harbor Watch', 'One lantern', 'draft')`;
    await sql`insert into ai_story_versions(id, story_id, version_number, structured_content, frozen_at) values(${I.versionA}::uuid, ${I.story}::uuid, 1, ${sql.json(draft)}, now())`;
    await sql`insert into ai_story_versions(id, story_id, version_number, structured_content, frozen_at) values(${I.versionB}::uuid, ${I.story}::uuid, 2, ${sql.json(draft)}, now())`;
    await sql`update ai_stories set current_version_id = ${I.versionA}::uuid where id = ${I.story}::uuid`;
    const authorized = await service().authorize({
      ...scope(), proposal: proposal("The keeper looks across the dark harbor."), semanticInputFingerprint: fingerprint,
      originatingRunId: fingerprint, groundingLineage: { semanticInputFingerprint: fingerprint, storyVersionId: I.versionA },
      authorizedAt: "2026-09-27T00:00:00.000Z", profileId: "COMMERCIAL_STORY", acceptance: "AUTHORIZED",
    });
    proposalId = authorized.proposalId;
  }, 30000);

  afterAll(async () => {
    await closeDb();
    if (!sql) return;
    await sql`delete from ai_story_script_semantic_proposals where story_id = ${I.story}::uuid`;
    await sql`delete from ai_story_versions where story_id = ${I.story}::uuid`;
    await sql`delete from ai_stories where id = ${I.story}::uuid`;
    await cleanupRlsFixture(sql, fixture);
    await sql.end();
  }, 30000);

  it("is idempotent for the same authorized payload and immutable after that", async () => {
    const again = await service().authorize({
      ...scope(), proposal: proposal("The keeper looks across the dark harbor."), semanticInputFingerprint: fingerprint,
      originatingRunId: fingerprint, groundingLineage: { semanticInputFingerprint: fingerprint, storyVersionId: I.versionA },
      authorizedAt: "2026-09-27T00:00:00.000Z", profileId: "COMMERCIAL_STORY",
    });
    expect(again.proposalId).toBe(proposalId);
    await expect(service().authorize({
      ...scope(), proposal: proposal("A different action."), semanticInputFingerprint: fingerprint,
      originatingRunId: "different-run", groundingLineage: { storyVersionId: I.versionA },
      authorizedAt: "2026-09-27T00:01:00.000Z", profileId: "COMMERCIAL_STORY",
    })).rejects.toMatchObject({ code: "SCRIPT_SEMANTIC_PROPOSAL_IMMUTABLE" });
    await expect(withAuthenticatedUser(sql, fixture.userAId, (tx) => tx`update ai_story_script_semantic_proposals set originating_run_id = 'mutated' where proposal_id = ${proposalId}::uuid`)).rejects.toThrow(/immutable/i);
  });

  it("does not resolve another story version, another workspace, or a rejected proposal", async () => {
    await sql`update ai_stories set current_version_id = ${I.versionB}::uuid where id = ${I.story}::uuid`;
    const successor = await service().resolveExact({ ...scope(), storyVersionId: I.versionB, requireCurrentFrozenStoryVersion: true });
    expect(successor).toBeNull();
    const historical = await service().resolveExact({ ...scope(), requireCurrentFrozenStoryVersion: false });
    expect(historical?.proposalId).toBe(proposalId);
    expect(historical?.storyVersionId).toBe(I.versionA);
    const cross = await withAuthenticatedUser(sql, fixture.userBId, (tx) => tx<{ proposal_id: string }[]>`select proposal_id from ai_story_script_semantic_proposals`);
    expect(cross).toEqual([]);
    await expect(service().authorize({ ...scope(), acceptance: "REJECTED" } as never)).rejects.toMatchObject({ code: "SCRIPT_SEMANTIC_PROPOSAL_NOT_AUTHORIZED" });
    const [count] = await sql<{ count: string }[]>`select count(*)::text as count from ai_story_script_semantic_proposals where story_id = ${I.story}::uuid`;
    expect(count?.count).toBe("1");
  });
});
