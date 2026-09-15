import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  RUN_DB_INTEGRATION,
  cleanupRlsFixture,
  createIntegrationSql,
  getIntegrationDbUrl,
  seedRlsFixture,
  type RlsTestFixture,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const id = (n: number) => `9e000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const STORY=id(1), STORY_VERSION=id(2), SCRIPT=id(3), OUTLINE=id(4), ACTOR=id(5);

describeIntegration("AI Story canonical Scene aggregate lifecycle v2 migration",()=>{
  let sql:Sql; let fixture:RlsTestFixture; let next=100;
  beforeAll(async()=>{
    sql=createIntegrationSql(); fixture=await seedRlsFixture(sql);
    await sql.unsafe(readFileSync(resolve(process.cwd(),"packages/db/sql/ai-story-outline-v1.sql"),"utf8"));
    await sql.unsafe(readFileSync(resolve(process.cwd(),"packages/db/sql/ai-story-script-v1.sql"),"utf8"));
    await sql`insert into ai_stories(id,org_id,workspace_id,campaign_id,title,original_idea,status) values(${STORY}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,'Scene trigger test','Intent','planning')`;
    await sql`insert into ai_story_versions(id,story_id,version_number,structured_content,frozen_at) values(${STORY_VERSION}::uuid,${STORY}::uuid,1,'{}'::jsonb,now())`;
    await sql`update ai_stories set current_version_id=${STORY_VERSION}::uuid where id=${STORY}::uuid`;
    await sql`insert into ai_story_outline_versions(outline_version_id,org_id,workspace_id,campaign_id,story_id,story_version_id,version,contract_version,profile_id,profile_version,source_hash,status,outline,created_by,created_at) values(${OUTLINE}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,${STORY}::uuid,${STORY_VERSION}::uuid,1,'ai-story-outline.v1','CORE',1,${`sha256:${"a".repeat(64)}`} ,'FROZEN','{}'::jsonb,${fixture.userAId}::uuid,now())`;
    await sql`insert into ai_story_script_versions(script_version_id,org_id,workspace_id,campaign_id,story_id,story_version_id,outline_version_id,version,contract_version,profile_id,profile_version,outline_source_hash,source_hash,status,script,created_by,created_at) values(${SCRIPT}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,${STORY}::uuid,${STORY_VERSION}::uuid,${OUTLINE}::uuid,1,'ai-story-script.v1','CORE',1,${`sha256:${"a".repeat(64)}`},${`sha256:${"b".repeat(64)}`} ,'FROZEN','{}'::jsonb,${fixture.userAId}::uuid,now())`;
    await sql.unsafe(readFileSync(resolve(process.cwd(),"packages/db/sql/ai-story-scene-authority-v1.sql"),"utf8"));
    await sql.unsafe(readFileSync(resolve(process.cwd(),"packages/db/sql/ai-story-canonical-scene-aggregate-lifecycle-v2.sql"),"utf8"));
  },30_000);
  afterAll(async()=>{if(!sql)return;await sql.begin(async(tx)=>{await tx`delete from ai_story_canonical_scene_versions where story_id=${STORY}::uuid`;await tx`delete from ai_story_canonical_scenes where story_id=${STORY}::uuid`;});await sql`delete from ai_story_script_versions where story_id=${STORY}::uuid`;await sql`delete from ai_story_outline_versions where story_id=${STORY}::uuid`;await sql`delete from ai_story_versions where story_id=${STORY}::uuid`;await sql`delete from ai_stories where id=${STORY}::uuid`;await cleanupRlsFixture(sql,fixture);await sql.end();},30_000);

  async function seed(status:string){
    const sceneId=id(next++), versionId=id(next++);
    await sql.begin(async(tx)=>{
      await tx`insert into ai_story_canonical_scenes(scene_id,org_id,workspace_id,campaign_id,story_id,current_version,current_scene_version_id,status,created_by,created_at,updated_at) values(${sceneId}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,${STORY}::uuid,1,${versionId}::uuid,${status},${fixture.userAId}::uuid,now(),now())`;
      await tx`insert into ai_story_canonical_scene_versions(scene_version_id,scene_id,org_id,workspace_id,campaign_id,story_id,story_version_id,script_version_id,version,scene_order,contract_version,source_hash,fingerprint,status,snapshot,created_by,created_at) values(${versionId}::uuid,${sceneId}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,${STORY}::uuid,${STORY_VERSION}::uuid,${SCRIPT}::uuid,1,0,'ai-story-scene.v1',${`sha256:${"c".repeat(64)}`},${`sha256:${"d".repeat(64)}`},${status},'{}'::jsonb,${fixture.userAId}::uuid,now())`;
    });
    return {sceneId,versionId};
  }
  async function addVersion(sceneId:string,version:number){
    const versionId=id(next++);
    await sql`insert into ai_story_canonical_scene_versions(scene_version_id,scene_id,org_id,workspace_id,campaign_id,story_id,story_version_id,script_version_id,version,scene_order,contract_version,source_hash,fingerprint,status,snapshot,created_by,created_at) values(${versionId}::uuid,${sceneId}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,${STORY}::uuid,${STORY_VERSION}::uuid,${SCRIPT}::uuid,${version},0,'ai-story-scene.v1',${`sha256:${(version%10).toString().repeat(64)}`},${`sha256:${((version+1)%10).toString().repeat(64)}`} ,'DRAFT','{}'::jsonb,${fixture.userAId}::uuid,now())`;
    return versionId;
  }
  const denied=(promise:Promise<unknown>)=>expect(promise).rejects.toThrow(/canonical Scene/i);

  it("allows exact adjacent lifecycle transitions without changing version or pointer",async()=>{
    const scene=await seed("DRAFT");
    await sql`update ai_story_canonical_scenes set status='VALIDATED',updated_at=now() where scene_id=${scene.sceneId}::uuid`;
    await sql`update ai_story_canonical_scenes set status='APPROVED',updated_at=now() where scene_id=${scene.sceneId}::uuid`;
    await sql`update ai_story_canonical_scenes set status='FROZEN',updated_at=now() where scene_id=${scene.sceneId}::uuid`;
    const [row]=await sql<{current_version:number;current_scene_version_id:string;status:string}[]>`select current_version,current_scene_version_id,status from ai_story_canonical_scenes where scene_id=${scene.sceneId}::uuid`;
    expect(row).toEqual({current_version:1,current_scene_version_id:scene.versionId,status:"FROZEN"});
  });

  it("allows only FROZEN vN to DRAFT vN+1 with a changed pointer",async()=>{
    const scene=await seed("FROZEN"); const nextVersion=await addVersion(scene.sceneId,2);
    await sql`update ai_story_canonical_scenes set current_version=2,current_scene_version_id=${nextVersion}::uuid,status='DRAFT',updated_at=now() where scene_id=${scene.sceneId}::uuid`;
    const [row]=await sql<{current_version:number;current_scene_version_id:string;status:string}[]>`select current_version,current_scene_version_id,status from ai_story_canonical_scenes where scene_id=${scene.sceneId}::uuid`;
    expect(row).toEqual({current_version:2,current_scene_version_id:nextVersion,status:"DRAFT"});
  });

  it("rejects lifecycle skips and arbitrary same-version mutation",async()=>{
    for(const target of ["APPROVED","FROZEN"]){const scene=await seed("DRAFT");await denied(sql`update ai_story_canonical_scenes set status=${target},updated_at=now() where scene_id=${scene.sceneId}::uuid`);}
    const scene=await seed("VALIDATED"); await denied(sql`update ai_story_canonical_scenes set status='FROZEN',updated_at=now() where scene_id=${scene.sceneId}::uuid`);
    const same=await seed("DRAFT"); await denied(sql`update ai_story_canonical_scenes set status='DRAFT',updated_at=now() where scene_id=${same.sceneId}::uuid`);
  });

  it("rejects pointer/version mismatches and revision from incomplete authority",async()=>{
    const sameVersion=await seed("FROZEN"), pointer=await addVersion(sameVersion.sceneId,2); await denied(sql`update ai_story_canonical_scenes set current_scene_version_id=${pointer}::uuid,status='DRAFT' where scene_id=${sameVersion.sceneId}::uuid`);
    const samePointer=await seed("FROZEN"); await denied(sql`update ai_story_canonical_scenes set current_version=2,status='DRAFT' where scene_id=${samePointer.sceneId}::uuid`);
    const plusTwo=await seed("FROZEN"), v3=await addVersion(plusTwo.sceneId,3); await denied(sql`update ai_story_canonical_scenes set current_version=3,current_scene_version_id=${v3}::uuid,status='DRAFT' where scene_id=${plusTwo.sceneId}::uuid`);
    for(const status of ["DRAFT","VALIDATED","APPROVED"]){const source=await seed(status),v2=await addVersion(source.sceneId,2);await denied(sql`update ai_story_canonical_scenes set current_version=2,current_scene_version_id=${v2}::uuid,status='DRAFT' where scene_id=${source.sceneId}::uuid`);}
  });

  it("rejects SUPERSEDED and ownership identity mutation",async()=>{
    const superseded=await seed("SUPERSEDED");await denied(sql`update ai_story_canonical_scenes set status='DRAFT',updated_at=now() where scene_id=${superseded.sceneId}::uuid`);
    const owned=await seed("DRAFT");await denied(sql`update ai_story_canonical_scenes set workspace_id=${fixture.workspaceBId}::uuid,status='VALIDATED',updated_at=now() where scene_id=${owned.sceneId}::uuid`);
  });
});
