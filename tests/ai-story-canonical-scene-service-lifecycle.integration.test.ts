import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AiStoryCanonicalSceneAuthorityService,
  AiStoryCharacterAuthorityService,
  AiStoryOutlineAuthorityService,
  AiStoryScriptAuthorityService,
  AiStorySceneExecutionPersistenceRepository,
  resolveApprovedAnimationPackageForStoryVersion,
  resolveCurrentCanonicalApprovedAnimationPackageForStoryVersion,
  resolveCurrentFrozenCanonicalSceneSet,
  closeDb,
  getDb,
  schema,
} from "@ceo-agent/db";
import {
  AiStoryExecutionPlanSchema,
  AiStorySceneCompiledInstructionsSchema,
  AiStorySceneExecutionIntentSchema,
  AnimationPackagePayloadSchema,
} from "@ceo-agent/shared";
import {
  buildAiStoryOutlineVersion,
  buildAiStoryScriptVersion,
  finalizeAiStoryCanonicalScene,
  buildAiStoryAnimationPackageCanonicalSceneAuthorityV1,
  sha256CanonicalIntegrityHash,
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
const J={story:id(20),storyVersion:id(21),unit:id(22),beat:id(23),scriptScene:id(24),entry:id(25),scene:id(26),location:id(27)};

let exactCharacterAuthority:{authorityType:"CHARACTER";authorityId:string;authorityVersionId:string;authorityFingerprint:string};
let exactCast:{scope:"CAMPAIGN_CHARACTER";id:string;campaignId:string;authorityVersionId:string;authorityFingerprint:string;visualIdentityRequirement:"PREFERRED"};
let sceneService:AiStoryCanonicalSceneAuthorityService;
let sceneScope:{orgId:string;workspaceId:string;campaignId:string;storyId:string;storyVersionId:string;actorUserId:string;requireCurrentFrozenStoryVersion:true};
let firstScene:ReturnType<typeof finalizeAiStoryCanonicalScene>;
let buildScene:(version:number,description:string,parentSceneVersionIds:string[])=>ReturnType<typeof finalizeAiStoryCanonicalScene>;

describeIntegration("AI Story canonical Scene service lifecycle against aggregate v2",()=>{
  let sql:Sql;let fixture:RlsTestFixture;
  beforeAll(async()=>{
    sql=createIntegrationSql();fixture=await seedRlsFixture(sql);
    for(const file of ["ai-story-outline-v1.sql","ai-story-character-v1.sql","ai-story-script-v1.sql","ai-story-scene-authority-v1.sql","ai-story-canonical-scene-aggregate-lifecycle-v2.sql","ai-story-scene-execution-persistence-v1.sql"]){await sql.unsafe(readFileSync(resolve(process.cwd(),`packages/db/sql/${file}`),"utf8"));}
    await sql`insert into ai_stories(id,org_id,workspace_id,campaign_id,title,original_idea,status) values(${I.story}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,'Scene service test','Intent','planning')`;
    await sql`insert into ai_story_versions(id,story_id,version_number,structured_content,frozen_at) values(${I.storyVersion}::uuid,${I.story}::uuid,1,${sql.json({title:"Story",summary:"Summary",objective:"Objective",targetAudience:"Audience",tone:"Tone",estimatedDuration:"4s",story:{opening:"Open",development:"Develop",ending:"End"},keyMessages:[],cta:"CTA",assetReferences:[],warnings:[]})},now())`;
    await sql`update ai_stories set current_version_id=${I.storyVersion}::uuid where id=${I.story}::uuid`;
    await sql`insert into ai_stories(id,org_id,workspace_id,campaign_id,title,original_idea,status) values(${J.story}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,'Legacy execution test','Intent','planning')`;
    await sql`insert into ai_story_versions(id,story_id,version_number,structured_content,frozen_at) values(${J.storyVersion}::uuid,${J.story}::uuid,1,${sql.json({title:"Legacy Story",summary:"Summary",objective:"Objective",targetAudience:"Audience",tone:"Tone",estimatedDuration:"4s",story:{opening:"Open",development:"Develop",ending:"End"},keyMessages:[],cta:"CTA",assetReferences:[],warnings:[]})},now())`;
    await sql`update ai_stories set current_version_id=${J.storyVersion}::uuid where id=${J.story}::uuid`;
  },30_000);
  afterAll(async()=>{await closeDb();if(!sql)return;await sql`delete from ai_story_scene_intent_validation_results where org_id=${fixture.orgId}::uuid`;for(const storyId of [I.story,J.story]){await sql`delete from ai_story_scene_executions where story_id=${storyId}::uuid`;await sql`delete from ai_story_execution_plans where story_id=${storyId}::uuid`;await sql`delete from ai_story_animation_packages where story_id=${storyId}::uuid`;await sql.begin(async(tx)=>{await tx`delete from ai_story_canonical_scene_versions where story_id=${storyId}::uuid`;await tx`delete from ai_story_canonical_scenes where story_id=${storyId}::uuid`;});await sql`delete from ai_story_script_versions where story_id=${storyId}::uuid`;await sql`delete from ai_story_outline_versions where story_id=${storyId}::uuid`;await sql`delete from ai_story_versions where story_id=${storyId}::uuid`;await sql`delete from ai_stories where id=${storyId}::uuid`;}await sql`delete from ai_story_scene_instruction_snapshots where org_id=${fixture.orgId}::uuid`;await sql.begin(async(tx)=>{await tx`delete from ai_story_character_versions where character_id=${I.character}::uuid`;await tx`delete from ai_story_characters where character_id=${I.character}::uuid`;});await cleanupRlsFixture(sql,fixture);await sql.end();},30_000);

  it("proposes, validates, approves, and freezes the initial canonical Scene",async()=>{
    const scope={orgId:fixture.orgId,workspaceId:fixture.workspaceAId,campaignId:fixture.campaignAId,storyId:I.story,storyVersionId:I.storyVersion,actorUserId:fixture.userAId,requireCurrentFrozenStoryVersion:true};
    const character=await new AiStoryCharacterAuthorityService().add({orgId:fixture.orgId,workspaceId:fixture.workspaceAId,campaignId:fixture.campaignAId,actorUserId:fixture.userAId},{name:"Ada",identity:"Founder",appearance:"Blue jacket",personality:"Direct",emotionalArc:"Certain",relationships:[],visualAssetIds:[]},I.character,"2026-09-15T00:00:00.000Z");
    const authority={authorityType:"CHARACTER" as const,authorityId:I.character,authorityVersionId:character.characterVersionId,authorityFingerprint:character.fingerprint};
    exactCharacterAuthority=authority;
    const outline=buildAiStoryOutlineVersion({storyId:I.story,storyVersionId:I.storyVersion,orgId:fixture.orgId,workspaceId:fixture.workspaceAId,version:1,profile:{profileId:"CORE",profileVersion:1},premise:"Premise",coreClaim:"Claim",storyUnits:[{storyUnitId:I.unit,order:0,purpose:"Purpose",summary:"Summary",requiredBeatIds:[I.beat]}],beats:[{id:I.beat,storyUnitId:I.unit,order:0,classification:"MAJOR",name:"Beat",purpose:"Purpose",summary:"Summary",required:true,ownershipPolicy:"EXCLUSIVE",authorityReferences:[authority]}],hooks:[],setupPayoffs:[],requiredSceneOutcomes:[],authorityReferences:[authority],upstreamAuthorityId:I.storyVersion,supersedesOutlineVersionId:null,createdBy:fixture.userAId,createdAt:"2026-09-15T00:01:00.000Z"});
    const outlines=new AiStoryOutlineAuthorityService();await outlines.propose(scope,outline);await outlines.validate(scope,outline.outlineVersionId);await outlines.approve(scope,outline.outlineVersionId);const frozenOutline=await outlines.freeze(scope,outline.outlineVersionId);
    const script=buildAiStoryScriptVersion({storyId:I.story,storyVersionId:I.storyVersion,outlineVersionId:outline.outlineVersionId,orgId:fixture.orgId,workspaceId:fixture.workspaceAId,version:1,profileId:"CORE",profileVersion:1,outlineSourceHash:frozenOutline.sourceHash,semanticInputFingerprint:`sha256:${"e".repeat(64)}`,scenes:[{scriptSceneId:I.scriptScene,order:0,outlineBeatClaims:[{outlineBeatId:I.beat,claim:"Exact claim"}],sceneFunction:"DEMONSTRATE",sceneFunctionRegistryVersion:1,sceneStateIn:[],sceneStateDeltas:[],sceneStateOut:[],entries:[{entryId:I.entry,order:0,type:"ACTION",subjectId:I.character,action:"Ada demonstrates.",storyEffect:"Evidence appears.",durationRange:{minSeconds:4,maxSeconds:4}}],characterIds:[I.character],locationIds:[],propIds:[],assetIds:[],productAuthorityRefs:[],targetDurationRange:{minSeconds:4,maxSeconds:4},mustKeep:[],mustAvoid:[],newInformation:[],newEvidence:[],newActionOutcomes:[],productEvidence:[]}],authorityReferences:[authority],supersedesScriptVersionId:null,createdBy:fixture.userAId,createdAt:"2026-09-15T00:02:00.000Z"});
    const scripts=new AiStoryScriptAuthorityService();await scripts.propose(scope,script);await scripts.validate(scope,script.scriptVersionId);await scripts.approve(scope,script.scriptVersionId);await scripts.freeze(scope,script.scriptVersionId);
    const cast={scope:"CAMPAIGN_CHARACTER" as const,id:I.character,campaignId:fixture.campaignAId,authorityVersionId:character.characterVersionId,authorityFingerprint:character.fingerprint,visualIdentityRequirement:"PREFERRED" as const};
    exactCast=cast;
    sceneScope=scope;
    buildScene=(version:number,description:string,parentSceneVersionIds:string[])=>finalizeAiStoryCanonicalScene({sceneId:I.scene,orgId:fixture.orgId,workspaceId:fixture.workspaceAId,campaignId:fixture.campaignAId,storyId:I.story,storyVersionId:I.storyVersion,scriptVersionId:script.scriptVersionId,version,order:0,sourceScriptSceneIds:[I.scriptScene],sourceScriptEntryIds:[I.entry],sceneFunction:"DEMONSTRATE",sceneRole:"DEMONSTRATE",importance:"MAJOR",locationBinding:{scope:"EPHEMERAL_ENVIRONMENT",id:I.location,storyId:I.story,sceneId:I.scene,displayName:"Studio",environmentDescription:description,visualIdentityRequirement:"NONE"},locationState:{temporaryFacts:[]},castBindings:[cast],productBindings:[],entryState:[],events:script.scenes[0]!.entries,exitState:[],continuityFacts:[],timeRelation:"UNSPECIFIED",discontinuity:null,mustKeep:[],mustAvoid:[],lineageOperation:version===1?"CREATE":"REVISE",parentSceneVersionIds,createdBy:fixture.userAId,createdAt:`2026-09-15T00:0${version+2}:00.000Z`});
    sceneService=new AiStoryCanonicalSceneAuthorityService();firstScene=buildScene(1,"Initial environment",[]);await sceneService.proposeRevisionSet(scope,[firstScene]);expect((await sceneService.transitionSet(scope,"VALIDATED"))[0]!.status).toBe("VALIDATED");expect((await sceneService.transitionSet(scope,"APPROVED"))[0]!.status).toBe("APPROVED");expect((await sceneService.transitionSet(scope,"FROZEN"))[0]!.status).toBe("FROZEN");
  },30_000);

  it("persists exact canonical lineage, rejects stale revisions, and excludes legacy authority",async()=>{
    const db=getDb();
    const scope={orgId:fixture.orgId,workspaceId:fixture.workspaceAId,campaignId:fixture.campaignAId,storyId:I.story,storyVersionId:I.storyVersion};
    const currentV1=await resolveCurrentFrozenCanonicalSceneSet(db,scope);
    expect(currentV1).toHaveLength(1);
    const packageFixture=animationPackageFixture("ready_for_execution");
    const payload={...packageFixture,canonicalSceneAuthority:buildAiStoryAnimationPackageCanonicalSceneAuthorityV1({storyId:I.story,storyVersionId:I.storyVersion,scenePlan:packageFixture.scenePlan,canonicalScenes:currentV1!})};
    const packageId=id(10);
    await sql`insert into ai_story_animation_packages(id,org_id,workspace_id,campaign_id,story_id,story_version_id,status,payload,approved_at,approved_by) values(${packageId}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,${I.story}::uuid,${I.storyVersion}::uuid,'ready_for_execution',${sql.json(payload)},now(),${fixture.userAId}::uuid)`;
    const compiled=compileSceneExecutionIntents(payload,{orgId:fixture.orgId,workspaceId:fixture.workspaceAId,campaignId:fixture.campaignAId,storyId:I.story,storyVersionId:I.storyVersion,storyVersionNumber:1,storyVersionFrozenAt:"2026-09-15T00:00:00.000Z",animationPackageId:packageId,animationPackageStatus:"ready_for_execution",compiledAt:"2026-09-15T01:00:00.000Z"});
    const validationResults=compiled.intents.map((intent)=>({status:"passed" as const,intentId:intent.identity.sceneExecutionId,sceneId:intent.identity.sceneId,validatedAt:"2026-09-15T01:01:00.000Z",contractVersion:"1" as const,errors:[]}));
    const persisted=await new AiStorySceneExecutionPersistenceRepository(db).persistCompilation({...compiled,plan:compiled.storyExecutionPlan,validationResults});
    expect(persisted.plan.animationPackage.sceneSetFingerprint).toBe(payload.canonicalSceneAuthority.sceneSetFingerprint);
    expect(persisted.plan.animationPackage.scriptVersionId).toBe(payload.canonicalSceneAuthority.scriptVersionId);
    expect(persisted.intents[0]!.animationPackage.sceneSetFingerprint).toBe(payload.canonicalSceneAuthority.sceneSetFingerprint);
    expect(persisted.intents[0]!.identity).toMatchObject({sceneId:currentV1![0]!.sceneId,sceneVersionId:currentV1![0]!.sceneVersionId,sceneFingerprint:currentV1![0]!.fingerprint,scriptVersionId:currentV1![0]!.scriptVersionId});
    expect((await resolveCurrentCanonicalApprovedAnimationPackageForStoryVersion(db,scope))?.id).toBe(packageId);
    const discovered=await discoverCurrentExecutionPlan({userId:fixture.userAId,campaignId:fixture.campaignAId,storyId:I.story});
    expect(discovered.executionPlan?.executionPlanId).toBe(compiled.storyExecutionPlan.storyExecutionId);
    const [storedPackageBefore]=await db.select().from(schema.aiStoryAnimationPackages).where(eq(schema.aiStoryAnimationPackages.id,packageId));
    const [storedPlanBefore]=await db.select().from(schema.aiStoryExecutionPlans).where(eq(schema.aiStoryExecutionPlans.id,compiled.storyExecutionPlan.storyExecutionId));
    const [storedIntentBefore]=await db.select().from(schema.aiStorySceneExecutions).where(eq(schema.aiStorySceneExecutions.id,compiled.intents[0]!.identity.sceneExecutionId));
    expect(storedPackageBefore!.payload).toEqual(payload);
    expect(storedPlanBefore!.plan.animationPackage.sceneSetFingerprint).toBe(payload.canonicalSceneAuthority.sceneSetFingerprint);
    expect(storedIntentBefore!.sceneId).toBe(currentV1![0]!.sceneId);
    expect(storedIntentBefore!.intent.animationPackage.sceneSetFingerprint).toBe(payload.canonicalSceneAuthority.sceneSetFingerprint);
    expect(storedIntentBefore!.intent.identity).toMatchObject({sceneId:currentV1![0]!.sceneId,sceneVersionId:currentV1![0]!.sceneVersionId,sceneFingerprint:currentV1![0]!.fingerprint,scriptVersionId:currentV1![0]!.scriptVersionId});

    const second=buildScene(2,"Revised environment",[firstScene.sceneVersionId]);
    await expect(sceneService.proposeRevisionSet(sceneScope,[second])).resolves.toEqual([second]);
    const third=buildScene(3,"Another environment",[second.sceneVersionId]);
    await expect(sceneService.proposeRevisionSet(sceneScope,[third])).rejects.toMatchObject({code:"SCENE_REVISION_REQUIRES_FROZEN"});
    await sceneService.transitionSet(sceneScope,"VALIDATED");await sceneService.transitionSet(sceneScope,"APPROVED");await sceneService.transitionSet(sceneScope,"FROZEN");
    const currentV2=await resolveCurrentFrozenCanonicalSceneSet(db,scope);
    expect(currentV2).toHaveLength(1);
    expect(currentV2![0]!.sceneId).toBe(currentV1![0]!.sceneId);
    expect(currentV2![0]!.sceneVersionId).not.toBe(currentV1![0]!.sceneVersionId);
    expect(currentV2![0]!.fingerprint).not.toBe(currentV1![0]!.fingerprint);
    const v2Authority=buildAiStoryAnimationPackageCanonicalSceneAuthorityV1({storyId:I.story,storyVersionId:I.storyVersion,scenePlan:packageFixture.scenePlan,canonicalScenes:currentV2!});
    expect(v2Authority.sceneSetFingerprint).not.toBe(payload.canonicalSceneAuthority.sceneSetFingerprint);
    expect(await resolveCurrentCanonicalApprovedAnimationPackageForStoryVersion(db,scope)).toBeNull();
    expect((await discoverCurrentExecutionPlan({userId:fixture.userAId,campaignId:fixture.campaignAId,storyId:I.story})).executionPlan).toBeNull();
    const [storedPackageAfter]=await db.select().from(schema.aiStoryAnimationPackages).where(eq(schema.aiStoryAnimationPackages.id,packageId));
    const [storedPlanAfter]=await db.select().from(schema.aiStoryExecutionPlans).where(eq(schema.aiStoryExecutionPlans.id,compiled.storyExecutionPlan.storyExecutionId));
    const [storedIntentAfter]=await db.select().from(schema.aiStorySceneExecutions).where(eq(schema.aiStorySceneExecutions.id,compiled.intents[0]!.identity.sceneExecutionId));
    expect(storedPackageAfter).toEqual(storedPackageBefore);
    expect(storedPlanAfter).toEqual(storedPlanBefore);
    expect(storedIntentAfter).toEqual(storedIntentBefore);

    const legacyScope={orgId:fixture.orgId,workspaceId:fixture.workspaceAId,campaignId:fixture.campaignAId,storyId:J.story,storyVersionId:J.storyVersion,actorUserId:fixture.userAId,requireCurrentFrozenStoryVersion:true as const};
    const legacyOutline=buildAiStoryOutlineVersion({storyId:J.story,storyVersionId:J.storyVersion,orgId:fixture.orgId,workspaceId:fixture.workspaceAId,version:1,profile:{profileId:"CORE",profileVersion:1},premise:"Legacy premise",coreClaim:"Legacy claim",storyUnits:[{storyUnitId:J.unit,order:0,purpose:"Purpose",summary:"Summary",requiredBeatIds:[J.beat]}],beats:[{id:J.beat,storyUnitId:J.unit,order:0,classification:"MAJOR",name:"Beat",purpose:"Purpose",summary:"Summary",required:true,ownershipPolicy:"EXCLUSIVE",authorityReferences:[exactCharacterAuthority]}],hooks:[],setupPayoffs:[],requiredSceneOutcomes:[],authorityReferences:[exactCharacterAuthority],upstreamAuthorityId:J.storyVersion,supersedesOutlineVersionId:null,createdBy:fixture.userAId,createdAt:"2026-09-15T02:00:00.000Z"});
    const legacyOutlines=new AiStoryOutlineAuthorityService();await legacyOutlines.propose(legacyScope,legacyOutline);await legacyOutlines.validate(legacyScope,legacyOutline.outlineVersionId);await legacyOutlines.approve(legacyScope,legacyOutline.outlineVersionId);const frozenLegacyOutline=await legacyOutlines.freeze(legacyScope,legacyOutline.outlineVersionId);
    const legacyScript=buildAiStoryScriptVersion({storyId:J.story,storyVersionId:J.storyVersion,outlineVersionId:legacyOutline.outlineVersionId,orgId:fixture.orgId,workspaceId:fixture.workspaceAId,version:1,profileId:"CORE",profileVersion:1,outlineSourceHash:frozenLegacyOutline.sourceHash,semanticInputFingerprint:`sha256:${"f".repeat(64)}`,scenes:[{scriptSceneId:J.scriptScene,order:0,outlineBeatClaims:[{outlineBeatId:J.beat,claim:"Exact claim"}],sceneFunction:"DEMONSTRATE",sceneFunctionRegistryVersion:1,sceneStateIn:[],sceneStateDeltas:[],sceneStateOut:[],entries:[{entryId:J.entry,order:0,type:"ACTION",subjectId:I.character,action:"Ada demonstrates.",storyEffect:"Evidence appears.",durationRange:{minSeconds:4,maxSeconds:4}}],characterIds:[I.character],locationIds:[],propIds:[],assetIds:[],productAuthorityRefs:[],targetDurationRange:{minSeconds:4,maxSeconds:4},mustKeep:[],mustAvoid:[],newInformation:[],newEvidence:[],newActionOutcomes:[],productEvidence:[]}],authorityReferences:[exactCharacterAuthority],supersedesScriptVersionId:null,createdBy:fixture.userAId,createdAt:"2026-09-15T02:01:00.000Z"});
    const legacyScripts=new AiStoryScriptAuthorityService();await legacyScripts.propose(legacyScope,legacyScript);await legacyScripts.validate(legacyScope,legacyScript.scriptVersionId);await legacyScripts.approve(legacyScope,legacyScript.scriptVersionId);await legacyScripts.freeze(legacyScope,legacyScript.scriptVersionId);
    const legacyScene=finalizeAiStoryCanonicalScene({sceneId:J.scene,orgId:fixture.orgId,workspaceId:fixture.workspaceAId,campaignId:fixture.campaignAId,storyId:J.story,storyVersionId:J.storyVersion,scriptVersionId:legacyScript.scriptVersionId,version:1,order:0,sourceScriptSceneIds:[J.scriptScene],sourceScriptEntryIds:[J.entry],sceneFunction:"DEMONSTRATE",sceneRole:"DEMONSTRATE",importance:"MAJOR",locationBinding:{scope:"EPHEMERAL_ENVIRONMENT",id:J.location,storyId:J.story,sceneId:J.scene,displayName:"Studio",environmentDescription:"Legacy environment",visualIdentityRequirement:"NONE"},locationState:{temporaryFacts:[]},castBindings:[exactCast],productBindings:[],entryState:[],events:legacyScript.scenes[0]!.entries,exitState:[],continuityFacts:[],timeRelation:"UNSPECIFIED",discontinuity:null,mustKeep:[],mustAvoid:[],lineageOperation:"CREATE",parentSceneVersionIds:[],createdBy:fixture.userAId,createdAt:"2026-09-15T02:02:00.000Z"});
    const legacyScenes=new AiStoryCanonicalSceneAuthorityService();await legacyScenes.proposeRevisionSet(legacyScope,[legacyScene]);await legacyScenes.transitionSet(legacyScope,"VALIDATED");await legacyScenes.transitionSet(legacyScope,"APPROVED");await legacyScenes.transitionSet(legacyScope,"FROZEN");
    const legacyPackage=animationPackageFixture("ready_for_execution");
    const legacyPackageId=id(30);
    await sql`insert into ai_story_animation_packages(id,org_id,workspace_id,campaign_id,story_id,story_version_id,status,payload,approved_at,approved_by) values(${legacyPackageId}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,${J.story}::uuid,${J.storyVersion}::uuid,'ready_for_execution',${sql.json(legacyPackage)},now(),${fixture.userAId}::uuid)`;
    const historicalPackage=await resolveApprovedAnimationPackageForStoryVersion(db,{orgId:fixture.orgId,workspaceId:fixture.workspaceAId,campaignId:fixture.campaignAId,storyId:J.story,storyVersionId:J.storyVersion});
    expect(AnimationPackagePayloadSchema.parse(historicalPackage!.payload).canonicalSceneAuthority).toBeUndefined();
    expect(await resolveCurrentCanonicalApprovedAnimationPackageForStoryVersion(db,{orgId:fixture.orgId,workspaceId:fixture.workspaceAId,campaignId:fixture.campaignAId,storyId:J.story,storyVersionId:J.storyVersion})).toBeNull();

    const baseIntent=compiled.intents[0]!;
    const legacyIdentity={contractVersion:baseIntent.identity.contractVersion,sceneExecutionId:id(32),tenantId:fixture.orgId,workspaceId:fixture.workspaceAId,campaignId:fixture.campaignAId,storyId:J.story,storyVersionId:J.storyVersion,animationPackageId:legacyPackageId,sceneId:legacyPackage.scenePlan[0]!.id,sceneOrder:0,idempotencyKey:"idem:legacy-package-scene",deterministicFingerprint:sha256CanonicalIntegrityHash({kind:"legacy-scene",storyId:J.story})};
    const legacyPackageReference={animationPackageId:legacyPackageId,storyId:J.story,storyVersionId:J.storyVersion,sceneCount:1,integrityHash:sha256CanonicalIntegrityHash(legacyPackage)};
    const legacyFrozenStory={storyId:J.story,storyVersionId:J.storyVersion,versionNumber:1,frozenAt:"2026-09-15T02:00:00.000Z",integrityHash:sha256CanonicalIntegrityHash({storyId:J.story,storyVersionId:J.storyVersion})};
    const sourceInstructions=compiled.instructionsBySceneExecutionId[baseIntent.identity.sceneExecutionId]!;
    const legacyInstructions=AiStorySceneCompiledInstructionsSchema.parse({contractVersion:sourceInstructions.contractVersion,capabilityId:sourceInstructions.capabilityId,sceneId:legacyIdentity.sceneId,sceneOrder:0,purpose:sourceInstructions.purpose,transition:sourceInstructions.transition,continuityNotes:sourceInstructions.continuityNotes,beatIds:sourceInstructions.beatIds,durationMs:sourceInstructions.durationMs,shots:sourceInstructions.shots.map((shot)=>({...shot})),characterReferences:sourceInstructions.characterReferences,referencedAssetIds:sourceInstructions.referencedAssetIds,worldContinuity:sourceInstructions.worldContinuity,productIdentityConstraints:sourceInstructions.productIdentityConstraints});
    const legacyInstructionHash=sha256CanonicalIntegrityHash(legacyInstructions);
    const legacyIntent=AiStorySceneExecutionIntentSchema.parse({...baseIntent,identity:legacyIdentity,frozenStoryVersion:legacyFrozenStory,animationPackage:legacyPackageReference,shotReferences:baseIntent.shotReferences.map((shot)=>({...shot,sceneId:legacyIdentity.sceneId})),normalizedPayloadReference:{uri:`memory://ai-story/scene-instructions/${legacyIdentity.sceneExecutionId}`,contentHash:legacyInstructionHash,mediaType:"application/json"},compilationHash:sha256CanonicalIntegrityHash({kind:"legacy-intent",storyId:J.story})});
    const legacyPlan=AiStoryExecutionPlanSchema.parse({contractVersion:compiled.storyExecutionPlan.contractVersion,storyExecutionId:id(31),frozenStoryVersion:legacyFrozenStory,animationPackage:legacyPackageReference,sceneExecutions:[legacyIdentity],compilationHash:sha256CanonicalIntegrityHash({kind:"legacy-plan",storyId:J.story}),compiledAt:"2026-09-15T02:03:00.000Z"});
    await sql`insert into ai_story_scene_instruction_snapshots(content_hash,snapshot_id,org_id,workspace_id,contract_version,instructions) values(${legacyInstructionHash},${id(33)}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,'1',${sql.json(legacyInstructions)})`;
    await sql`insert into ai_story_execution_plans(id,org_id,workspace_id,campaign_id,story_id,story_version_id,animation_package_id,status,contract_version,compilation_hash,deterministic_fingerprint,plan,compiled_at) values(${legacyPlan.storyExecutionId}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,${J.story}::uuid,${J.storyVersion}::uuid,${legacyPackageId}::uuid,'PLANNED','1',${legacyPlan.compilationHash},${sha256CanonicalIntegrityHash({kind:"legacy-plan-fingerprint",storyId:J.story})},${sql.json(legacyPlan)},${legacyPlan.compiledAt})`;
    await sql`insert into ai_story_scene_executions(id,execution_plan_id,org_id,workspace_id,campaign_id,story_id,story_version_id,animation_package_id,scene_id,scene_order,status,idempotency_key,deterministic_fingerprint,compilation_hash,instruction_hash,intent) values(${legacyIdentity.sceneExecutionId}::uuid,${legacyPlan.storyExecutionId}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,${fixture.campaignAId}::uuid,${J.story}::uuid,${J.storyVersion}::uuid,${legacyPackageId}::uuid,${legacyIdentity.sceneId},0,'PLANNED',${legacyIdentity.idempotencyKey},${legacyIdentity.deterministicFingerprint},${legacyIntent.compilationHash},${legacyInstructionHash},${sql.json(legacyIntent)})`;
    const [storedLegacyPlan]=await db.select().from(schema.aiStoryExecutionPlans).where(eq(schema.aiStoryExecutionPlans.id,legacyPlan.storyExecutionId));
    const [storedLegacyIntent]=await db.select().from(schema.aiStorySceneExecutions).where(eq(schema.aiStorySceneExecutions.id,legacyIdentity.sceneExecutionId));
    expect(AiStoryExecutionPlanSchema.parse(storedLegacyPlan!.plan).animationPackage.sceneSetFingerprint).toBeUndefined();
    expect(AiStorySceneExecutionIntentSchema.parse(storedLegacyIntent!.intent).identity.sceneVersionId).toBeUndefined();
    expect((await discoverCurrentExecutionPlan({userId:fixture.userAId,campaignId:fixture.campaignAId,storyId:J.story})).executionPlan).toBeNull();
    const [legacyPackageAfter]=await db.select().from(schema.aiStoryAnimationPackages).where(eq(schema.aiStoryAnimationPackages.id,legacyPackageId));
    const [legacyPlanAfter]=await db.select().from(schema.aiStoryExecutionPlans).where(eq(schema.aiStoryExecutionPlans.id,legacyPlan.storyExecutionId));
    const [legacyIntentAfter]=await db.select().from(schema.aiStorySceneExecutions).where(eq(schema.aiStorySceneExecutions.id,legacyIdentity.sceneExecutionId));
    expect(legacyPackageAfter!.payload).toEqual(legacyPackage);
    expect(legacyPlanAfter).toEqual(storedLegacyPlan);
    expect(legacyIntentAfter).toEqual(storedLegacyIntent);
  },60_000);
});
