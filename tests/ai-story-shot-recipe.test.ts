import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_SHOT_RECIPE_CONTRACT_VERSION,
  AI_STORY_SHOT_RECIPE_DEFINITIONS,
  AI_STORY_SHOT_RECIPE_PROMPT_LIBRARY,
  AI_STORY_SHOT_RECIPE_QC_GATES,
  AI_STORY_SHOT_RECIPE_SELECTION_REQUIRED,
  AiStoryShotRecipeBindingSchema,
  AiStoryShotRecipeSchema,
  type AiStoryDirectorPlan,
  type AiStoryMotionPlan,
  type AiStoryScriptDirectorHandoff,
} from "@ceo-agent/shared";
import {
  AI_STORY_SHOT_RECIPE_REGISTRY,
  bindAiStoryShotRecipe,
  computeAiStoryShotRecipeFingerprint,
  isAiStoryShotRecipeSelectable,
  suggestAiStoryShotRecipesForSemanticFunction,
  validateAiStoryShotRecipeBindings,
} from "@ceo-agent/shared/server";

const id=(n:number)=>`95000000-0000-4000-8000-${n.toString().padStart(12,"0")}`;
const I={story:id(1),scene:id(2),directorScene:id(3),shot:id(4),action:id(5),product:id(6),actor:id(7)};

function packageFixture(recipeId="DETAIL_REVEAL") {
  const binding=bindAiStoryShotRecipe(recipeId,1,[I.shot]);
  const direction={directorSceneId:I.directorScene,scriptSceneId:I.scene,sceneOrder:0,servedScriptSceneFunction:"PRODUCT_DETAIL_REVEAL",sceneVisualRole:"DETAIL_REVEAL",contextualTreatment:{supportedActionEntryIds:[I.action]},shots:[{directorShotId:I.shot,shotPurpose:"SHOW_DETAIL",shotSize:"MACRO",cameraFamily:"SLOW_PUSH_IN",compositionIntent:"DETAIL_ISOLATION",focusTarget:{kind:"PRODUCT_COMPONENT"},focusProgression:[{kind:"PRODUCT_COMPONENT"}]}],newAudienceInformation:["A distinct detail becomes visible"],servedProductEvidence:["Verified detail"],shotRecipeBinding:binding};
  const director={sceneDirections:[direction]} as unknown as AiStoryDirectorPlan;
  const motionScene={directorSceneId:I.directorScene,scriptSceneId:I.scene,actionExecutions:[{}],motionBudget:{profileId:"CORE",riskFactors:[]},shotRecipeBinding:binding};
  const motion={sceneMotionPlans:[motionScene]} as unknown as AiStoryMotionPlan;
  const handoff={sceneHandoffs:[{scriptSceneId:I.scene,actionEntries:[{entryId:I.action}],newInformation:["Detail"],newEvidence:["Verified detail"],newActionOutcomes:[]}]} as unknown as AiStoryScriptDirectorHandoff;
  return {director,motion,handoff,binding,direction,motionScene};
}

