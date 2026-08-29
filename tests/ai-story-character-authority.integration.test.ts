import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { AiStoryCharacterAuthorityError, AiStoryCharacterAuthorityService, closeDb } from "@ceo-agent/db";
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
const SECOND_CAMPAIGN = "52000000-0000-4000-8000-000000000001";
const ADA = "52000000-0000-4000-8000-000000000002";
const BEN = "52000000-0000-4000-8000-000000000003";
const RELATIONSHIP = "52000000-0000-4000-8000-000000000004";
const ASSET = "52000000-0000-4000-8000-000000000005";
const HASH = `sha256:${"a".repeat(64)}`;

const facts = (name: string) => ({
  name, identity: `${name} is a stable Campaign Character.`, appearance: `${name} wears a cobalt jacket.`,
  personality: "Observant and direct.", emotionalArc: "May evolve through authorized Story state.",
  relationships: [], visualAssetIds: [] as string[],
});

describeIntegration("AI Story Character additive persistence and Campaign isolation", () => {
  let sql: Sql; let fixture: RlsTestFixture; let service: AiStoryCharacterAuthorityService;
  const scope = () => ({ orgId: fixture.orgId, workspaceId: fixture.workspaceAId, campaignId: fixture.campaignAId, actorUserId: fixture.userAId });

  beforeAll(async () => {
    sql = createIntegrationSql(); fixture = await seedRlsFixture(sql); service = new AiStoryCharacterAuthorityService();
    await sql.unsafe(`DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-character-v1.sql"), "utf8"));
    await sql.unsafe("GRANT USAGE ON SCHEMA public TO authenticated; GRANT SELECT,INSERT,UPDATE ON ai_story_characters TO authenticated; GRANT SELECT,INSERT ON ai_story_character_versions TO authenticated");
    await sql`insert into campaigns(id,org_id,workspace_id,name,platforms,status) values(${SECOND_CAMPAIGN}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,'Second same-workspace Campaign',array['tiktok'],'draft')`;
    await sql`insert into assets(id,org_id,workspace_id,campaign_id,type,storage_path,status,source,content_hash) values(${ASSET}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,null,'image','character-test.png','ready','campaign_upload',${HASH})`;
    await sql`insert into campaign_asset_refs(campaign_id,asset_id,sort_order) values(${fixture.campaignAId}::uuid,${ASSET}::uuid,0)`;
  }, 30_000);

  afterAll(async () => {
    await closeDb(); if (!sql) return;
    await sql.begin(async (tx) => { await tx`delete from ai_story_character_versions where org_id=${fixture.orgId}::uuid`; await tx`delete from ai_story_characters where org_id=${fixture.orgId}::uuid`; });
    await sql`delete from campaign_asset_refs where asset_id=${ASSET}::uuid`;
    await sql`delete from assets where id=${ASSET}::uuid`;
    await sql`delete from campaigns where id=${SECOND_CAMPAIGN}::uuid`;
    await cleanupRlsFixture(sql, fixture); await sql.end();
  }, 30_000);

  it("creates multiple Characters, reuses them in one Campaign, and validates optional generic Assets", async () => {
    const ben = await service.add(scope(), facts("Ben"), BEN, "2026-08-29T01:00:00.000Z");
    const adaInput = { ...facts("Ada"), visualAssetIds: [ASSET], relationships: [{ relationshipId: RELATIONSHIP, relatedCharacterId: BEN, relationshipType: "COLLEAGUE", baseline: "They have an established professional trust." }] };
    const ada = await service.add(scope(), adaInput, ADA, "2026-08-29T01:01:00.000Z");
    expect((await service.list(scope())).map((character) => character.characterId).sort()).toEqual([ADA, BEN].sort());
    expect(ada.visualAssetReferences).toEqual([{ assetId: ASSET, contentHash: HASH, purpose: "CHARACTER_VISUAL_REFERENCE" }]);
    expect(ada.canonicalFacts.relationships[0]?.relatedCharacterId).toBe(ben.characterId);
  });

  it("preserves V1 after edit and soft delete while denying new active reads", async () => {
    const v1 = await service.read(scope(), ADA);
    const v2 = await service.edit(scope(), ADA, { ...facts("Ada"), appearance: "Ada now wears a green Campaign-approved jacket.", relationships: v1.canonicalFacts.relationships, visualAssetIds: [ASSET] }, 1, "2026-08-29T01:02:00.000Z");
    expect(v2.version).toBe(2); expect(v2.supersedesCharacterVersionId).toBe(v1.characterVersionId);
    expect((await service.history(scope(), ADA)).map((version) => version.name)).toEqual(["Ada", "Ada"]);
    const deleted = await service.delete(scope(), ADA, 2, "2026-08-29T01:03:00.000Z");
    expect(deleted.status).toBe("DELETED");
    await expect(service.read(scope(), ADA)).rejects.toMatchObject({ code: "CHARACTER_NOT_FOUND" });
    expect((await service.history(scope(), ADA))[0]).toEqual(v1);
    expect((await service.read(scope(), ADA, true)).status).toBe("DELETED");
  });

  it("denies cross-Campaign references even inside the same Workspace", async () => {
    const crossScope = { ...scope(), campaignId: SECOND_CAMPAIGN };
    await expect(service.read(crossScope, BEN)).rejects.toBeInstanceOf(AiStoryCharacterAuthorityError);
    await expect(service.add(crossScope, { ...facts("Cross"), relationships: [{ relationshipId: crypto.randomUUID(), relatedCharacterId: BEN, relationshipType: "INVALID", baseline: "Cross-Campaign relation" }] })).rejects.toMatchObject({ code: "CHARACTER_RELATIONSHIP_INVALID" });
  });

  it("enables RLS and denies cross-workspace Character reads", async () => {
    const [aggregate, versions] = await Promise.all([
      sql<{ enabled: boolean }[]>`select relrowsecurity enabled from pg_class where oid='ai_story_characters'::regclass`,
      sql<{ enabled: boolean }[]>`select relrowsecurity enabled from pg_class where oid='ai_story_character_versions'::regclass`,
    ]);
    expect(aggregate[0]?.enabled).toBe(true); expect(versions[0]?.enabled).toBe(true);
    const rows = await withAuthenticatedUser(sql, fixture.userBId, (tx) => tx<{ character_id: string }[]>`select character_id from ai_story_characters where org_id=${fixture.orgId}::uuid`);
    expect(rows).toEqual([]);
  });
});
