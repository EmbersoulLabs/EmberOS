import { sha256CanonicalIntegrityHash } from "./canonical-integrity";
import type { AiStoryDirectorPlan, AiStoryDirectorSceneDirection } from "./ai-story-director-plan";
import type { AiStoryMotionPlan, AiStorySceneMotionPlan } from "./ai-story-motion-plan";
import type { AiStoryScriptDirectorHandoff } from "./ai-story-script-director-handoff";
import {
  AI_STORY_SHOT_RECIPE_CONTRACT_VERSION, AI_STORY_SHOT_RECIPE_DEFINITIONS, AI_STORY_SHOT_RECIPE_REGISTRY_VERSION,
  AI_STORY_SHOT_RECIPE_QC_GATES, AiStoryShotRecipeSchema, type AiStoryShotRecipe, type AiStoryShotRecipeQcGate,
} from "./ai-story-shot-recipe";

export type AiStoryShotRecipeIssue = { gate: AiStoryShotRecipeQcGate; severity: "BLOCK" | "WARN"; reasonCode: string; message: string; repairOwner: "SCRIPT" | "DIRECTOR" | "MOTION" };

const materialize = (definition: typeof AI_STORY_SHOT_RECIPE_DEFINITIONS[number]): AiStoryShotRecipe => AiStoryShotRecipeSchema.parse({
  ...definition, version: 1, contractVersion: AI_STORY_SHOT_RECIPE_CONTRACT_VERSION,
  registryVersion: AI_STORY_SHOT_RECIPE_REGISTRY_VERSION, status: "ACTIVE", providerNeutral: true, deprecatedAt: null,
});

export const AI_STORY_SHOT_RECIPE_REGISTRY = Object.freeze(AI_STORY_SHOT_RECIPE_DEFINITIONS.map(materialize));

export function computeAiStoryShotRecipeFingerprint(recipe: AiStoryShotRecipe) {
  return sha256CanonicalIntegrityHash(recipe);
}

export function getAiStoryShotRecipe(recipeId: string, version: number) {
  return AI_STORY_SHOT_RECIPE_REGISTRY.find((recipe) => recipe.recipeId === recipeId && recipe.version === version) ?? null;
}

export function isAiStoryShotRecipeSelectable(recipe: AiStoryShotRecipe, options: { historical?: boolean } = {}) {
  return recipe.status !== "RETIRED" || options.historical === true;
}

export function bindAiStoryShotRecipe(recipeId: string, version: number, selectedShotIds: string[]) {
  const recipe = getAiStoryShotRecipe(recipeId, version);
  if (!recipe || !isAiStoryShotRecipeSelectable(recipe)) throw new Error("SHOT_RECIPE_NOT_SELECTABLE");
  return { recipeId, recipeVersion: version, recipeFingerprint: computeAiStoryShotRecipeFingerprint(recipe), selectedShotIds };
}

export function suggestAiStoryShotRecipesForSemanticFunction(semanticFunction: string) {
  const semantic = semanticFunction.toUpperCase();
  return AI_STORY_SHOT_RECIPE_REGISTRY.filter((recipe) => recipe.status === "ACTIVE" && (
    recipe.semanticPurpose === semantic || recipe.compatibleVisualRoles.includes(semantic as never) || recipe.compatibleShotPurposes.includes(semantic as never)
  )).map((recipe) => ({ recipeId: recipe.recipeId, version: recipe.version, recipeFingerprint: computeAiStoryShotRecipeFingerprint(recipe) }));
}

const complexity = { LOW: 1, MEDIUM: 2, HIGH: 3 } as const;
const actualMotionComplexity = (motion: AiStorySceneMotionPlan) => motion.motionBudget.riskFactors.length >= 3 ? "HIGH" : motion.motionBudget.riskFactors.length ? "MEDIUM" : "LOW";

