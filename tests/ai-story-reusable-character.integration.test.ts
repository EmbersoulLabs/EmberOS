import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AiStoryReusableCharacterError,
  AiStoryReusableCharacterService,
  closeDb,
} from "@ceo-agent/db";
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
const SECOND_CAMPAIGN = "62000000-0000-4000-8000-000000000001";
const STORY_A = "62000000-0000-4000-8000-000000000002";
const STORY_B = "62000000-0000-4000-8000-000000000003";
const STORY_C = "62000000-0000-4000-8000-000000000006";
const STORY_D = "62000000-0000-4000-8000-000000000007";
const ASSET = "62000000-0000-4000-8000-000000000004";
const HASH = `sha256:${"a".repeat(64)}`;

const identity = {
  name: "Alicia",
  identityCore: {
    identityDescription: "Alicia is a synthetic restaurant spokesperson.",
    faceIdentityDescription: "Oval face, dark brown eyes, defined brows, medium nose, closed-lip smile.",
    bodyIdentityDescription: "Average adult height with balanced shoulders.",
    distinctiveVisualFacts: ["small beauty mark near the left eye"],
    mustPreserve: ["face identity", "body proportions", "beauty mark"],
    mustNeverChange: ["canonical face identity"],
  },
  defaultLook: { wardrobe: "white outfit", makeup: "natural", accessories: null, hairstyle: "shoulder length", hairColor: "dark brown" },
  mutableLookPolicy: { wardrobeAllowed: true, makeupAllowed: true, accessoriesAllowed: true, hairstyleAllowed: true, hairColorAllowed: false },
  canonicalAssets: [{ assetId: ASSET, role: "IDENTITY_MASTER" as const }],
};

