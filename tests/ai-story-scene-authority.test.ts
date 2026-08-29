import { describe, expect, it } from "vitest";
import {
  AI_STORY_SCENE_SCOPE_POLICY,
  AiStoryCanonicalSceneSchema,
  AiStoryLocationPromotionSchema,
  locationReferenceKey,
  projectLegacyScenePlanCompatibility,
  selectLocationScopeFromContinuityHorizon,
  type AiStoryCanonicalScene,
  type AiStoryScriptVersion,
} from "@ceo-agent/shared";
import {
  assertAiStorySceneTransition,
  buildAiStoryLocationVersion,
  buildAiStoryScriptVersion,
  computeAiStorySceneFingerprint,
  computeAiStoryLocationFingerprint,
  finalizeAiStoryCanonicalScene,
  validateAiStoryCanonicalScenes,
} from "@ceo-agent/shared/server";

const id = (n: number) => `76000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const I = {
  org:id(1),workspace:id(2),campaign:id(3),story:id(4),storyVersion:id(5),outlineVersion:id(6),actor:id(7),
  scriptA:id(8),scriptB:id(9),entryA:id(10),entryB:id(11),sceneA:id(12),sceneB:id(13),character:id(14),product:id(15),
  campaignLocation:id(16),storyLocation:id(17),ephemeralA:id(18),ephemeralB:id(19),beatA:id(20),beatB:id(21),
};
const assetHash=`sha256:${"a".repeat(64)}`;

function script(): AiStoryScriptVersion {
  return buildAiStoryScriptVersion({
    storyId:I.story,storyVersionId:I.storyVersion,outlineVersionId:I.outlineVersion,orgId:I.org,workspaceId:I.workspace,
    version:1,profileId:"CORE",profileVersion:1,outlineSourceHash:`sha256:${"b".repeat(64)}`,
    scenes:[
      {scriptSceneId:I.scriptA,order:0,outlineBeatClaims:[{outlineBeatId:I.beatA,claim:"Establish movement"}],sceneFunction:"TRANSITION",sceneFunctionRegistryVersion:1,
       sceneStateIn:[{dimension:"LOCATION",subjectId:I.character,value:"origin"}],sceneStateDeltas:[{dimension:"LOCATION",subjectId:I.character,fromValue:"origin",value:"destination",reason:"Travel"}],sceneStateOut:[{dimension:"LOCATION",subjectId:I.character,value:"destination"}],
       entries:[{entryId:I.entryA,order:0,type:"ACTION",subjectId:I.character,action:"The subject travels through a passing environment.",storyEffect:"Location progression is established",durationRange:{minSeconds:2,maxSeconds:5}}],characterIds:[I.character],locationIds:[],propIds:[],assetIds:[],productAuthorityRefs:[],targetDurationRange:{minSeconds:2,maxSeconds:7},mustKeep:["Character identity"],mustAvoid:["Teleportation"],newInformation:["Destination context"],newEvidence:[],newActionOutcomes:["Travel completed"],productEvidence:[]},
      {scriptSceneId:I.scriptB,order:1,outlineBeatClaims:[{outlineBeatId:I.beatB,claim:"Reveal evidence"}],sceneFunction:"PRODUCT_DETAIL_REVEAL",sceneFunctionRegistryVersion:1,
       sceneStateIn:[{dimension:"LOCATION",subjectId:I.character,value:"destination"}],sceneStateDeltas:[{dimension:"PRODUCT_STATE",subjectId:I.product,fromValue:"concealed",value:"revealed",reason:"Evidence reveal"}],sceneStateOut:[{dimension:"LOCATION",subjectId:I.character,value:"destination"},{dimension:"PRODUCT_STATE",subjectId:I.product,value:"revealed"}],
       entries:[{entryId:I.entryB,order:0,type:"ACTION",subjectId:I.character,objectId:I.product,action:"The subject reveals the verified Product detail.",storyEffect:"Evidence becomes visible",durationRange:{minSeconds:2,maxSeconds:5}}],characterIds:[I.character],locationIds:[],propIds:[],assetIds:[I.product],productAuthorityRefs:[I.product],targetDurationRange:{minSeconds:3,maxSeconds:8},mustKeep:["Product identity"],mustAvoid:["Unsupported transformation"],newInformation:["Verified detail"],newEvidence:["Product evidence"],newActionOutcomes:["Detail revealed"],productEvidence:["Product evidence"]},
    ],authorityReferences:[{authorityType:"CHARACTER",authorityId:I.character},{authorityType:"PRODUCT",authorityId:I.product}],supersedesScriptVersionId:null,createdBy:I.actor,createdAt:"2026-08-29T06:00:00.000Z",
  });
}

function scene(source: AiStoryScriptVersion["scenes"][number], sceneId: string, order: number, locationBinding: AiStoryCanonicalScene["locationBinding"], importance: AiStoryCanonicalScene["importance"] = "MAJOR") {
  return finalizeAiStoryCanonicalScene({
    sceneId,orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,storyId:I.story,storyVersionId:I.storyVersion,scriptVersionId:script().scriptVersionId,
    version:1,order,sourceScriptSceneIds:[source.scriptSceneId],sourceScriptEntryIds:source.entries.map((entry)=>entry.entryId),sceneFunction:source.sceneFunction,
    sceneRole:importance==="TRANSITIONAL"?"TRANSITIONAL":"REVEAL",importance,locationBinding,locationState:{temporaryFacts:importance==="TRANSITIONAL"?["Passing context establishes travel"]:[]},
    castBindings:[],productBindings:source.productAuthorityRefs.map(()=>({productAuthorityId:I.product,sourceAssetId:I.product,sourceAssetContentHash:assetHash})),
    entryState:source.sceneStateIn,events:source.entries,exitState:source.sceneStateOut,continuityFacts:source.newInformation,timeRelation:order===0?"UNSPECIFIED":"CONTINUOUS",discontinuity:null,
    mustKeep:source.mustKeep,mustAvoid:source.mustAvoid,lineageOperation:"CREATE",parentSceneVersionIds:[],createdBy:I.actor,createdAt:"2026-08-29T06:10:00.000Z",
  });
}

describe("AI Story canonical Scene and Location authority",()=>{
  it("selects Location scope only from continuity horizon across names and genres",()=>{
    expect(selectLocationScopeFromContinuityHorizon("CAMPAIGN")).toBe("CAMPAIGN_LOCATION");
    expect(selectLocationScopeFromContinuityHorizon("STORY")).toBe("STORY_LOCATION");
    expect(selectLocationScopeFromContinuityHorizon("SCENE")).toBe("EPHEMERAL_ENVIRONMENT");
    for(const fixture of [{name:"parking lot",genre:"romance",horizon:"STORY"},{name:"home",genre:"mystery",horizon:"SCENE"},{name:"shop",genre:"commercial",horizon:"CAMPAIGN"},{name:"unseen place",genre:"unknown",horizon:"SCENE"}] as const){
      expect(selectLocationScopeFromContinuityHorizon(fixture.horizon)).toBe(fixture.horizon==="CAMPAIGN"?"CAMPAIGN_LOCATION":fixture.horizon==="STORY"?"STORY_LOCATION":"EPHEMERAL_ENVIRONMENT");
    }
    expect(AI_STORY_SCENE_SCOPE_POLICY).toMatchObject({locationNameDeterminesScope:false,genreDeterminesLocationScope:false,sceneImportanceDeterminesLocationScope:false,locationScopeForcesGenerationMode:false,environmentTypeAllowlist:false});
  });

  it("builds stable Location versions and permits recurring returns without duplicate identity",()=>{
    const input={locationId:I.campaignLocation,scope:"CAMPAIGN_LOCATION" as const,orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,storyId:null,version:1,facts:{displayName:"Recurring base",identity:"Campaign recurring environment",appearance:"Stable architectural identity",fixedElements:["entry"],environmentalCharacteristics:["open interior"],visualAssetIds:[]},status:"ACTIVE" as const,supersedesLocationVersionId:null,createdBy:I.actor,createdAt:"2026-08-29T06:05:00.000Z"};
    const location=buildAiStoryLocationVersion(input);
    expect(buildAiStoryLocationVersion(input).locationVersionId).toBe(location.locationVersionId);
    expect(computeAiStoryLocationFingerprint(location)).toBe(location.fingerprint);
    const ref={scope:"CAMPAIGN_LOCATION" as const,id:I.campaignLocation,campaignId:I.campaign,authorityVersionId:location.locationVersionId,authorityFingerprint:location.fingerprint,visualIdentityRequirement:"PREFERRED" as const};
    expect(locationReferenceKey(ref)).toBe(`CAMPAIGN_LOCATION:${I.campaignLocation}`);
    expect(scene(script().scenes[0]!,I.sceneA,0,ref,"TRANSITIONAL").locationBinding.id).toBe(scene(script().scenes[1]!,I.sceneB,1,ref).locationBinding.id);
  });

  it("permits only explicit upward Location promotion without rewriting source lineage",()=>{const ephemeral={scope:"EPHEMERAL_ENVIRONMENT" as const,id:I.ephemeralA,storyId:I.story,sceneId:I.sceneA,displayName:"Passing",environmentDescription:"One-off environment",visualIdentityRequirement:"NONE" as const};const storyTarget={scope:"STORY_LOCATION" as const,id:I.storyLocation,storyId:I.story,authorityVersionId:id(31),authorityFingerprint:`sha256:${"c".repeat(64)}`,visualIdentityRequirement:"PREFERRED" as const};const campaignTarget={scope:"CAMPAIGN_LOCATION" as const,id:I.campaignLocation,campaignId:I.campaign,authorityVersionId:id(32),authorityFingerprint:`sha256:${"d".repeat(64)}`,visualIdentityRequirement:"PREFERRED" as const};const base={promotionId:id(33),orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,storyId:I.story,promotedBy:I.actor,promotedAt:"2026-08-29T06:07:00.000Z"};expect(AiStoryLocationPromotionSchema.parse({...base,source:ephemeral,target:storyTarget}).source).toEqual(ephemeral);expect(AiStoryLocationPromotionSchema.parse({...base,source:storyTarget,target:campaignTarget}).target).toEqual(campaignTarget);expect(()=>AiStoryLocationPromotionSchema.parse({...base,source:campaignTarget,target:storyTarget})).toThrow();});

  it("accepts a passing ephemeral transition and coherent next Scene",()=>{
    const source=script();
    const passing={scope:"EPHEMERAL_ENVIRONMENT" as const,id:I.ephemeralA,storyId:I.story,sceneId:I.sceneA,displayName:"Passing environment",environmentDescription:"A one-off travel context",visualIdentityRequirement:"NONE" as const};
    const destination={scope:"EPHEMERAL_ENVIRONMENT" as const,id:I.ephemeralB,storyId:I.story,sceneId:I.sceneB,displayName:"Destination",environmentDescription:"A consequential destination",visualIdentityRequirement:"NONE" as const};
    const scenes=[scene(source.scenes[0]!,I.sceneA,0,passing,"TRANSITIONAL"),scene(source.scenes[1]!,I.sceneB,1,destination)];
    expect(validateAiStoryCanonicalScenes(scenes,source)).toEqual([]);
  });

  it("blocks cross-Scene ephemeral reuse, broken continuity, and Script event rewriting",()=>{
    const source=script();
    const wrong={scope:"EPHEMERAL_ENVIRONMENT" as const,id:I.ephemeralA,storyId:I.story,sceneId:I.sceneA,displayName:"Passing",environmentDescription:"One Scene",visualIdentityRequirement:"NONE" as const};
    const first=scene(source.scenes[0]!,I.sceneA,0,wrong,"TRANSITIONAL");
    const second=scene(source.scenes[1]!,I.sceneB,1,wrong);
    const broken=structuredClone(second); broken.entryState[0]!.value="impossible reset"; if(broken.events[0]?.type==="ACTION")broken.events[0].action="Invented event";
    const gates=validateAiStoryCanonicalScenes([first,broken],source).map((issue)=>issue.gate);
    expect(gates).toContain("LOCATION_SCOPE_GATE"); expect(gates).toContain("SCENE_CONTINUITY_GATE"); expect(gates).toContain("SCENE_LINEAGE_GATE"); expect(gates).toContain("SCENE_FINGERPRINT_GATE");
  });

  it("preserves stable Scene ID across reorder/revision and validates lifecycle",()=>{
    const source=script(); const location={scope:"EPHEMERAL_ENVIRONMENT" as const,id:I.ephemeralA,storyId:I.story,sceneId:I.sceneA,displayName:"Unknown",environmentDescription:"Unknown environment type",visualIdentityRequirement:"NONE" as const};
    const original=scene(source.scenes[0]!,I.sceneA,0,location,"TRANSITIONAL");
    const revised=finalizeAiStoryCanonicalScene({...original,sceneVersionId:undefined as never,contractVersion:undefined as never,sourceHash:undefined as never,fingerprint:undefined as never,status:undefined as never,approvedBy:undefined as never,approvedAt:undefined as never,frozenAt:undefined as never,version:2,order:1,lineageOperation:"REORDER",parentSceneVersionIds:[original.sceneVersionId],createdAt:"2026-08-29T06:20:00.000Z"});
    expect(revised.sceneId).toBe(original.sceneId); expect(revised.sceneVersionId).not.toBe(original.sceneVersionId); expect(revised.fingerprint).toBe(computeAiStorySceneFingerprint(revised));
    expect(()=>assertAiStorySceneTransition("DRAFT","VALIDATED")).not.toThrow(); expect(()=>assertAiStorySceneTransition("DRAFT","FROZEN")).toThrow();
  });

  it("supports explicit split/merge lineage without allowing silent event loss or duplication",()=>{
    const source=script(); const location={scope:"EPHEMERAL_ENVIRONMENT" as const,id:I.ephemeralA,storyId:I.story,sceneId:I.sceneA,displayName:"Abstract passage",environmentDescription:"Passing environment",visualIdentityRequirement:"NONE" as const};
    const original=scene(source.scenes[0]!,I.sceneA,0,location,"TRANSITIONAL");
    expect(AiStoryCanonicalSceneSchema.parse({...original,lineageOperation:"SPLIT",parentSceneVersionIds:[original.sceneVersionId]}).lineageOperation).toBe("SPLIT");
    expect(AiStoryCanonicalSceneSchema.parse({...original,lineageOperation:"MERGE",parentSceneVersionIds:[original.sceneVersionId,id(99)]}).lineageOperation).toBe("MERGE");
    expect(validateAiStoryCanonicalScenes([original],source).some((issue)=>issue.message.includes(I.entryB))).toBe(true);
    expect(validateAiStoryCanonicalScenes([original,original],source).some((issue)=>issue.gate==="SCENE_ORDER_GATE"||issue.gate==="SCENE_LINEAGE_GATE")).toBe(true);
  });

  it("keeps legacy Scene Plans readable without manufacturing canonical authority",()=>{
    expect(projectLegacyScenePlanCompatibility({scenes:[{location:"legacy"}]})).toMatchObject({kind:"LEGACY_SCENE_PLAN_COMPATIBILITY",canonicalSceneAuthority:null});
  });
});