function evidenceSatisfied(recipe: AiStoryShotRecipe, scene: AiStoryDirectorSceneDirection, motion: AiStorySceneMotionPlan | undefined, handoff: AiStoryScriptDirectorHandoff) {
  const source = handoff.sceneHandoffs.find((item) => item.scriptSceneId === scene.scriptSceneId);
  if (!source) return false;
  return recipe.requiredEvidence.every((requirement) => {
    if (requirement === "DETAIL_TARGET") return scene.servedProductEvidence.length > 0 || scene.shots.some((shot) => [shot.focusTarget, ...shot.focusProgression].some((focus) => focus.kind === "PRODUCT_COMPONENT" || focus.kind === "EVIDENCE_DETAIL"));
    if (requirement === "SCRIPT_ACTION") return source.actionEntries.length > 0 && scene.contextualTreatment.supportedActionEntryIds.length > 0 && Boolean(motion?.actionExecutions.length);
    if (requirement === "REACTION_OR_CONSEQUENCE") return source.newInformation.length > 0 || source.newEvidence.length > 0 || source.newActionOutcomes.length > 0 || scene.shots.some((shot) => [shot.focusTarget, ...shot.focusProgression].some((focus) => focus.kind === "REACTION" || focus.kind === "ACTION_CONSEQUENCE"));
    return scene.newAudienceInformation.length > 0 && scene.shots.some((shot) => shot.focusTarget.kind === "ENVIRONMENT" || shot.shotPurpose === "SHOW_SCALE" || shot.shotPurpose === "SHOW_ENVIRONMENT");
  });
}