describe("AI Story semantic Shot Recipe Registry",()=>{
  it("materializes a small versioned provider-neutral registry with deterministic fingerprints",()=>{
    expect(AI_STORY_SHOT_RECIPE_REGISTRY.map((recipe)=>recipe.recipeId)).toEqual(["DETAIL_REVEAL","RELATIONSHIP_COVERAGE","USAGE_DEMONSTRATION","CONTEXT_SCALE","REACTION_PAYOFF","HERO_REVEAL"]);
    expect(AI_STORY_SHOT_RECIPE_REGISTRY).toHaveLength(6);
    for(const recipe of AI_STORY_SHOT_RECIPE_REGISTRY){expect(recipe.contractVersion).toBe(AI_STORY_SHOT_RECIPE_CONTRACT_VERSION);expect(recipe.providerNeutral).toBe(true);expect(computeAiStoryShotRecipeFingerprint(recipe)).toMatch(/^sha256:[0-9a-f]{64}$/);}
  });
  it("binds exact immutable recipe version and fingerprint to a Director Shot",()=>{const {binding}=packageFixture();expect(AiStoryShotRecipeBindingSchema.parse(binding)).toEqual(binding);expect(binding.recipeFingerprint).toBe(computeAiStoryShotRecipeFingerprint(AI_STORY_SHOT_RECIPE_REGISTRY[0]!));});
  it("validates Director, evidence, Motion, profile and semantic constraints without rewriting authority",()=>{const value=packageFixture();expect(validateAiStoryShotRecipeBindings(value.director,value.motion,value.handoff)).toEqual([]);expect(value.direction.servedScriptSceneFunction).toBe("PRODUCT_DETAIL_REVEAL");expect(value.direction.sceneVisualRole).toBe("DETAIL_REVEAL");});
  it("hard-blocks missing/version/fingerprint and Motion substitution deterministically",()=>{const missing=packageFixture();missing.direction.shotRecipeBinding={...missing.binding,recipeId:"EXT:example.test:UNKNOWN"};expect(validateAiStoryShotRecipeBindings(missing.director,missing.motion,missing.handoff).some((issue)=>issue.gate==="RECIPE_EXISTS_GATE")).toBe(true);const version=packageFixture();version.direction.shotRecipeBinding={...version.binding,recipeVersion:99};expect(validateAiStoryShotRecipeBindings(version.director,version.motion,version.handoff).some((issue)=>issue.gate==="RECIPE_VERSION_GATE")).toBe(true);const fingerprint=packageFixture();fingerprint.direction.shotRecipeBinding={...fingerprint.binding,recipeFingerprint:`sha256:${"0".repeat(64)}`};expect(validateAiStoryShotRecipeBindings(fingerprint.director,fingerprint.motion,fingerprint.handoff).some((issue)=>issue.gate==="RECIPE_FINGERPRINT_GATE")).toBe(true);const motion=packageFixture();delete (motion.motionScene as {shotRecipeBinding?:unknown}).shotRecipeBinding;expect(validateAiStoryShotRecipeBindings(motion.director,motion.motion,motion.handoff).some((issue)=>issue.gate==="RECIPE_MOTION_COMPATIBILITY_GATE"&&issue.repairOwner==="MOTION")).toBe(true);});
  it("blocks incompatible semantics and missing evidence at the earliest owner",()=>{const visual=packageFixture();visual.direction.sceneVisualRole="HERO_INTRODUCTION";expect(validateAiStoryShotRecipeBindings(visual.director,visual.motion,visual.handoff).some((issue)=>issue.gate==="RECIPE_DIRECTOR_COMPATIBILITY_GATE"&&issue.repairOwner==="DIRECTOR")).toBe(true);const evidence=packageFixture();evidence.direction.servedProductEvidence=[];evidence.direction.shots[0]!.focusTarget.kind="PRODUCT";evidence.direction.shots[0]!.focusProgression=[{kind:"PRODUCT"}];expect(validateAiStoryShotRecipeBindings(evidence.director,evidence.motion,evidence.handoff).some((issue)=>issue.gate==="RECIPE_EVIDENCE_GATE"&&issue.repairOwner==="SCRIPT")).toBe(true);});
  it("supports flexible Shot Size/Camera recommendations as warnings rather than creative hard law",()=>{const value=packageFixture();value.direction.shots[0]!.shotSize="WIDE";value.direction.shots[0]!.cameraFamily="HANDHELD";expect(validateAiStoryShotRecipeBindings(value.director,value.motion,value.handoff)).toContainEqual(expect.objectContaining({gate:"RECIPE_DIRECTOR_COMPATIBILITY_GATE",severity:"WARN",reasonCode:"RECIPE_RECOMMENDATION_DEVIATION"}));});
  it("keeps recipe selection optional and unmatched valid Scenes allowed",()=>{const value=packageFixture();delete (value.direction as {shotRecipeBinding?:unknown}).shotRecipeBinding;delete (value.motionScene as {shotRecipeBinding?:unknown}).shotRecipeBinding;expect(AI_STORY_SHOT_RECIPE_SELECTION_REQUIRED).toBe(false);expect(validateAiStoryShotRecipeBindings(value.director,value.motion,value.handoff)).toEqual([]);});
  it.each(["flower detail","shoe material","food texture","accessory stitching","furniture finish","unknown synthetic component"])('generalizes DETAIL_REVEAL semantics across Products: %s',()=>{expect(validateAiStoryShotRecipeBindings(packageFixture().director,packageFixture().motion,packageFixture().handoff)).toEqual([]);});
  it("selects by semantic purpose without requiring Product category or known context",()=>{expect(suggestAiStoryShotRecipesForSemanticFunction("DETAIL_REVEAL")).toEqual(expect.arrayContaining([expect.objectContaining({recipeId:"DETAIL_REVEAL"})]));expect(packageFixture().direction).not.toHaveProperty("productCategory");expect(packageFixture().direction).not.toHaveProperty("allowedContexts");});
  it("does not automatically block repeated recipe identity and warns on valid repeated dimensions",()=>{const first=packageFixture(),second=packageFixture();second.direction.directorSceneId=id(20);second.direction.scriptSceneId=id(21);second.direction.sceneOrder=1;second.direction.shotRecipeBinding={...second.binding,selectedShotIds:[I.shot]};second.motionScene.directorSceneId=id(20);second.motionScene.scriptSceneId=id(21);const director={sceneDirections:[first.direction,second.direction]} as unknown as AiStoryDirectorPlan;const motion={sceneMotionPlans:[first.motionScene,second.motionScene]} as unknown as AiStoryMotionPlan;const handoff={sceneHandoffs:[...(first.handoff as any).sceneHandoffs,{...(first.handoff as any).sceneHandoffs[0],scriptSceneId:id(21)}]} as AiStoryScriptDirectorHandoff;expect(validateAiStoryShotRecipeBindings(director,motion,handoff)).toContainEqual(expect.objectContaining({severity:"WARN",reasonCode:"RECIPE_REPETITION_WITH_VALID_DELTA"}));});
  it("supports ACTIVE, DEPRECATED and RETIRED historical lifecycle without reinterpreting versions",()=>{const active=AI_STORY_SHOT_RECIPE_REGISTRY[0]!;const deprecated=AiStoryShotRecipeSchema.parse({...active,status:"DEPRECATED",deprecatedAt:"2026-08-29T00:00:00.000Z"});const retired=AiStoryShotRecipeSchema.parse({...active,status:"RETIRED",deprecatedAt:"2026-08-29T00:00:00.000Z"});expect(isAiStoryShotRecipeSelectable(deprecated)).toBe(true);expect(isAiStoryShotRecipeSelectable(retired)).toBe(false);expect(isAiStoryShotRecipeSelectable(retired,{historical:true})).toBe(true);});
  it("defines the complete ordered recipe QC sub-gate suite",()=>{expect(AI_STORY_SHOT_RECIPE_QC_GATES).toEqual(["RECIPE_EXISTS_GATE","RECIPE_VERSION_GATE","RECIPE_FINGERPRINT_GATE","RECIPE_DIRECTOR_COMPATIBILITY_GATE","RECIPE_EVIDENCE_GATE","RECIPE_MOTION_COMPATIBILITY_GATE","RECIPE_CONSTRAINT_GATE"]);});
  it("contains no Provider prompt library, Product category policy, or market formula",()=>{expect(AI_STORY_SHOT_RECIPE_PROMPT_LIBRARY).toBe(false);const source=["packages/shared/src/ai-story-shot-recipe.ts","packages/shared/src/ai-story-shot-recipe.server.ts"].map((path)=>readFileSync(path,"utf8").toLowerCase()).join("\n");for(const forbidden of ["flower_hero_recipe","shoe_tracking_recipe","cake_macro_recipe","provider prompt","negative prompt","seedance","tiktok viral","xiaohongshu","luxury flower"])expect(source).not.toContain(forbidden);expect(AI_STORY_SHOT_RECIPE_DEFINITIONS.every((recipe)=>!("productCategory" in recipe))).toBe(true);});
});
