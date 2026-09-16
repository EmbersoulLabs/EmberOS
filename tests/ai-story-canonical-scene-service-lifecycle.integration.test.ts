import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AiStoryCanonicalSceneAuthorityService,
  AiStoryCharacterAuthorityService,
  AiStoryOutlineAuthorityService,
  AiStoryScriptAuthorityService,
  AiStorySceneExecutionPersistenceRepository,
  resolveCurrentFrozenCanonicalSceneSet,
  closeDb,
  getDb,
  schema,
} from "@ceo-agent/db";
import {
  buildAiStoryOutlineVersion,
  buildAiStoryScriptVersion,
  finalizeAiStoryCanonicalScene,
  buildAiStoryAnimationPackageCanonicalSceneAuthorityV1,
} from "@ceo-agent/shared/server";
import { compileSceneExecutionIntents } from "../packages/agents/src/ai-story/scene-execution-compiler";
import { discoverCurrentExecutionPlan } from "../apps/web/src/lib/ai-story-execution-plan-discovery";
import { animationPackageFixture } from "./helpers/ai-story-animation-package";
import {
  RUN_DB_INTEGRATION,
  cleanupRlsFixture,
  createIntegrationSql,
  getIntegrationDbUrl,
  seedRlsFixture,
  type RlsTestFixture,
} from "./helpers/db-integration";

const describeIntegration=RUN_DB_INTEGRATION&&getIntegrationDbUrl()?describe:describe.skip;
const id=(n:number)=>`9f000000-0000-4000-8000-${n.toString().padStart(12,"0")}`;
const I={story:id(1),storyVersion:id(2),unit:id(3),beat:id(4),scriptScene:id(5),entry:id(6),character:id(7),scene:id(8),location:id(9)};