describeIntegration("AI Story reusable Character library persistence and isolation", () => {
  let sql: Sql;
  let fixture: RlsTestFixture;
  let service: AiStoryReusableCharacterService;
  const scope = () => ({ orgId: fixture.orgId, workspaceId: fixture.workspaceAId, actorUserId: fixture.userAId });
  const look = (wardrobe: string) => ({
    wardrobe, makeup: null, accessories: null, hairstyle: null, hairColor: null,
    expression: null, pose: null, location: null, action: null, product: null, dialogue: null,
  });

  beforeAll(async () => {
    sql = createIntegrationSql();
    fixture = await seedRlsFixture(sql);
    service = new AiStoryReusableCharacterService();
    await sql.unsafe(`DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-character-v1.sql"), "utf8"));
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-reusable-character-v1.sql"), "utf8"));
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO authenticated;
      GRANT SELECT,INSERT,UPDATE ON ai_story_characters TO authenticated;
      GRANT SELECT,INSERT ON ai_story_character_versions TO authenticated;
      GRANT SELECT,INSERT,UPDATE ON ai_story_reusable_characters TO authenticated;
      GRANT SELECT,INSERT ON ai_story_reusable_character_versions TO authenticated;
      GRANT SELECT,INSERT ON ai_story_reusable_character_campaign_projections TO authenticated;
      GRANT SELECT,INSERT ON ai_story_episode_character_bindings TO authenticated;
      GRANT SELECT,INSERT,UPDATE ON ai_story_character_continuity_anchors TO authenticated;`);
    await sql`insert into campaigns(id,org_id,workspace_id,name,platforms,status) values(${SECOND_CAMPAIGN}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,'Second same-workspace Campaign',array['tiktok'],'draft')`;
    await sql`insert into assets(id,org_id,workspace_id,campaign_id,type,storage_path,status,source,content_hash) values(${ASSET}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,null,'image','alicia-master.png','ready','campaign_upload',${HASH})`;
    await sql`insert into ai_stories(id,org_id,workspace_id,campaign_id,title,original_idea,status) values(${STORY_A}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,'Episode A','Alicia white outfit','draft'),(${STORY_B}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${SECOND_CAMPAIGN}::uuid,'Episode B','Alicia blue outfit','draft'),(${STORY_C}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,'Episode C','Alicia after archive','draft'),(${STORY_D}::uuid,${fixture.orgId}::uuid,${fixture.workspaceBId}::uuid,${fixture.campaignBId}::uuid,'Episode D','Cross-workspace probe','draft')`;
  }, 30_000);

  afterAll(async () => {
    await closeDb();
    if (!sql) return;
    await sql.begin(async (tx) => {
      await tx`delete from ai_story_character_continuity_anchors where org_id=${fixture.orgId}::uuid`;
      await tx`delete from ai_story_episode_character_bindings where org_id=${fixture.orgId}::uuid`;
      await tx`delete from ai_story_reusable_character_campaign_projections where org_id=${fixture.orgId}::uuid`;
      await tx`delete from ai_story_reusable_character_versions where org_id=${fixture.orgId}::uuid`;
      await tx`delete from ai_story_reusable_characters where org_id=${fixture.orgId}::uuid`;
      await tx`delete from ai_story_character_versions where org_id=${fixture.orgId}::uuid`;
      await tx`delete from ai_story_characters where org_id=${fixture.orgId}::uuid`;
    });
    await sql`delete from ai_stories where id in (${STORY_A}::uuid, ${STORY_B}::uuid, ${STORY_C}::uuid, ${STORY_D}::uuid)`;
    await sql`delete from campaign_asset_refs where asset_id=${ASSET}::uuid`;
    await sql`delete from assets where id=${ASSET}::uuid`;
    await sql`delete from campaigns where id=${SECOND_CAMPAIGN}::uuid`;
    await cleanupRlsFixture(sql, fixture);
    await sql.end();
  }, 30_000);

  it("creates a versioned Workspace Character, pins Episode bindings, and projects per Campaign", async () => {
    const v1 = await service.create(scope(), identity, undefined, "2026-09-22T01:00:00.000Z");
    expect(v1.version).toBe(1);
    expect(v1.canonicalAssets[0]?.contentHash).toBe(HASH);
    const episodeA = await service.bindEpisode(scope(), {
      storyId: STORY_A, campaignId: fixture.campaignAId, reusableCharacterId: v1.reusableCharacterId,
      episodeLook: look("white outfit"), now: "2026-09-22T01:01:00.000Z",
    });
    const episodeAAgain = await service.bindEpisode(scope(), {
      storyId: STORY_A, campaignId: fixture.campaignAId, reusableCharacterId: v1.reusableCharacterId,
      episodeLook: look("white outfit"), now: "2026-09-22T01:01:30.000Z",
    });
    expect(episodeAAgain.binding.episodeCharacterBindingId).toBe(episodeA.binding.episodeCharacterBindingId);
    const v2 = await service.edit(scope(), v1.reusableCharacterId, {
      ...identity,
      identityCore: { ...identity.identityCore, identityDescription: "Alicia v2 remains a synthetic spokesperson." },
    }, 1, "2026-09-22T01:02:00.000Z");
    expect(v2.version).toBe(2);
    await expect(service.edit(scope(), v1.reusableCharacterId, identity, 1, "2026-09-22T01:02:30.000Z")).rejects.toMatchObject({ code: "CHARACTER_VERSION_CONFLICT" });
    const pinned = await service.currentEpisodeBinding(scope(), STORY_A, v1.reusableCharacterId);
    expect(pinned?.reusableCharacterVersionId).toBe(v1.reusableCharacterVersionId);
    expect(pinned?.reusableCharacterVersionId).not.toBe(v2.reusableCharacterVersionId);
    const campaignB = await service.bindEpisode(scope(), {
      storyId: STORY_B, campaignId: SECOND_CAMPAIGN, reusableCharacterId: v1.reusableCharacterId,
      reusableCharacterVersionId: v2.reusableCharacterVersionId,
      episodeLook: look("blue jacket"), now: "2026-09-22T01:03:00.000Z",
    });
    expect(campaignB.projection.campaignId).toBe(SECOND_CAMPAIGN);
    expect(campaignB.projection.campaignCharacterId).not.toBe(episodeA.projection.campaignCharacterId);
    expect(campaignB.binding.reusableCharacterId).toBe(episodeA.binding.reusableCharacterId);
    const sameProjection = await service.projectToCampaign(scope(), {
      reusableCharacterVersionId: v1.reusableCharacterVersionId, campaignId: fixture.campaignAId,
    });
    expect(sameProjection.projectionId).toBe(episodeA.projection.projectionId);
  });

  it("blocks locked Episode Look, archived selection, and cross-Workspace reads", async () => {
    const current = (await service.list(scope()))[0];
    expect(current).toBeTruthy();
    await expect(service.bindEpisode(scope(), {
      storyId: STORY_A, campaignId: fixture.campaignAId, reusableCharacterId: current!.reusableCharacterId,
      episodeLook: look("white outfit") && { ...look("white outfit"), hairColor: "blonde" },
    })).rejects.toMatchObject({ code: "CHARACTER_LOCKED_TRAIT_GATE" });
    const archived = await service.archive(scope(), current!.reusableCharacterId, current!.version, "2026-09-22T01:04:00.000Z");
    expect(archived.status).toBe("ARCHIVED");
    expect((await service.list(scope())).map((character) => character.reusableCharacterId)).not.toContain(current!.reusableCharacterId);
    const archivedVisible = await service.list(scope(), true);
    expect(archivedVisible.map((character) => character.reusableCharacterId)).toContain(current!.reusableCharacterId);
    expect(archivedVisible[0]?.status).toBe("ARCHIVED");
    const archivedCurrent = await service.readCurrent(scope(), current!.reusableCharacterId, true);
    expect(archivedCurrent.status).toBe("ARCHIVED");
    await expect(service.readCurrent(scope(), current!.reusableCharacterId)).rejects.toMatchObject({ code: "CHARACTER_NOT_FOUND" });
    expect(await service.readVersion(scope(), archived.reusableCharacterVersionId)).toMatchObject({ status: "ARCHIVED", version: 3 });
    await expect(service.bindEpisode(scope(), {
      storyId: STORY_C, campaignId: fixture.campaignAId, reusableCharacterId: current!.reusableCharacterId,
      episodeLook: look("blue jacket"),
    })).rejects.toMatchObject({ code: "CHARACTER_NOT_ACTIVE" });
    const history = await service.history(scope(), current!.reusableCharacterId);
    expect(history.map((version) => version.version)).toEqual([1, 2, 3]);
    const foreignScope = { orgId: fixture.orgId, workspaceId: fixture.workspaceBId, actorUserId: fixture.userBId };
    await expect(service.readCurrent(foreignScope, current!.reusableCharacterId)).rejects.toMatchObject({ code: "CHARACTER_NOT_FOUND" });
    await expect(service.readCurrent(foreignScope, current!.reusableCharacterId, true)).rejects.toMatchObject({ code: "CHARACTER_NOT_FOUND" });
    await expect(service.bindEpisode(foreignScope, {
      storyId: STORY_D, campaignId: fixture.campaignBId, reusableCharacterId: current!.reusableCharacterId,
      episodeLook: look("blue jacket"),
    })).rejects.toMatchObject({ code: "CHARACTER_NOT_FOUND" });
    expect(await service.list(foreignScope)).toEqual([]);
  });

  it("persists unique short reusable Character FKs with RESTRICT references", async () => {
    const rows = await sql<{
      conname: string;
      table_name: string;
      foreign_table: string;
      child_column: string;
      parent_column: string;
      on_delete: string;
    }[]>`
      SELECT
        constraint_row.conname,
        child_table.relname AS table_name,
        parent_table.relname AS foreign_table,
        child.attname AS child_column,
        parent.attname AS parent_column,
        constraint_row.confdeltype AS on_delete
      FROM pg_constraint constraint_row
      JOIN pg_class child_table ON child_table.oid = constraint_row.conrelid
      JOIN pg_class parent_table ON parent_table.oid = constraint_row.confrelid
      JOIN pg_attribute child ON child.attrelid = child_table.oid AND child.attnum = constraint_row.conkey[1]
      JOIN pg_attribute parent ON parent.attrelid = parent_table.oid AND parent.attnum = constraint_row.confkey[1]
      WHERE constraint_row.contype = 'f'
        AND child_table.relname IN (
          'ai_story_reusable_characters',
          'ai_story_reusable_character_versions',
          'ai_story_reusable_character_campaign_projections',
          'ai_story_episode_character_bindings',
          'ai_story_character_continuity_anchors'
        )
      ORDER BY constraint_row.conname
    `;
    const names = rows.map((row) => row.conname);
    expect(new Set(names).size).toBe(names.length);
    for (const row of rows) {
      expect(row.conname.length).toBeLessThanOrEqual(63);
      expect(["a", "r"]).toContain(row.on_delete);
    }
    const byName = Object.fromEntries(rows.map((row) => [row.conname, row]));
    expect(byName.as_rc_proj_root_fk).toMatchObject({
      table_name: "ai_story_reusable_character_campaign_projections",
      child_column: "reusable_character_id",
      foreign_table: "ai_story_reusable_characters",
      parent_column: "reusable_character_id",
    });
    expect(byName.as_rc_proj_ver_fk).toMatchObject({
      table_name: "ai_story_reusable_character_campaign_projections",
      child_column: "reusable_character_version_id",
      foreign_table: "ai_story_reusable_character_versions",
      parent_column: "reusable_character_version_id",
    });
    expect(byName.as_rc_proj_char_fk).toMatchObject({
      child_column: "campaign_character_id",
      foreign_table: "ai_story_characters",
      parent_column: "character_id",
    });
    expect(byName.as_rc_proj_char_ver_fk).toMatchObject({
      child_column: "campaign_character_version_id",
      foreign_table: "ai_story_character_versions",
      parent_column: "character_version_id",
    });
    expect(byName.as_ep_char_bind_root_fk).toMatchObject({
      table_name: "ai_story_episode_character_bindings",
      child_column: "reusable_character_id",
    });
    expect(byName.as_ep_char_bind_ver_fk).toMatchObject({
      child_column: "reusable_character_version_id",
    });
    expect(byName.as_char_anchor_root_fk).toMatchObject({
      table_name: "ai_story_character_continuity_anchors",
      child_column: "reusable_character_id",
    });
    expect(byName.as_char_anchor_ver_fk).toMatchObject({
      child_column: "reusable_character_version_id",
    });
    expect(byName.ai_story_reusable_character_current_version_fk).toMatchObject({
      table_name: "ai_story_reusable_characters",
      child_column: "current_reusable_character_version_id",
      foreign_table: "ai_story_reusable_character_versions",
      parent_column: "reusable_character_version_id",
    });
  });

  it("enables RLS and denies cross-workspace reusable Character reads", async () => {
    const enabled = await sql<{ enabled: boolean }[]>`select relrowsecurity enabled from pg_class where oid='ai_story_reusable_characters'::regclass`;
    expect(enabled[0]?.enabled).toBe(true);
    const rows = await withAuthenticatedUser(sql, fixture.userBId, (tx) => tx<{ reusable_character_id: string }[]>`select reusable_character_id from ai_story_reusable_characters where org_id=${fixture.orgId}::uuid`);
    expect(rows).toEqual([]);
  });
});
