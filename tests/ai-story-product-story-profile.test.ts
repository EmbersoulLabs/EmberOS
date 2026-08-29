import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_PRODUCT_STORY_PROFILE_ID,
  AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
  buildAiStoryProductStoryWriterGuidance,
  type AiStoryOutlineVersion,
  type AiStoryScriptVersion,
} from "@ceo-agent/shared";
import {
  buildAiStoryOutlineVersion,
  buildAiStoryScriptVersion,
  computeAiStoryProductStoryProfilePolicyFingerprint,
  validateAiStoryProductStoryProfile,
} from "@ceo-agent/shared/server";
import { resolveAiStoryWriterProfileGuidance } from "../packages/agents/src/ai-story/product-story-writer-profile";

const id = (n: number) => `85000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const I = { org:id(1), workspace:id(2), story:id(3), storyVersion:id(4), unit:id(5), beatA:id(6), beatB:id(7), sceneA:id(8), sceneB:id(9), entryA:id(10), entryB:id(11), actor:id(12), character:id(13), product:id(14), goalA:id(15), goalB:id(16), outcome:id(17), claim:id(18) };
const frozen = <T extends {status:string;approvedBy:string|null;approvedAt:string|null;frozenAt:string|null}>(value:T):T => ({...value,status:"FROZEN",approvedBy:I.actor,approvedAt:"2026-08-29T06:00:00.000Z",frozenAt:"2026-08-29T06:01:00.000Z"});

function outline(objective:"awareness"|"engagement"|"sales"|"lead_generation"|"other"="awareness"):AiStoryOutlineVersion {
  return frozen(buildAiStoryOutlineVersion({
    storyId:I.story,storyVersionId:I.storyVersion,orgId:I.org,workspaceId:I.workspace,version:1,
    profile:{profileId:AI_STORY_PRODUCT_STORY_PROFILE_ID,profileVersion:1,policyFingerprint:AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT},
    productStoryProfile:{campaignObjective:objective,customObjective:objective==="other"?"Teach an unfamiliar use":null,productAuthorityIds:[I.product],progressionGoals:[
      {goalId:I.goalA,semanticFunction:"PRODUCT_INTRODUCTION",required:true,beatIds:[I.beatA],requiredSceneOutcomeIds:[],intent:"Establish canonical Product identity"},
      {goalId:I.goalB,semanticFunction:"PRODUCT_EVIDENCE",required:true,beatIds:[I.beatB],requiredSceneOutcomeIds:[I.outcome],intent:"Provide distinct Product evidence"},
    ],claimEvidence:[{claimId:I.claim,claimType:"BENEFIT_CLAIM",claim:"The verified feature supports the stated benefit",productAuthorityId:I.product,authorityFactRefs:["asset.metadata.verifiedFeature"],evidenceBeatIds:[I.beatB],evidenceSceneOutcomeIds:[I.outcome]}],ctaPolicy:objective==="sales"||objective==="lead_generation"?"REQUIRED":"OPTIONAL",packshotPolicy:"OPTIONAL",userCreativeIntent:["Keep the relationship warm and observational"]},
    premise:"Product evidence changes audience understanding",coreClaim:"A verified Product fact earns trust",storyUnits:[{storyUnitId:I.unit,order:0,purpose:"Complete commercial story",summary:"Introduce authority and provide evidence",requiredBeatIds:[I.beatA,I.beatB]}],
    beats:[
      {id:I.beatA,storyUnitId:I.unit,order:0,classification:"MAJOR",name:"Introduction",purpose:"Establish Product",summary:"Canonical Product identity becomes clear",required:true,ownershipPolicy:"EXCLUSIVE",authorityReferences:[{authorityType:"PRODUCT",authorityId:I.product}]},
      {id:I.beatB,storyUnitId:I.unit,order:1,classification:"MAJOR",name:"Evidence",purpose:"Prove Product claim",summary:"A verified feature supports the benefit",required:true,ownershipPolicy:"EXCLUSIVE",authorityReferences:[{authorityType:"PRODUCT",authorityId:I.product}]},
    ],hooks:[],setupPayoffs:[],requiredSceneOutcomes:[{outcomeId:I.outcome,order:0,outcomeType:"DELIVER_PRODUCT_EVIDENCE",description:"Deliver verified Product evidence",beatIds:[I.beatB],authorityReferences:[{authorityType:"PRODUCT",authorityId:I.product}]}],authorityReferences:[{authorityType:"PRODUCT",authorityId:I.product}],upstreamAuthorityId:`campaign:${I.storyVersion}`,supersedesOutlineVersionId:null,createdBy:I.actor,createdAt:"2026-08-29T05:00:00.000Z",
  }));
}

function script(source=outline()):AiStoryScriptVersion {
  const scene=(second=false)=>({
    scriptSceneId:second?I.sceneB:I.sceneA,order:second?1:0,outlineBeatClaims:[{outlineBeatId:second?I.beatB:I.beatA,claim:second?"Serve evidence":"Introduce Product"}],sceneFunction:second?"PRODUCT_DETAIL_REVEAL":"PRODUCT_INTRODUCTION" as const,sceneFunctionRegistryVersion:1 as const,
    sceneStateIn:[],sceneStateDeltas:[],sceneStateOut:[],entries:[{entryId:second?I.entryB:I.entryA,order:0,type:"ACTION" as const,subjectId:I.character,objectId:I.product,action:second?"Character reveals the verified feature.":"Character presents the canonical Product.",storyEffect:second?"Evidence becomes clear":"Product identity becomes clear",durationRange:{minSeconds:2,maxSeconds:4}}],characterIds:[I.character],locationIds:[],propIds:[],assetIds:[I.product],productAuthorityRefs:[I.product],targetDurationRange:{minSeconds:3,maxSeconds:7},mustKeep:["Product identity"],mustAvoid:["Unsupported claims"],newInformation:[second?"A verified feature is understood":"Canonical Product identity is understood"],newEvidence:second?["Verified feature"]:[],newActionOutcomes:[second?"Evidence is demonstrated":"Product is introduced"],productEvidence:second?["Verified feature"]:[],productStoryContributions:[{semanticFunction:second?"PRODUCT_EVIDENCE":"PRODUCT_INTRODUCTION",contributionTypes:[second?"NEW_PRODUCT_EVIDENCE":"NEW_PRODUCT_INFORMATION"],productAuthorityIds:[I.product],claimIds:second?[I.claim]:[],summary:second?"Verified evidence supports a benefit":"Product identity is introduced"}],
  });
  return frozen(buildAiStoryScriptVersion({storyId:I.story,storyVersionId:I.storyVersion,outlineVersionId:source.outlineVersionId,orgId:I.org,workspaceId:I.workspace,version:1,profileId:"PRODUCT_STORY",profileVersion:1,outlineSourceHash:source.sourceHash,scenes:[scene(false),scene(true)],authorityReferences:[{authorityType:"CHARACTER",authorityId:I.character},{authorityType:"PRODUCT",authorityId:I.product},{authorityType:"ASSET",authorityId:I.product}],supersedesScriptVersionId:null,createdBy:I.actor,createdAt:"2026-08-29T05:10:00.000Z"}));
}

const blocks=(o=outline(),s=script(o))=>validateAiStoryProductStoryProfile(o,s).filter((issue)=>issue.severity==="BLOCK");
const generalized=(semanticFunction:string)=>{const o=outline("other");o.productStoryProfile!.claimEvidence=[];o.productStoryProfile!.progressionGoals[1]!.semanticFunction=semanticFunction;const s=script(o);s.scenes[1]!.productStoryContributions![0]!.semanticFunction=semanticFunction;s.scenes[1]!.productStoryContributions![0]!.claimIds=[];return blocks(o,s);};

describe("AI Story PRODUCT_STORY Writer profile",()=>{
  it("binds a versioned immutable policy fingerprint and objective-aware Writer guidance",()=>{const o=outline();expect(computeAiStoryProductStoryProfilePolicyFingerprint()).toBe(AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT);expect(o.profile).toMatchObject({profileId:"PRODUCT_STORY",profileVersion:1,policyFingerprint:AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT});expect(buildAiStoryProductStoryWriterGuidance(o.productStoryProfile!).userCreativeIntent).toEqual(["Keep the relationship warm and observational"]);expect(resolveAiStoryWriterProfileGuidance(o)).toMatchObject({kind:"PRODUCT_STORY",objective:"awareness",ctaPolicy:"OPTIONAL"});expect(blocks(o,script(o))).toEqual([]);});
  it("blocks repeated hero-only treatment without a Product delta but allows distinct legitimate functions",()=>{const o=outline();const s=script(o);s.scenes[1]!.productStoryContributions=[{semanticFunction:"PRODUCT_INTRODUCTION",contributionTypes:["NEW_PRODUCT_INFORMATION"],productAuthorityIds:[I.product],claimIds:[],summary:"Repeat hero display"}];s.scenes[1]!.newInformation=[];s.scenes[1]!.newEvidence=[];s.scenes[1]!.newActionOutcomes=[];s.scenes[1]!.productEvidence=[];expect(validateAiStoryProductStoryProfile(o,s)).toEqual(expect.arrayContaining([expect.objectContaining({gate:"REPEATED_HERO_ONLY_GATE",severity:"BLOCK"})]));expect(blocks()).toEqual([]);});
  it("requires objective-aware CTA only for current conversion objectives",()=>{const awareness=outline("awareness");expect(validateAiStoryProductStoryProfile(awareness,script(awareness)).some(i=>i.reasonCode.includes("CTA"))).toBe(false);const sales=outline("sales");sales.productStoryProfile!.ctaPolicy="OPTIONAL";expect(validateAiStoryProductStoryProfile(sales,script(sales))).toEqual(expect.arrayContaining([expect.objectContaining({reasonCode:"OBJECTIVE_CTA_REQUIREMENT_MISSING"})]));});
  it("denies unsupported claims and requires important benefit proof to be served",()=>{const o=outline();o.productStoryProfile!.claimEvidence[0]!.productAuthorityId=id(99);expect(validateAiStoryProductStoryProfile(o,script(o))).toEqual(expect.arrayContaining([expect.objectContaining({reasonCode:"UNSUPPORTED_PRODUCT_CLAIM"})]));const valid=outline();const s=script(valid);s.scenes[1]!.productStoryContributions![0]!.claimIds=[];expect(validateAiStoryProductStoryProfile(valid,s)).toEqual(expect.arrayContaining([expect.objectContaining({reasonCode:"BENEFIT_PROOF_UNSERVED"})]));});
  it("does not impose a fixed Scene count or order formula",()=>{const o=outline();const s=script(o);s.scenes=[{...s.scenes[0]!,outlineBeatClaims:[{outlineBeatId:I.beatA,claim:"Introduce"},{outlineBeatId:I.beatB,claim:"Prove"}],productStoryContributions:[...s.scenes[0]!.productStoryContributions!,...s.scenes[1]!.productStoryContributions!]}];expect(validateAiStoryProductStoryProfile(o,s).filter(i=>i.gate==="PRODUCT_INFORMATION_PROGRESSION_GATE"||i.gate==="REPEATED_HERO_ONLY_GATE")).toEqual([]);});
  it.each([
    ["flowers / gifting / reaction","PRODUCT_RELATIONSHIP"],
    ["shoes / wearing / movement","PRODUCT_USAGE"],
    ["food / serving / texture","PRODUCT_EVIDENCE"],
    ["bag / carrying / capacity context","PRODUCT_CONTEXT"],
    ["furniture / usage / scale","PRODUCT_USAGE"],
    ["unknown synthetic Product","EXT:example.unknown:CONTEXTUAL_PROOF"],
  ])("generalizes without Product-category policy: %s",(_fixture,semanticFunction)=>expect(generalized(semanticFunction)).toEqual([]));
  it("accepts an unfamiliar namespaced semantic function without an action allowlist",()=>expect(generalized("EXT:example.future:PRODUCT_TRANSFORMATION_CONTEXT")).toEqual([]));
  it("preserves Core as generic and contains no category/template/Provider policy",()=>{const source=readFileSync("packages/shared/src/ai-story-product-story-profile.server.ts","utf8").toLowerCase();for(const forbidden of ["scene 1", "scene 2", "flowers", "shoes", "food", "bag", "furniture", "allowedproduct", "seedance", "provider request"])expect(source).not.toContain(forbidden);});
});