describeIntegration("AI Story canonical Scene service lifecycle against aggregate v2",()=>{
  let sql:Sql;let fixture:RlsTestFixture;
  beforeAll(async()=>{
    sql=createIntegrationSql();fixture=await seedRlsFixture(sql);
    for(const file of ["ai-story-outline-v1.sql","ai-story-character-v1.sql","ai-story-script-v1.sql","ai-story-scene-authority-v1.sql","ai-story-canonical-scene-aggregate-lifecycle-v2.sql","ai-story-scene-execution-persistence-v1.sql"]){await sql.unsafe(readFileSync(resolve(process.cwd(),`packages/db/sql/${file}`),"utf8"));}
    await sql`insert into ai_stories(id,org_id,workspace_id,campaign_id,title,original_idea,status) values(${I.story}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,'Scene service test','Intent','planning')`;
    await sql`insert into ai_story_versions(id,story_id,version_number,structured_content,frozen_at) values(${I.storyVersion}::uuid,${I.story}::uuid,1,${sql.json({title:"Story",summary:"Summary",objective:"Objective",targetAudience:"Audience",tone:"Tone",estimatedDuration:"4s",story:{opening:"Open",development:"Develop",ending:"End"},keyMessages:[],cta:"CTA",assetReferences:[],warnings:[]})},now())`;
    await sql`update ai_stories set current_version_id=${I.storyVersion}::uuid where id=${I.story}::uuid`;
  },30_000);
  afterAll(async()=>{await closeDb();if(!sql)return;await sql`delete from ai_story_scene_intent_validation_results where org_id=${fixture.orgId}::uuid`;await sql`delete from ai_story_scene_executions where story_id=${I.story}::uuid`;await sql`delete from ai_story_execution_plans where story_id=${I.story}::uuid`;await sql`delete from ai_story_scene_instruction_snapshots where org_id=${fixture.orgId}::uuid`;await sql`delete from ai_story_animation_packages where story_id=${I.story}::uuid`;await sql.begin(async(tx)=>{await tx`delete from ai_story_canonical_scene_versions where story_id=${I.story}::uuid`;await tx`delete from ai_story_canonical_scenes where story_id=${I.story}::uuid`;});await sql`delete from ai_story_script_versions where story_id=${I.story}::uuid`;await sql`delete from ai_story_outline_versions where story_id=${I.story}::uuid`;await sql.begin(async(tx)=>{await tx`delete from ai_story_character_versions where character_id=${I.character}::uuid`;await tx`delete from ai_story_characters where character_id=${I.character}::uuid`;});await sql`delete from ai_story_versions where story_id=${I.story}::uuid`;await sql`delete from ai_stories where id=${I.story}::uuid`;await cleanupRlsFixture(sql,fixture);await sql.end();},30_000);

  it("proposes, validates, approves, freezes, revises only after FROZEN, and blocks another incomplete revision",async()=>{
    const scope={orgId:fixture.orgId,workspaceId:fixture.workspaceAId,campaignId:fixture.campaignAId,storyId:I.story,storyVersionId:I.storyVersion,actorUserId:fixture.userAId,requireCurrentFrozenStoryVersion:true};
    const character=await new AiStoryCharacterAuthorityService().add({orgId:fixture.orgId,workspaceId:fixture.workspaceAId,campaignId:fixture.campaignAId,actorUserId:fixture.userAId},{name:"Ada",identity:"Founder",appearance:"Blue jacket",personality:"Direct",emotionalArc:"Certain",relationships:[],visualAssetIds:[]},I.character,"2026-09-15T00:00:00.000Z");
    const authority={authorityType:"CHARACTER" as const,authorityId:I.character,authorityVersionId:character.characterVersionId,authorityFingerprint:character.fingerprint};
    const outline=buildAiStoryOutlineVersion({storyId:I.story,storyVersionId:I.storyVersion,orgId:fixture.orgId,workspaceId:fixture.workspaceAId,version:1,profile:{profileId:"CORE",profileVersion:1},premise:"Premise",coreClaim:"Claim",storyUnits:[{storyUnitId:I.unit,order:0,purpose:"Purpose",summary:"Summary",requiredBeatIds:[I.beat]}],beats:[{id:I.beat,storyUnitId:I.unit,order:0,classification:"MAJOR",name:"Beat",purpose:"Purpose",summary:"Summary",required:true,ownershipPolicy:"EXCLUSIVE",authorityReferences:[authority]}],hooks:[],setupPayoffs:[],requiredSceneOutcomes:[],authorityReferences:[authority],upstreamAuthorityId:I.storyVersion,supersedesOutlineVersionId:null,createdBy:fixture.userAId,createdAt:"2026-09-15T00:01:00.000Z"});
    const outlines=new AiStoryOutlineAuthorityService();await outlines.propose(scope,outline);await outlines.validate(scope,outline.outlineVersionId);await outlines.approve(scope,outline.outlineVersionId);const frozenOutline=await outlines.freeze(scope,outline.outlineVersionId);
    const script=buildAiStoryScriptVersion({storyId:I.story,storyVersionId:I.storyVersion,outlineVersionId:outline.outlineVersionId,orgId:fixture.orgId,workspaceId:fixture.workspaceAId,version:1,profileId:"CORE",profileVersion:1,outlineSourceHash:frozenOutline.sourceHash,semanticInputFingerprint:`sha256:${"e".repeat(64)}`,scenes:[{scriptSceneId:I.scriptScene,order:0,outlineBeatClaims:[{outlineBeatId:I.beat,claim:"Exact claim"}],sceneFunction:"DEMONSTRATE",sceneFunctionRegistryVersion:1,sceneStateIn:[],sceneStateDeltas:[],sceneStateOut:[],entries:[{entryId:I.entry,order:0,type:"ACTION",subjectId:I.character,action:"Ada demonstrates.",storyEffect:"Evidence appears.",durationRange:{minSeconds:4,maxSeconds:4}}],characterIds:[I.character],locationIds:[],propIds:[],assetIds:[],productAuthorityRefs:[],targetDurationRange:{minSeconds:4,maxSeconds:4},mustKeep:[],mustAvoid:[],newInformation:[],newEvidence:[],newActionOutcomes:[],productEvidence:[]}],authorityReferences:[authority],supersedesScriptVersionId:null,createdBy:fixture.userAId,createdAt:"2026-09-15T00:02:00.000Z"});
    const scripts=new AiStoryScriptAuthorityService();await scripts.propose(scope,script);await scripts.validate(scope,script.scriptVersionId);await scripts.approve(scope,script.scriptVersionId);await scripts.freeze(scope,script.scriptVersionId);
    const cast={scope:"CAMPAIGN_CHARACTER" as const,id:I.character,campaignId:fixture.campaignAId,authorityVersionId:character.characterVersionId,authorityFingerprint:character.fingerprint,visualIdentityRequirement:"PREFERRED" as const};
    const build=(version:number,description:string,parentSceneVersionIds:string[])=>finalizeAiStoryCanonicalScene({sceneId:I.scene,orgId:fixture.orgId,workspaceId:fixture.workspaceAId,campaignId:fixture.campaignAId,storyId:I.story,storyVersionId:I.storyVersion,scriptVersionId:script.scriptVersionId,version,order:0,sourceScriptSceneIds:[I.scriptScene],sourceScriptEntryIds:[I.entry],sceneFunction:"DEMONSTRATE",sceneRole:"DEMONSTRATE",importance:"MAJOR",locationBinding:{scope:"EPHEMERAL_ENVIRONMENT",id:I.location,storyId:I.story,sceneId:I.scene,displayName:"Studio",environmentDescription:description,visualIdentityRequirement:"NONE"},locationState:{temporaryFacts:[]},castBindings:[cast],productBindings:[],entryState:[],events:script.scenes[0]!.entries,exitState:[],continuityFacts:[],timeRelation:"UNSPECIFIED",discontinuity:null,mustKeep:[],mustAvoid:[],lineageOperation:version===1?"CREATE":"REVISE",parentSceneVersionIds,createdBy:fixture.userAId,createdAt:`2026-09-15T00:0${version+2}:00.000Z`});
    const scenes=new AiStoryCanonicalSceneAuthorityService();const first=build(1,"Initial environment",[]);await scenes.proposeRevisionSet(scope,[first]);expect((await scenes.transitionSet(scope,"VALIDATED"))[0]!.status).toBe("VALIDATED");expect((await scenes.transitionSet(scope,"APPROVED"))[0]!.status).toBe("APPROVED");expect((await scenes.transitionSet(scope,"FROZEN"))[0]!.status).toBe("FROZEN");
    const second=build(2,"Revised environment",[first.sceneVersionId]);await expect(scenes.proposeRevisionSet(scope,[second])).resolves.toEqual([second]);
    const third=build(3,"Another environment",[second.sceneVersionId]);await expect(scenes.proposeRevisionSet(scope,[third])).rejects.toMatchObject({code:"SCENE_REVISION_REQUIRES_FROZEN"});
    await scenes.transitionSet(scope,"VALIDATED");await scenes.transitionSet(scope,"APPROVED");await scenes.transitionSet(scope,"FROZEN");
  },30_000);

  it("persists and discovers exact canonical execution lineage through PostgreSQL",async()=>{
    const db=getDb();
    const scope={orgId:fixture.orgId,workspaceId:fixture.workspaceAId,campaignId:fixture.campaignAId,storyId:I.story,storyVersionId:I.storyVersion};
    const current=await resolveCurrentFrozenCanonicalSceneSet(db,scope);
    expect(current).toHaveLength(1);
    const legacy=animationPackageFixture("ready_for_execution");
    const payload={...legacy,canonicalSceneAuthority:buildAiStoryAnimationPackageCanonicalSceneAuthorityV1({storyId:I.story,storyVersionId:I.storyVersion,scenePlan:legacy.scenePlan,canonicalScenes:current!})};
    const packageId=id(10);
    await sql`insert into ai_story_animation_packages(id,org_id,workspace_id,campaign_id,story_id,story_version_id,status,payload,approved_at,approved_by) values(${packageId}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,${I.story}::uuid,${I.storyVersion}::uuid,'ready_for_execution',${sql.json(payload)},now(),${fixture.userAId}::uuid)`;
    const compiled=compileSceneExecutionIntents(payload,{orgId:fixture.orgId,workspaceId:fixture.workspaceAId,campaignId:fixture.campaignAId,storyId:I.story,storyVersionId:I.storyVersion,storyVersionNumber:1,storyVersionFrozenAt:"2026-09-15T00:00:00.000Z",animationPackageId:packageId,animationPackageStatus:"ready_for_execution",compiledAt:"2026-09-15T01:00:00.000Z"});
    const validationResults=compiled.intents.map((intent)=>({status:"passed" as const,intentId:intent.identity.sceneExecutionId,sceneId:intent.identity.sceneId,validatedAt:"2026-09-15T01:01:00.000Z",contractVersion:"1" as const,errors:[]}));
    const persisted=await new AiStorySceneExecutionPersistenceRepository(db).persistCompilation({...compiled,plan:compiled.storyExecutionPlan,validationResults});
    expect(persisted.intents[0]!.identity).toMatchObject({sceneId:current![0]!.sceneId,sceneVersionId:current![0]!.sceneVersionId,sceneFingerprint:current![0]!.fingerprint,scriptVersionId:current![0]!.scriptVersionId});
    const discovered=await discoverCurrentExecutionPlan({userId:fixture.userAId,campaignId:fixture.campaignAId,storyId:I.story});
    expect(discovered.executionPlan?.executionPlanId).toBe(compiled.storyExecutionPlan.storyExecutionId);
    const stored=await db.select({sceneId:schema.aiStorySceneExecutions.sceneId,intent:schema.aiStorySceneExecutions.intent}).from(schema.aiStorySceneExecutions);
    expect(stored[0]!.sceneId).toBe(current![0]!.sceneId);
    expect(stored[0]!.intent.identity.sceneVersionId).toBe(current![0]!.sceneVersionId);
  },30_000);
});
