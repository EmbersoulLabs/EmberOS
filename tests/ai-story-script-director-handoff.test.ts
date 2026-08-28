import { describe, expect, it } from "vitest";
import {
  AI_STORY_DIRECTOR_OWNERSHIP_MATRIX,
  AiStoryScriptDirectorHandoffSchema,
  projectLegacyPlanningToDirectorCompatibility,
  resolveDirectorInputAuthority,
  validateAiStoryScriptDirectorHandoff,
  type AiStoryScriptVersion,
} from "@ceo-agent/shared";
import {
  buildAiStoryScriptDirectorHandoff,
  buildAiStoryScriptVersion,
  computeAiStoryScriptDirectorHandoffFingerprint,
  computeAiStoryScriptDirectorHandoffSourceHash,
} from "@ceo-agent/shared/server";

const id = (n: number) => `61000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const I = { org:id(1), workspace:id(2), story:id(3), storyVersion:id(4), outline:id(5), actor:id(6), beatA:id(7), beatB:id(8), sceneA:id(9), sceneB:id(10), character:id(11), product:id(12), actionA:id(13), actionB:id(14), dialogue:id(15), vo:id(16) };
const hash = (value: string) => `sha256:${value.repeat(64)}`;

function frozenScript(): AiStoryScriptVersion {
  const draft = buildAiStoryScriptVersion({
    storyId:I.story,storyVersionId:I.storyVersion,outlineVersionId:I.outline,orgId:I.org,workspaceId:I.workspace,version:1,profileId:"CORE",profileVersion:1,outlineSourceHash:hash("a"),
    scenes:[
      {scriptSceneId:I.sceneA,order:0,outlineBeatClaims:[{outlineBeatId:I.beatA,claim:"Introduce the exact product"}],sceneFunction:"PRODUCT_INTRODUCTION",sceneFunctionRegistryVersion:1,
       sceneStateIn:[{dimension:"KNOWLEDGE",subjectId:I.character,value:"unaware"}],sceneStateDeltas:[{dimension:"KNOWLEDGE",subjectId:I.character,fromValue:"unaware",value:"aware",reason:"Product introduced"}],sceneStateOut:[{dimension:"KNOWLEDGE",subjectId:I.character,value:"aware"}],
       entries:[{entryId:I.actionA,order:0,type:"ACTION",subjectId:I.character,action:"A customer inspects the product.",storyEffect:"The product enters the decision",durationRange:{minSeconds:2,maxSeconds:4}}],characterIds:[I.character],locationIds:[],propIds:[],assetIds:[I.product],productAuthorityRefs:[I.product],targetDurationRange:{minSeconds:3,maxSeconds:8},mustKeep:["Exact product identity"],mustAvoid:["Unsupported claims"],newInformation:["Product exists"],newEvidence:[],newActionOutcomes:["Customer investigates"],productEvidence:[]},
      {scriptSceneId:I.sceneB,order:1,outlineBeatClaims:[{outlineBeatId:I.beatB,claim:"Reveal distinct product evidence"}],sceneFunction:"PRODUCT_DETAIL_REVEAL",sceneFunctionRegistryVersion:1,
       sceneStateIn:[{dimension:"KNOWLEDGE",subjectId:I.character,value:"aware"}],sceneStateDeltas:[{dimension:"KNOWLEDGE",subjectId:I.character,fromValue:"aware",value:"convinced",reason:"Evidence resolves doubt"}],sceneStateOut:[{dimension:"KNOWLEDGE",subjectId:I.character,value:"convinced"}],
       entries:[{entryId:I.actionB,order:0,type:"ACTION",subjectId:I.product,action:"The verified detail is compared with the claim.",storyEffect:"Evidence resolves doubt",durationRange:{minSeconds:2,maxSeconds:5}},{entryId:I.dialogue,order:1,type:"DIALOGUE",speakerId:I.character,line:"That is the proof I needed.",deliveryOrSubtext:"Certain",language:"en",durationRange:{minSeconds:1,maxSeconds:3}},{entryId:I.vo,order:2,type:"VO",voiceOwnerId:I.character,line:"Evidence earns trust.",narrativePurpose:"Resolve the claim",language:"en",durationRange:{minSeconds:1,maxSeconds:3}}],characterIds:[I.character],locationIds:[],propIds:[],assetIds:[I.product],productAuthorityRefs:[I.product],targetDurationRange:{minSeconds:5,maxSeconds:14},mustKeep:["Verified detail"],mustAvoid:["New product identity"],newInformation:["Claim verified"],newEvidence:["Authoritative detail"],newActionOutcomes:["Customer decides"],productEvidence:["Verified product detail"]},
    ],authorityReferences:[{authorityType:"CHARACTER",authorityId:I.character},{authorityType:"PRODUCT",authorityId:I.product},{authorityType:"ASSET",authorityId:I.product}],supersedesScriptVersionId:null,createdBy:I.actor,createdAt:"2026-08-28T01:00:00.000Z",
  });
  return { ...draft, status:"FROZEN", approvedBy:I.actor, approvedAt:"2026-08-28T01:01:00.000Z", frozenAt:"2026-08-28T01:02:00.000Z" };
}

function handoff() {
  return buildAiStoryScriptDirectorHandoff({script:frozenScript(),productAuthorityBindings:[{productAuthorityId:I.product,sourceAssetId:I.product,sourceAssetContentHash:hash("b"),requiredRoles:["PRESENT","EVIDENCE_REQUIRED"]}],supersedesHandoffId:null,createdBy:I.actor,createdAt:"2026-08-28T01:03:00.000Z"});
}

function validate(value = handoff(), script = frozenScript(), currentScriptVersionId = script.scriptVersionId) {
  return validateAiStoryScriptDirectorHandoff(value,script,{expectedSourceHash:computeAiStoryScriptDirectorHandoffSourceHash(value),expectedFingerprint:computeAiStoryScriptDirectorHandoffFingerprint(value),currentScriptVersionId});
}

describe("immutable Script to Director handoff",()=>{
  it("builds a deterministic versioned frozen projection with exact lineage",()=>{const first=handoff();const second=handoff();expect(first).toEqual(second);expect(first.scriptSourceHash).toBe(frozenScript().sourceHash);expect(first.frozenAt).toBe(first.createdAt);expect(validate(first)).toEqual([]);expect(AiStoryScriptDirectorHandoffSchema.parse(first)).toEqual(first);});
  it("requires a frozen Script",()=>{expect(()=>buildAiStoryScriptDirectorHandoff({script:{...frozenScript(),status:"APPROVED",frozenAt:null},productAuthorityBindings:[],supersedesHandoffId:null,createdBy:I.actor,createdAt:"2026-08-28T01:03:00.000Z"})).toThrow(/SCRIPT_NOT_FROZEN/);});
  it.each([
    ["Dialogue",(value:ReturnType<typeof handoff>)=>{value.sceneHandoffs[1]!.dialogueEntries[0]!.line="Rewritten";},"DIALOGUE_BINDING_GATE"],
    ["VO",(value:ReturnType<typeof handoff>)=>{value.sceneHandoffs[1]!.voiceOverEntries[0]!.line="Rewritten VO";},"DIALOGUE_BINDING_GATE"],
    ["Beat",(value:ReturnType<typeof handoff>)=>{value.sceneHandoffs[0]!.outlineBeatClaims[0]!.outlineBeatId=id(99);},"BEAT_BINDING_GATE"],
    ["Scene Function",(value:ReturnType<typeof handoff>)=>{value.sceneHandoffs[0]!.sceneFunction="PAYOFF";},"SCENE_FUNCTION_BINDING_GATE"],
    ["state delta",(value:ReturnType<typeof handoff>)=>{value.sceneHandoffs[0]!.sceneStateDeltas[0]!.value="forgotten";},"STATE_BINDING_GATE"],
    ["Product reference",(value:ReturnType<typeof handoff>)=>{value.sceneHandoffs[0]!.productAuthorityRefs[0]=id(98);},"PRODUCT_AUTHORITY_BINDING_GATE"],
    ["mustKeep",(value:ReturnType<typeof handoff>)=>{value.sceneHandoffs[0]!.mustKeep=[];},"PRESERVATION_CONSTRAINT_GATE"],
    ["mustAvoid",(value:ReturnType<typeof handoff>)=>{value.sceneHandoffs[0]!.mustAvoid.push("Rewrite dialogue");},"PRESERVATION_CONSTRAINT_GATE"],
    ["duration",(value:ReturnType<typeof handoff>)=>{value.sceneHandoffs[0]!.targetDurationRange.maxSeconds=99;},"DURATION_BINDING_GATE"],
    ["ACTION truth",(value:ReturnType<typeof handoff>)=>{value.sceneHandoffs[0]!.actionEntries[0]!.action="Different action";},"ACTION_TRUTH_BINDING_GATE"],
  ])("blocks %s tampering",(_name,mutate,gate)=>{const value=structuredClone(handoff());mutate(value);expect(validate(value).some(issue=>issue.gate===gate)).toBe(true);});
  it("blocks source-fingerprint tampering and stale Script authority",()=>{const value=handoff();expect(validateAiStoryScriptDirectorHandoff(value,frozenScript(),{expectedSourceHash:hash("c"),expectedFingerprint:value.handoffFingerprint}).some(i=>i.gate==="HANDOFF_FINGERPRINT_GATE")).toBe(true);expect(validate(value,frozenScript(),id(97)).some(i=>i.gate==="STALE_HANDOFF_GATE")).toBe(true);});
  it("preserves the R4 introduction/detail distinction pre-Director",()=>{const value=handoff();expect(value.sceneHandoffs.map(scene=>scene.sceneFunction)).toEqual(["PRODUCT_INTRODUCTION","PRODUCT_DETAIL_REVEAL"]);expect(validate(value)).toEqual([]);});
  it("keeps Director ownership downstream and legacy planning compatibility-only",()=>{expect(AI_STORY_DIRECTOR_OWNERSHIP_MATRIX.directorMayNotOwn).toContain("exactDialogue");expect(AI_STORY_DIRECTOR_OWNERSHIP_MATRIX.futureDirectorMayOwn).toContain("cameraIntent");const legacy=projectLegacyPlanningToDirectorCompatibility({storyId:I.story,storyVersionId:I.storyVersion,directorThinking:{legacy:true},scenePlan:[],shotPlan:[]});expect(legacy).toMatchObject({kind:"LEGACY_DIRECTOR_INPUT_COMPATIBILITY",canonicalScriptDirectorHandoff:null});expect(resolveDirectorInputAuthority({canonicalHandoff:handoff(),legacyPlanning:legacy}).kind).toBe("CANONICAL_SCRIPT_DIRECTOR_HANDOFF");});
  it("contains no Provider, camera plan, or Motion execution authority",()=>{const serialized=JSON.stringify(handoff()).toLowerCase();for(const forbidden of ["cameraintent","shotpurpose","motionplanner","providerequest","seedance","actionpath"])expect(serialized).not.toContain(forbidden);});
});
