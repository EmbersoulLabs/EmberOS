import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { AiStoryOutlineAuthorityService } from "@ceo-agent/db";
import { buildAiStoryOutlineVersion } from "@ceo-agent/shared/server";
import {
  RUN_DB_INTEGRATION,
  cleanupRlsFixture,
  createIntegrationSql,
  getIntegrationDbUrl,
  seedRlsFixture,
  withAuthenticatedUser,
  type RlsTestFixture,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const STORY_ID = "30000000-0000-4000-8000-000000000001";
const STORY_VERSION_ID = "30000000-0000-4000-8000-000000000002";
const OUTLINE_B = "30000000-0000-4000-8000-000000000004";
const UNIT_ID = "30000000-0000-4000-8000-000000000005";
const SETUP_BEAT_ID = "30000000-0000-4000-8000-000000000006";
const PAYOFF_BEAT_ID = "30000000-0000-4000-8000-000000000007";
const RELATIONSHIP_ID = "30000000-0000-4000-8000-000000000008";
const OUTCOME_ID = "30000000-0000-4000-8000-000000000009";

describeIntegration("AI Story Outline additive persistence and isolation", () => {
  let sql: Sql;
  let fixture: RlsTestFixture;
  let outlineAId: string;
  let outlineCId: string;

  beforeAll(async () => {
    sql = createIntegrationSql();
    fixture = await seedRlsFixture(sql);
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-v1.sql"), "utf8"));
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-outline-v1.sql"), "utf8"));
    await sql`insert into ai_stories(id,org_id,workspace_id,campaign_id,title,original_idea,status)
      values(${STORY_ID}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,'Outline test','Idea','draft')`;
    await sql`insert into ai_story_versions(id,story_id,version_number,structured_content)
      values(${STORY_VERSION_ID}::uuid,${STORY_ID}::uuid,1,${sql.json({ title: "Legacy", summary: "", objective: "", targetAudience: "", tone: "", estimatedDuration: "", story: { opening: "", development: "", ending: "" }, keyMessages: [], cta: "", assetReferences: [], warnings: [] })})`;
    const service = new AiStoryOutlineAuthorityService();
    const scope = { orgId: fixture.orgId, workspaceId: fixture.workspaceAId, campaignId: fixture.campaignAId, storyId: STORY_ID, storyVersionId: STORY_VERSION_ID, actorUserId: fixture.userAId };
    const first = buildAiStoryOutlineVersion({
      storyId: STORY_ID, storyVersionId: STORY_VERSION_ID, orgId: fixture.orgId, workspaceId: fixture.workspaceAId,
      version: 1, profile: { profileId: "CORE", profileVersion: 1 }, premise: "Evidence earns trust", coreClaim: "Verified product facts change a decision",
      storyUnits: [{ storyUnitId: UNIT_ID, order: 0, purpose: "Complete story", summary: "Question and proof", requiredBeatIds: [SETUP_BEAT_ID, PAYOFF_BEAT_ID], terminalPayoffId: RELATIONSHIP_ID }],
      beats: [
        { id: SETUP_BEAT_ID, storyUnitId: UNIT_ID, order: 0, classification: "MAJOR", name: "Question", purpose: "Establish doubt", summary: "Evidence is required", required: true, ownershipPolicy: "EXCLUSIVE", authorityReferences: [] },
        { id: PAYOFF_BEAT_ID, storyUnitId: UNIT_ID, order: 1, classification: "MAJOR", name: "Proof", purpose: "Resolve doubt", summary: "Evidence resolves doubt", required: true, ownershipPolicy: "EXCLUSIVE", authorityReferences: [] },
      ],
      hooks: [], setupPayoffs: [{ relationshipId: RELATIONSHIP_ID, setupBeatId: SETUP_BEAT_ID, payoffBeatId: PAYOFF_BEAT_ID, relationshipType: "QUESTION_ANSWER", required: true, intent: "Resolve the question" }],
      requiredSceneOutcomes: [{ outcomeId: OUTCOME_ID, order: 0, outcomeType: "DEMONSTRATE_CONSEQUENCE", description: "Demonstrate the decision change", beatIds: [PAYOFF_BEAT_ID], authorityReferences: [] }],
      authorityReferences: [], upstreamAuthorityId: `${fixture.campaignAId}:${STORY_VERSION_ID}`, supersedesOutlineVersionId: null,
      createdBy: fixture.userAId, createdAt: "2026-08-28T00:00:00.000Z",
    });
    outlineAId = first.outlineVersionId;
    await service.propose(scope, first);
    await service.validate(scope, outlineAId);
    await service.approve(scope, outlineAId);
    await service.freeze(scope, outlineAId);
    const {
      outlineVersionId: _outlineVersionId, contractVersion: _contractVersion, sourceHash: _sourceHash,
      status: _status, approvedBy: _approvedBy, approvedAt: _approvedAt, frozenAt: _frozenAt,
      ...firstInput
    } = first;
    const second = buildAiStoryOutlineVersion({ ...firstInput, version: 2, premise: "Evidence builds durable trust", supersedesOutlineVersionId: outlineAId, createdAt: "2026-08-28T00:01:00.000Z" });
    outlineCId = second.outlineVersionId;
    await service.propose(scope, second);
    await service.validate(scope, outlineCId);
    await service.approve(scope, outlineCId);
    await service.freeze(scope, outlineCId);
    await sql`insert into ai_story_outline_versions(outline_version_id,org_id,workspace_id,campaign_id,story_id,story_version_id,version,contract_version,profile_id,profile_version,source_hash,status,outline,created_by,created_at)
      values(${OUTLINE_B}::uuid,${fixture.orgId}::uuid,${fixture.workspaceBId}::uuid,${fixture.campaignAId}::uuid,${STORY_ID}::uuid,${STORY_VERSION_ID}::uuid,3,'ai-story-outline.v1','CORE',1,${`sha256:${"b".repeat(64)}`} ,'DRAFT',${sql.json({ status: "DRAFT", premise: "Cross-workspace" })},${fixture.userAId}::uuid,now())`;
  }, 30_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from ai_story_outline_versions where story_id=${STORY_ID}::uuid`;
    await sql`delete from ai_story_versions where story_id=${STORY_ID}::uuid`;
    await sql`delete from ai_stories where id=${STORY_ID}::uuid`;
    await cleanupRlsFixture(sql, fixture);
    await sql.end();
  }, 30_000);

  it("enables RLS and isolates cross-workspace reads", async () => {
    const [rls] = await sql<{ enabled: boolean }[]>`select relrowsecurity enabled from pg_class where oid='ai_story_outline_versions'::regclass`;
    expect(rls?.enabled).toBe(true);
    const rows = await withAuthenticatedUser(sql, fixture.userAId, (tx) => tx<{ outline_version_id: string }[]>`select outline_version_id from ai_story_outline_versions`);
    expect(rows.map((row) => row.outline_version_id).sort()).toEqual([outlineAId, outlineCId].sort());
  });

  it("denies cross-workspace update", async () => {
    const rows = await withAuthenticatedUser(sql, fixture.userAId, (tx) => tx<{ outline_version_id: string }[]>`update ai_story_outline_versions set status='VALIDATED' where outline_version_id=${OUTLINE_B}::uuid returning outline_version_id`);
    expect(rows).toEqual([]);
  });

  it("enforces ordered lifecycle transitions and frozen content immutability in PostgreSQL", async () => {
    await expect(sql`update ai_story_outline_versions set status='APPROVED', outline=jsonb_set(outline,'{status}','"APPROVED"') where outline_version_id=${OUTLINE_B}::uuid`).rejects.toThrow(/lifecycle transition/i);
    await expect(withAuthenticatedUser(sql, fixture.userAId, (tx) => tx`update ai_story_outline_versions set outline=jsonb_set(outline,'{premise}','"Changed"') where outline_version_id=${outlineCId}::uuid`)).rejects.toThrow(/immutable/i);
  });

  it("preserves version history when a frozen Outline is superseded", async () => {
    const rows = await sql<{ outline_version_id: string; status: string; version: number }[]>`select outline_version_id,status,version from ai_story_outline_versions where workspace_id=${fixture.workspaceAId}::uuid order by version`;
    expect(rows).toEqual([
      { outline_version_id: outlineAId, status: "SUPERSEDED", version: 1 },
      { outline_version_id: outlineCId, status: "FROZEN", version: 2 },
    ]);
  });
});
