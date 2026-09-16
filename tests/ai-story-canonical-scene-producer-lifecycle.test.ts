import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
  AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
  AiStoryCanonicalSceneSchema,
  AiStoryOutlineVersionSchema,
  AiStoryScriptVersionSchema,
  type AiStoryCanonicalScene,
  type AiStoryScriptSemanticProposalV1,
} from "@ceo-agent/shared";
import {
  AiStoryCanonicalSceneComposerError,
  buildAiStoryScriptVersion,
  canonicalAiStorySceneIdV1,
  composeAiStoryCanonicalOutlineV1,
  composeAiStoryCanonicalSceneSetV1,
  computeAiStoryScriptSemanticInputFingerprint,
  promoteAiStoryScriptSemanticProposalV1,
} from "@ceo-agent/shared/server";
import {
  AiStorySceneAuthorityError,
  resolveCurrentFrozenCanonicalSceneSet,
} from "@ceo-agent/db";
import {
  AiStoryCanonicalSceneProducerError,
  ensureCurrentFrozenCanonicalSceneSet,
  type CanonicalSceneProducerDependencies,
  type EnsureCurrentFrozenCanonicalSceneSetInput,
} from "../apps/web/src/lib/ai-story-canonical-scene-producer";

const id = (n: number) => `9d000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const I = { org:id(1), workspace:id(2), campaign:id(3), story:id(4), storyVersion:id(5), actor:id(6), product:id(7), character:id(8), characterVersion:id(9) };
const PROFILE = { profileId:"PRODUCT_STORY" as const, profileVersion:1 as const, policyFingerprint:AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT };
const STORY = { title:"Story",summary:"Exact summary",objective:"Build awareness",targetAudience:"People",tone:"Clear",estimatedDuration:"8s",story:{opening:"Open",development:"Advance",ending:"End"},keyMessages:[],cta:"Learn",assetReferences:[],warnings:[] };
const BEATS = [
  {id:"proposal-a",order:0,name:"Introduce",purpose:"Introduce Product",summary:"Product appears."},
  {id:"proposal-b",order:1,name:"Detail",purpose:"Reveal detail",summary:"Detail appears."},
];
const PLAN = [
  {id:"scene-plan-a",beatIds:["proposal-a"],purpose:"Exact introduction purpose",durationSec:4,transition:"",continuityNotes:"Keep framing",order:0},
  {id:"scene-plan-b",beatIds:["proposal-b"],purpose:"Exact detail purpose",durationSec:4,transition:"",continuityNotes:"",order:1},
];
const CHARACTER = {characterId:I.character,characterVersionId:I.characterVersion,characterFingerprint:hash("a"),name:"Exact Character",canonicalFacts:{identity:"Identity",appearance:"Appearance",personality:"Personality",emotionalArc:"Arc",relationships:[]}};
const CREATIVE = {storyContext:{title:"Story",summary:"Summary",objective:"Awareness",targetAudience:"People",tone:"Clear",estimatedDuration:"8s",keyMessages:[],cta:"Learn"},characterContext:{characters:[],relationships:[]},productAuthorities:[],worldContext:{locations:[],visualStyle:"",lighting:"",environment:"",objects:[],timeline:"",worldRules:[]},narrativeContext:{arc:"Arc",pacing:"Pace",emotionalJourney:"Journey",themes:[],dialogue:[]},directorContext:{}};
const DIRECTOR = {coreMessage:"Message",hero:"Hero",conflict:"Conflict",turningPoint:"Turn",climax:"Climax",takeaway:"Takeaway"};
const WORLD = {location:"Exact studio",lighting:"Soft",environment:"Exact persisted environment",objects:["Product"],timeline:"Present",worldRules:["Stable"]};

function outline() {
  const draft=composeAiStoryCanonicalOutlineV1({storyId:I.story,storyVersionId:I.storyVersion,orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,version:1,profile:PROFILE,storyDraft:STORY,proposedStoryBeats:BEATS,campaignObjective:"awareness",customObjective:null,productAuthorityIds:[I.product],characterAuthorities:[{characterId:I.character,characterVersionId:I.characterVersion,characterFingerprint:CHARACTER.characterFingerprint}],originalIdea:"Intent",supersedesOutlineVersionId:null,createdBy:I.actor,createdAt:"2026-09-15T00:00:00.000Z"});
  return AiStoryOutlineVersionSchema.parse({...draft,status:"FROZEN",approvedBy:I.actor,approvedAt:"2026-09-15T00:01:00.000Z",frozenAt:"2026-09-15T00:02:00.000Z"});
}

function proposal(): AiStoryScriptSemanticProposalV1 {
  return {contractVersion:AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,scenes:[
    {scenePlanItemId:PLAN[0]!.id,sceneFunction:"PRODUCT_INTRODUCTION",sceneFunctionRegistryVersion:1,sceneStateIn:[],sceneStateDeltas:[],sceneStateOut:[],entries:[{type:"ACTION",subjectId:I.character,objectId:I.product,action:"Character presents Product.",storyEffect:"Product introduced."}],newInformation:["Product present."],newActionOutcomes:["Introduction complete."]},
    {scenePlanItemId:PLAN[1]!.id,sceneFunction:"PRODUCT_DETAIL_REVEAL",sceneFunctionRegistryVersion:1,sceneStateIn:[],sceneStateDeltas:[],sceneStateOut:[],entries:[{type:"ACTION",subjectId:I.product,action:"Product detail remains visible.",storyEffect:"Detail revealed."}],newInformation:["Detail visible."],newActionOutcomes:["Detail understood."]},
  ]};
}

function script() {
  const source=outline();
  const material=promoteAiStoryScriptSemanticProposalV1({storyId:I.story,storyVersionId:I.storyVersion,frozenOutline:source,storyBeatProposals:BEATS,scenePlan:PLAN,characterAuthorities:[CHARACTER],semanticProposal:proposal()});
  const semanticInputFingerprint=computeAiStoryScriptSemanticInputFingerprint({storyId:I.story,storyVersionId:I.storyVersion,outlineVersionId:source.outlineVersionId,outlineSourceHash:source.sourceHash,story:STORY,storyBeats:BEATS,scenePlan:PLAN,creativeContext:CREATIVE,directorThinking:DIRECTOR,characterAuthorities:[CHARACTER],productAuthorityIds:[I.product]});
  const draft=buildAiStoryScriptVersion({storyId:I.story,storyVersionId:I.storyVersion,outlineVersionId:source.outlineVersionId,orgId:I.org,workspaceId:I.workspace,version:1,profileId:"PRODUCT_STORY",profileVersion:1,outlineSourceHash:source.sourceHash,semanticInputFingerprint,scenes:material.scenes,authorityReferences:material.authorityReferences,supersedesScriptVersionId:null,createdBy:I.actor,createdAt:"2026-09-15T01:00:00.000Z"});
  return AiStoryScriptVersionSchema.parse({...draft,status:"FROZEN",approvedBy:I.actor,approvedAt:"2026-09-15T01:01:00.000Z",frozenAt:"2026-09-15T01:02:00.000Z"});
}

const composerInput = () => ({orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,storyId:I.story,storyVersionId:I.storyVersion,actorUserId:I.actor,frozenOutline:outline(),frozenScript:script(),scenePlan:PLAN,worldContinuity:WORLD,characterAuthorities:[CHARACTER],productSources:[{assetId:I.product,contentHash:hash("b")}],createdAt:"2026-09-15T02:00:00.000Z"});
const frozen = (scenes: AiStoryCanonicalScene[], status: "DRAFT"|"VALIDATED"|"APPROVED"|"FROZEN"="FROZEN") => scenes.map((scene)=>AiStoryCanonicalSceneSchema.parse({...scene,status,approvedBy:status==="APPROVED"||status==="FROZEN"?I.actor:null,approvedAt:status==="APPROVED"||status==="FROZEN"?"2026-09-15T02:01:00.000Z":null,frozenAt:status==="FROZEN"?"2026-09-15T02:02:00.000Z":null}));

describe("AI Story Canonical Scene Package 1",()=>{
  it("projects one Script Scene exactly into one deterministic canonical Scene",()=>{
    const a=composeAiStoryCanonicalSceneSetV1(composerInput());
    const b=composeAiStoryCanonicalSceneSetV1(composerInput());
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    expect(a.map((scene)=>scene.sceneId)).toEqual([canonicalAiStorySceneIdV1(I.story,I.storyVersion,0),canonicalAiStorySceneIdV1(I.story,I.storyVersion,1)]);
    expect(a[0]!.sceneId).not.toBe(PLAN[0]!.id);
    expect(a[0]).toMatchObject({version:1,lineageOperation:"CREATE",parentSceneVersionIds:[],sceneFunction:"PRODUCT_INTRODUCTION",sceneRole:"PRODUCT_INTRODUCTION",importance:"MAJOR",entryState:[],exitState:[],timeRelation:"UNSPECIFIED",discontinuity:null});
    expect(a[0]!.events).toEqual(script().scenes[0]!.entries);
    expect(a[0]!.sourceScriptEntryIds).toEqual(script().scenes[0]!.entries.map((entry)=>entry.entryId));
  });

  it("creates deterministic ephemeral location, exact Character and Product bindings, and no generation mode",()=>{
    const scenes=composeAiStoryCanonicalSceneSetV1(composerInput());
    expect(scenes[0]!.locationBinding).toMatchObject({scope:"EPHEMERAL_ENVIRONMENT",storyId:I.story,sceneId:scenes[0]!.sceneId,displayName:WORLD.location,environmentDescription:`${WORLD.environment}\n\n${PLAN[0]!.purpose}\n\n${PLAN[0]!.continuityNotes}`,visualIdentityRequirement:"NONE"});
    expect(scenes[0]!.locationState).toEqual({temporaryFacts:[]});
    expect(scenes[0]!.castBindings).toEqual([{scope:"CAMPAIGN_CHARACTER",id:I.character,campaignId:I.campaign,authorityVersionId:I.characterVersion,authorityFingerprint:hash("a"),visualIdentityRequirement:"PREFERRED"}]);
    expect(scenes[0]!.productBindings).toEqual([{productAuthorityId:I.product,sourceAssetId:I.product,sourceAssetContentHash:hash("b"),visualIdentityRequirement:"REQUIRED"}]);
    expect(JSON.stringify(scenes)).not.toMatch(/generationMode|TEXT_TO_VIDEO|IMAGE_TO_VIDEO/);
  });

  it("uses REQUIRED for introduction/detail/evidence and PREFERRED otherwise",()=>{
    for(const semanticFunction of ["PRODUCT_INTRODUCTION","PRODUCT_DETAIL_REVEAL","PRODUCT_EVIDENCE","PRODUCT_RELATIONSHIP","PRODUCT_CONTEXT"]){
      const source=script();
      source.scenes[0]!.productStoryContributions=[{semanticFunction,contributionTypes:[semanticFunction==="PRODUCT_RELATIONSHIP"?"NEW_PRODUCT_RELATIONSHIP":semanticFunction==="PRODUCT_CONTEXT"?"NEW_PRODUCT_CONTEXT":semanticFunction==="PRODUCT_EVIDENCE"?"NEW_PRODUCT_EVIDENCE":"NEW_PRODUCT_INFORMATION"],productAuthorityIds:[I.product],claimIds:[],summary:"Exact policy intent"}];
      const scenes=composeAiStoryCanonicalSceneSetV1({...composerInput(),frozenScript:source});
      expect(scenes[0]!.productBindings[0]!.visualIdentityRequirement).toBe(["PRODUCT_INTRODUCTION","PRODUCT_DETAIL_REVEAL","PRODUCT_EVIDENCE"].includes(semanticFunction)?"REQUIRED":"PREFERRED");
    }
  });

  it("fails closed for unsupported importance, unresolved exact Character/Product, and topology changes",()=>{
    const minor=outline(); minor.beats[0]!.classification="MINOR";
    expect(()=>composeAiStoryCanonicalSceneSetV1({...composerInput(),frozenOutline:minor})).toThrowError(expect.objectContaining({code:"CANONICAL_SCENE_IMPORTANCE_POLICY_UNSUPPORTED"}));
    expect(()=>composeAiStoryCanonicalSceneSetV1({...composerInput(),characterAuthorities:[]})).toThrowError(expect.objectContaining({code:"CANONICAL_SCENE_CHARACTER_AUTHORITY_UNRESOLVED"}));
    expect(()=>composeAiStoryCanonicalSceneSetV1({...composerInput(),productSources:[]})).toThrowError(expect.objectContaining({code:"CANONICAL_SCENE_PRODUCT_AUTHORITY_UNRESOLVED"}));
    expect(()=>composeAiStoryCanonicalSceneSetV1({...composerInput(),scenePlan:PLAN.slice(0,1)})).toThrowError(expect.objectContaining({code:"CANONICAL_SCENE_TOPOLOGY_CHANGE_UNSUPPORTED_V1"}));
  });

  it("reuses same semantic lineage and revises changed semantics only after FROZEN",()=>{
    const created=composeAiStoryCanonicalSceneSetV1(composerInput());
    const current=frozen(created);
    const same=composeAiStoryCanonicalSceneSetV1({...composerInput(),currentScenes:current});
    expect(same.map((scene)=>scene.sourceHash)).toEqual(current.map((scene)=>scene.sourceHash));
    const revised=composeAiStoryCanonicalSceneSetV1({...composerInput(),worldContinuity:{...WORLD,environment:"Changed exact environment"},currentScenes:current});
    expect(revised.every((scene,index)=>scene.version===2&&scene.lineageOperation==="REVISE"&&scene.parentSceneVersionIds[0]===current[index]!.sceneVersionId)).toBe(true);
    for(const status of ["DRAFT","VALIDATED","APPROVED"] as const){
      expect(()=>composeAiStoryCanonicalSceneSetV1({...composerInput(),worldContinuity:{...WORLD,environment:"Changed"},currentScenes:frozen(created,status)})).toThrowError(expect.objectContaining({code:"CANONICAL_SCENE_INCOMPLETE_LINEAGE_CONFLICT"}));
    }
  });

  it("fails closed for mixed lifecycle and changed stable topology",()=>{
    const created=composeAiStoryCanonicalSceneSetV1(composerInput());
    const mixed=[...frozen(created)]; mixed[0]={...mixed[0]!,status:"APPROVED",frozenAt:null};
    expect(()=>composeAiStoryCanonicalSceneSetV1({...composerInput(),currentScenes:mixed})).toThrowError(expect.objectContaining({code:"CANONICAL_SCENE_SET_LIFECYCLE_AMBIGUOUS"}));
    const bad=[...frozen(created)]; bad[0]={...bad[0]!,sceneId:id(99)};
    expect(()=>composeAiStoryCanonicalSceneSetV1({...composerInput(),currentScenes:bad})).toThrowError(expect.objectContaining({code:"CANONICAL_SCENE_TOPOLOGY_CHANGE_UNSUPPORTED_V1"}));
  });

  it("revalidates Script semantic input before persistence",async()=>{
    const input:EnsureCurrentFrozenCanonicalSceneSetInput={db:{} as never,orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,storyId:I.story,storyVersionId:I.storyVersion,actorUserId:I.actor,story:STORY,storyBeats:BEATS,scenePlan:PLAN,creativeContext:CREATIVE,directorThinking:DIRECTOR,worldContinuity:WORLD,characterAuthorities:[CHARACTER]};
    let current:AiStoryCanonicalScene[]=[]; const transitions:string[]=[];
    const deps:CanonicalSceneProducerDependencies={
      resolveCurrentOutline:async()=>outline(),resolveCurrentScript:async()=>script(),resolveProducts:async()=>[{storyId:I.story,assetId:I.product,usageType:"product_source",orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,contentHash:hash("b"),status:"ready"}],
      readCurrent:async(_db,scope)=>{expect(scope.requireCurrentFrozenStoryVersion).toBe(true);return current;},compose:composeAiStoryCanonicalSceneSetV1,
      propose:async(_db,_scope,scenes)=>{transitions.push("DRAFT");current=scenes;return current;},
      transition:async(_db,_scope,to)=>{transitions.push(to);current=frozen(current,to);return current;},
      resolveFrozen:async()=>current,now:()=>"2026-09-15T02:00:00.000Z",
    };
    const result=await ensureCurrentFrozenCanonicalSceneSet(input,deps);
    expect(result.every((scene)=>scene.status==="FROZEN")).toBe(true);
    expect(transitions).toEqual(["DRAFT","VALIDATED","APPROVED","FROZEN"]);
    await expect(ensureCurrentFrozenCanonicalSceneSet({...input,directorThinking:{...DIRECTOR,climax:"Changed"}},deps)).rejects.toMatchObject<Partial<AiStoryCanonicalSceneProducerError>>({code:"CANONICAL_SCENE_SCRIPT_PLANNING_INPUT_STALE"});
  });

  it.each(["DRAFT","VALIDATED","APPROVED","FROZEN"] as const)("resumes or reuses same-source %s set without proposing",async(status)=>{
    const input:EnsureCurrentFrozenCanonicalSceneSetInput={db:{} as never,orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,storyId:I.story,storyVersionId:I.storyVersion,actorUserId:I.actor,story:STORY,storyBeats:BEATS,scenePlan:PLAN,creativeContext:CREATIVE,directorThinking:DIRECTOR,worldContinuity:WORLD,characterAuthorities:[CHARACTER]};
    let current=frozen(composeAiStoryCanonicalSceneSetV1(composerInput()),status); let proposals=0;
    const deps:CanonicalSceneProducerDependencies={resolveCurrentOutline:async()=>outline(),resolveCurrentScript:async()=>script(),resolveProducts:async()=>[{storyId:I.story,assetId:I.product,usageType:"product_source",orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,contentHash:hash("b"),status:"ready"}],readCurrent:async()=>current,compose:composeAiStoryCanonicalSceneSetV1,propose:async()=>{proposals++;return current;},transition:async(_db,_scope,to)=>{current=frozen(current,to);return current;},resolveFrozen:async()=>current,now:()=>"2026-09-15T02:00:00.000Z"};
    await expect(ensureCurrentFrozenCanonicalSceneSet(input,deps)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({status:"FROZEN"})]));
    expect(proposals).toBe(0);
  });

  it("resolves only zero or one complete current FROZEN set and rejects partial, mixed, stale, or corrupted authority",async()=>{
    const source=script(); const scenes=frozen(composeAiStoryCanonicalSceneSetV1(composerInput()));
    const row=(scene:AiStoryCanonicalScene)=>({version:{sceneVersionId:scene.sceneVersionId,sceneId:scene.sceneId,orgId:scene.orgId,workspaceId:scene.workspaceId,campaignId:scene.campaignId,storyId:scene.storyId,storyVersionId:scene.storyVersionId,scriptVersionId:scene.scriptVersionId,version:scene.version,sceneOrder:scene.order,contractVersion:scene.contractVersion,sourceHash:scene.sourceHash,fingerprint:scene.fingerprint,status:scene.status,snapshot:scene,createdBy:scene.createdBy,createdAt:new Date(scene.createdAt),approvedBy:scene.approvedBy,approvedAt:new Date(scene.approvedAt!),frozenAt:new Date(scene.frozenAt!)},aggregate:{sceneId:scene.sceneId,orgId:scene.orgId,workspaceId:scene.workspaceId,campaignId:scene.campaignId,storyId:scene.storyId,currentVersion:scene.version,currentSceneVersionId:scene.sceneVersionId,status:scene.status,createdBy:scene.createdBy,createdAt:new Date(scene.createdAt),updatedAt:new Date(scene.frozenAt!)}});
    const scope={orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,storyId:I.story,storyVersionId:I.storyVersion};
    const dep=(values:ReturnType<typeof row>[])=>({resolveCurrentScript:async()=>source,loadCurrentRows:async()=>values});
    await expect(resolveCurrentFrozenCanonicalSceneSet({} as never,scope,dep([]) as never)).resolves.toBeNull();
    await expect(resolveCurrentFrozenCanonicalSceneSet({} as never,scope,dep(scenes.map(row)) as never)).resolves.toEqual(scenes);
    await expect(resolveCurrentFrozenCanonicalSceneSet({} as never,scope,dep([row(scenes[0]!)]) as never)).rejects.toMatchObject({code:"CURRENT_FROZEN_SCENE_SET_INCOMPLETE"});
    const stale={...scenes[0]!,scriptVersionId:id(99)}; const staleRows=[row(stale),row({...scenes[1]!,scriptVersionId:id(99)})];
    await expect(resolveCurrentFrozenCanonicalSceneSet({} as never,scope,dep(staleRows) as never)).rejects.toMatchObject({code:"CURRENT_FROZEN_SCENE_SET_STALE_SCRIPT"});
    const badRow=row(scenes[0]!); badRow.version.sourceHash=hash("f");
    await expect(resolveCurrentFrozenCanonicalSceneSet({} as never,scope,dep([badRow,row(scenes[1]!)]) as never)).rejects.toBeInstanceOf(AiStorySceneAuthorityError);
  });

  it("gates Animation Package construction and passes the exact frozen Scene set into the builder",()=>{
    const runner=readFileSync("apps/web/src/lib/ai-story-planning-runner.ts","utf8");
    const stage=runner.slice(runner.indexOf('case "animation_package"'),runner.indexOf("default:"));
    expect(stage.indexOf("ensureCurrentFrozenCanonicalSceneSet")).toBeLessThan(stage.indexOf("buildAnimationPackage"));
    expect(stage).toContain("const canonicalScenes = await ensureCurrentFrozenCanonicalSceneSet");
    expect(stage).toContain("canonicalScenes,");
  });
});