export function validateAiStoryShotRecipeBindings(
  director: AiStoryDirectorPlan,
  motion: AiStoryMotionPlan,
  handoff: AiStoryScriptDirectorHandoff,
  options: { allowHistoricalRetired?: boolean } = {},
): AiStoryShotRecipeIssue[] {
  const issues: AiStoryShotRecipeIssue[] = [];
  const add = (gate: AiStoryShotRecipeQcGate, severity: "BLOCK" | "WARN", reasonCode: string, message: string, repairOwner: AiStoryShotRecipeIssue["repairOwner"]) => issues.push({ gate, severity, reasonCode, message, repairOwner });
  for (const scene of director.sceneDirections) {
    const binding = scene.shotRecipeBinding;
    const sceneMotion = motion.sceneMotionPlans.find((item) => item.directorSceneId === scene.directorSceneId);
    if (!binding) {
      if (sceneMotion?.shotRecipeBinding) add("RECIPE_DIRECTOR_COMPATIBILITY_GATE", "BLOCK", "MOTION_INVENTED_RECIPE", `Motion introduced a Recipe for Scene ${scene.scriptSceneId}`, "MOTION");
      continue;
    }
    const sameId = AI_STORY_SHOT_RECIPE_REGISTRY.filter((recipe) => recipe.recipeId === binding.recipeId);
    if (!sameId.length) { add("RECIPE_EXISTS_GATE", "BLOCK", "RECIPE_NOT_FOUND", `Recipe ${binding.recipeId} is not registered`, "DIRECTOR"); continue; }
    const recipe = sameId.find((item) => item.version === binding.recipeVersion);
    if (!recipe) { add("RECIPE_VERSION_GATE", "BLOCK", "RECIPE_VERSION_NOT_FOUND", `Recipe ${binding.recipeId} version ${binding.recipeVersion} is not registered`, "DIRECTOR"); continue; }
    if (recipe.status === "RETIRED" && !options.allowHistoricalRetired) add("RECIPE_VERSION_GATE", "BLOCK", "RETIRED_RECIPE_NOT_SELECTABLE", `Retired Recipe ${binding.recipeId} cannot be selected for new authority`, "DIRECTOR");
    if (binding.recipeFingerprint !== computeAiStoryShotRecipeFingerprint(recipe)) add("RECIPE_FINGERPRINT_GATE", "BLOCK", "RECIPE_FINGERPRINT_MISMATCH", `Recipe fingerprint mismatch for ${binding.recipeId}`, "DIRECTOR");
    const shotIds = new Set(scene.shots.map((shot) => shot.directorShotId));
    if (new Set(binding.selectedShotIds).size !== binding.selectedShotIds.length || binding.selectedShotIds.some((id) => !shotIds.has(id))) add("RECIPE_DIRECTOR_COMPATIBILITY_GATE", "BLOCK", "RECIPE_SHOT_BINDING_INVALID", `Recipe ${binding.recipeId} references an unknown or duplicate Director Shot`, "DIRECTOR");
    const selected = scene.shots.filter((shot) => binding.selectedShotIds.includes(shot.directorShotId));
    if (!recipe.compatibleVisualRoles.includes(scene.sceneVisualRole as never) || selected.some((shot) => !recipe.compatibleShotPurposes.includes(shot.shotPurpose as never))) add("RECIPE_DIRECTOR_COMPATIBILITY_GATE", "BLOCK", "RECIPE_DIRECTOR_INCOMPATIBLE", `Recipe ${binding.recipeId} is incompatible with the selected Director semantics`, "DIRECTOR");
    if (selected.some((shot) => shot.productEmphasis && recipe.productEmphasisCompatibility.length > 0 && !recipe.productEmphasisCompatibility.includes(shot.productEmphasis as never))) add("RECIPE_DIRECTOR_COMPATIBILITY_GATE", "BLOCK", "RECIPE_PRODUCT_EMPHASIS_INCOMPATIBLE", `Recipe ${binding.recipeId} is incompatible with the selected Product emphasis`, "DIRECTOR");
    if (!recipe.profileCompatibility.includes(sceneMotion?.motionBudget.profileId as never)) add("RECIPE_DIRECTOR_COMPATIBILITY_GATE", "BLOCK", "RECIPE_PROFILE_INCOMPATIBLE", `Recipe ${binding.recipeId} is incompatible with profile ${sceneMotion?.motionBudget.profileId ?? "UNKNOWN"}`, "DIRECTOR");
    if (!evidenceSatisfied(recipe, scene, sceneMotion, handoff)) add("RECIPE_EVIDENCE_GATE", "BLOCK", "RECIPE_EVIDENCE_MISSING", `Recipe ${binding.recipeId} lacks its required canonical evidence`, "SCRIPT");
    if (!sceneMotion?.shotRecipeBinding || JSON.stringify(sceneMotion.shotRecipeBinding) !== JSON.stringify(binding)) add("RECIPE_MOTION_COMPATIBILITY_GATE", "BLOCK", "MOTION_RECIPE_BINDING_MISMATCH", `Motion did not preserve Recipe ${binding.recipeId}`, "MOTION");
    if (sceneMotion && complexity[actualMotionComplexity(sceneMotion)] > complexity[recipe.motionComplexityClass]) add("RECIPE_MOTION_COMPATIBILITY_GATE", "BLOCK", "RECIPE_MOTION_COMPLEXITY_EXCEEDED", `Motion exceeds Recipe ${binding.recipeId} complexity class`, "MOTION");
    if (sceneMotion && recipe.mustAvoid.some((constraint) => sceneMotion.motionBudget.riskFactors.includes(constraint as never))) add("RECIPE_CONSTRAINT_GATE", "BLOCK", "RECIPE_MUST_AVOID_VIOLATED", `Motion violates a mustAvoid constraint for Recipe ${binding.recipeId}`, "MOTION");
    const sizeMismatch = selected.every((shot) => !recipe.recommendedShotSizes.includes(shot.shotSize as never));
    const cameraMismatch = selected.every((shot) => !recipe.cameraFamilies.includes(shot.cameraFamily as never));
    const compositionMismatch = selected.every((shot) => !recipe.compositionPatterns.includes(shot.compositionIntent as never));
    if (sizeMismatch || cameraMismatch || compositionMismatch) add("RECIPE_DIRECTOR_COMPATIBILITY_GATE", "WARN", "RECIPE_RECOMMENDATION_DEVIATION", `Director uses a valid custom Shot Size, Camera Family, or Composition outside Recipe ${binding.recipeId} recommendations`, "DIRECTOR");
  }
  for (let index = 1; index < director.sceneDirections.length; index += 1) {
    const current = director.sceneDirections[index]!;
    if (!current.shotRecipeBinding) continue;
    for (const previous of director.sceneDirections.slice(0, index)) {
      if (previous.shotRecipeBinding?.recipeId !== current.shotRecipeBinding.recipeId || previous.shotRecipeBinding.recipeVersion !== current.shotRecipeBinding.recipeVersion) continue;
      const repeatedDimensions = previous.sceneVisualRole === current.sceneVisualRole
        && previous.shots[0]?.shotPurpose === current.shots[0]?.shotPurpose
        && previous.shots[0]?.cameraFamily === current.shots[0]?.cameraFamily
        && previous.shots[0]?.focusTarget.kind === current.shots[0]?.focusTarget.kind;
      const certifiedDelta = current.newAudienceInformation.length > 0 || current.servedProductEvidence.length > 0;
      if (repeatedDimensions && certifiedDelta) add("RECIPE_DIRECTOR_COMPATIBILITY_GATE", "WARN", "RECIPE_REPETITION_WITH_VALID_DELTA", `Recipe ${current.shotRecipeBinding.recipeId} repeats visual dimensions but carries new canonical information`, "DIRECTOR");
    }
  }
  return issues;
}

export const AI_STORY_SHOT_RECIPE_TELEMETRY_DIMENSIONS = Object.freeze([
  "recipeId", "recipeVersion", "profileId", "sceneFunction", "visualRole", "cameraFamily", "provider",
  "humanReviewResult", "retryReason", "cost", "approvalRate",
] as const);
