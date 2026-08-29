import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { AiStoryLocationAuthorityService, closeDb } from "@ceo-agent/db";
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
const STORY_A="77000000-0000-4000-8000-000000000001";
const STORY_B="77000000-0000-4000-8000-000000000002";
const CAMPAIGN_LOCATION="77000000-0000-4000-8000-000000000003";
const STORY_LOCATION="77000000-0000-4000-8000-000000000004";

const facts=(displayName:string)=>({displayName,identity:`${displayName} continuity identity`,appearance:`${displayName} stable appearance`,fixedElements:["fixed landmark"],environmentalCharacteristics:["bounded spatial character"],visualAssetIds:[] as string[]});

describeIntegration("AI Story canonical Location persistence and isolation",()=>{
  let sql:Sql; let fixture:RlsTestFixture; let service:AiStoryLocationAuthorityService;
  const campaignScope=()=>({orgId:fixture.orgId,workspaceId:fixture.workspaceAId,campaignId:fixture.campaignAId,actorUserId:fixture.userAId});
  const storyScope=(storyId=STORY_A)=>({...campaignScope(),storyId});

  beforeAll(async()=>{
    sql=createIntegrationSql(); fixture=await seedRlsFixture(sql); service=new AiStoryLocationAuthorityService();
    await sql.unsafe(`DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
    await sql`insert into ai_stories(id,org_id,workspace_id,campaign_id,title,original_idea,status,created_by) values(${STORY_A}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,'Scene Story A','Location fixture','draft',${fixture.userAId}::uuid),(${STORY_B}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,'Scene Story B','Location fixture','draft',${fixture.userAId}::uuid)`;
    await sql.unsafe(readFileSync(resolve(process.cwd(),"packages/db/sql/ai-story-scene-authority-v1.sql"),"utf8"));
    await sql.unsafe("GRANT USAGE ON SCHEMA public TO authenticated; GRANT SELECT,INSERT,UPDATE ON ai_story_locations,ai_story_canonical_scenes TO authenticated; GRANT SELECT,INSERT ON ai_story_location_versions,ai_story_location_promotions,ai_story_canonical_scene_versions TO authenticated");
  },30_000);

  afterAll(async()=>{
    await closeDb(); if(!sql)return;
    await sql`delete from ai_story_location_promotions where org_id=${fixture.orgId}::uuid`;
    await sql`delete from ai_story_canonical_scene_versions where org_id=${fixture.orgId}::uuid`;
    await sql`delete from ai_story_canonical_scenes where org_id=${fixture.orgId}::uuid`;
    await sql`delete from ai_story_location_versions where org_id=${fixture.orgId}::uuid`;
    await sql`delete from ai_story_locations where org_id=${fixture.orgId}::uuid`;
    await sql`delete from ai_stories where id in (${STORY_A}::uuid,${STORY_B}::uuid)`;
    await cleanupRlsFixture(sql,fixture); await sql.end();
  },30_000);

  it("persists Campaign and Story continuity horizons with immutable versions",async()=>{
    const campaign=await service.add(campaignScope(),"CAMPAIGN_LOCATION",facts("Recurring base"),CAMPAIGN_LOCATION,"2026-08-29T14:00:00.000Z");
    const story=await service.add(storyScope(),"STORY_LOCATION",facts("Story-only destination"),STORY_LOCATION,"2026-08-29T14:01:00.000Z");
    expect((await service.read(storyScope(STORY_B),CAMPAIGN_LOCATION)).locationVersionId).toBe(campaign.locationVersionId);
    await expect(service.read(storyScope(STORY_B),STORY_LOCATION)).rejects.toMatchObject({code:"LOCATION_NOT_FOUND"});
    const revised=await service.revise(storyScope(),STORY_LOCATION,{...facts("Story-only destination"),environmentalCharacteristics:["new authorized continuity fact"]},1,"ACTIVE","2026-08-29T14:02:00.000Z");
    expect(revised.version).toBe(2); expect(revised.supersedesLocationVersionId).toBe(story.locationVersionId);
  });

  it("denies cross-workspace reads through authority and RLS",async()=>{
    await expect(service.read({...storyScope(),workspaceId:fixture.workspaceBId},STORY_LOCATION)).rejects.toMatchObject({code:"LOCATION_SCOPE_DENIED"});
    const rows=await withAuthenticatedUser(sql,fixture.userBId,(tx)=>tx<{location_id:string}[]>`select location_id from ai_story_locations where location_id=${STORY_LOCATION}::uuid`);
    expect(rows).toEqual([]);
  });

  it("uses RLS for durable authority and creates no Ephemeral Environment table",async()=>{
    const rows=await sql<{relname:string;relrowsecurity:boolean}[]>`select relname,relrowsecurity from pg_class where relname in ('ai_story_locations','ai_story_location_versions','ai_story_location_promotions','ai_story_canonical_scenes','ai_story_canonical_scene_versions') order by relname`;
    expect(rows).toHaveLength(5); expect(rows.every((row)=>row.relrowsecurity)).toBe(true);
    const ephemeral=await sql<{count:number}[]>`select count(*)::int count from pg_class where relname in ('ai_story_ephemeral_environments','ai_story_ephemeral_locations')`;
    expect(ephemeral[0]?.count).toBe(0);
  });
});
