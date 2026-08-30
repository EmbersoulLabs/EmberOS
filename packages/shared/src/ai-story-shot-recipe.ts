import { z } from "zod";

export const AI_STORY_SHOT_RECIPE_CONTRACT_VERSION = "ai-story-shot-recipe.v1" as const;
export const AI_STORY_SHOT_RECIPE_REGISTRY_VERSION = 1 as const;
export const AI_STORY_SHOT_RECIPE_STATUSES = ["ACTIVE", "DEPRECATED", "RETIRED"] as const;
export const AI_STORY_SHOT_RECIPE_MOTION_COMPLEXITY = ["LOW", "MEDIUM", "HIGH"] as const;
export const AI_STORY_SHOT_RECIPE_PROFILES = ["CORE", "PRODUCT_STORY"] as const;
export const AI_STORY_SHOT_RECIPE_REQUIRED_EVIDENCE = ["DETAIL_TARGET", "SCRIPT_ACTION", "REACTION_OR_CONSEQUENCE", "CONTEXT_OR_SCALE"] as const;
export const AI_STORY_SHOT_RECIPE_QC_GATES = [
  "RECIPE_EXISTS_GATE", "RECIPE_VERSION_GATE", "RECIPE_FINGERPRINT_GATE", "RECIPE_DIRECTOR_COMPATIBILITY_GATE",
  "RECIPE_EVIDENCE_GATE", "RECIPE_MOTION_COMPATIBILITY_GATE", "RECIPE_CONSTRAINT_GATE",
] as const;

const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const SemanticId = z.string().regex(/^(?:[A-Z][A-Z0-9_]{1,63}|EXT:[a-z0-9.-]+:[A-Z][A-Z0-9_]{1,63})$/);
const Text = z.string().trim().min(1).max(500);

export const AiStoryShotRecipeBindingSchema = z.object({
  recipeId: SemanticId,
  recipeVersion: z.number().int().positive(),
  recipeFingerprint: Hash,
  selectedShotIds: z.array(z.string().uuid()).min(1),
}).strict();

export const AiStoryShotRecipeSchema = z.object({
  recipeId: SemanticId,
  version: z.number().int().positive(),
  contractVersion: z.literal(AI_STORY_SHOT_RECIPE_CONTRACT_VERSION),
  registryVersion: z.literal(AI_STORY_SHOT_RECIPE_REGISTRY_VERSION),
  status: z.enum(AI_STORY_SHOT_RECIPE_STATUSES),
  semanticPurpose: SemanticId,
  compatibleVisualRoles: z.array(SemanticId).min(1),
  compatibleShotPurposes: z.array(SemanticId).min(1),
  recommendedShotSizes: z.array(SemanticId).min(1),
  cameraFamilies: z.array(SemanticId).min(1),
  focusPattern: z.object({ mode: z.enum(["SINGLE", "PROGRESSIVE"]), semanticSteps: z.array(SemanticId).min(1) }).strict(),
  compositionPatterns: z.array(SemanticId).min(1),
  blockingPattern: z.object({ level: z.literal("HIGH_LEVEL_ONLY"), semanticIntent: Text }).strict(),
  productEmphasisCompatibility: z.array(SemanticId),
  motionComplexityClass: z.enum(AI_STORY_SHOT_RECIPE_MOTION_COMPLEXITY),
  requiredEvidence: z.array(z.enum(AI_STORY_SHOT_RECIPE_REQUIRED_EVIDENCE)),
  constraints: z.array(SemanticId),
  mustAvoid: z.array(SemanticId),
  profileCompatibility: z.array(z.enum(AI_STORY_SHOT_RECIPE_PROFILES)).min(1),
  providerNeutral: z.literal(true),
  deprecatedAt: z.string().datetime().nullable(),
}).strict();

export type AiStoryShotRecipe = z.infer<typeof AiStoryShotRecipeSchema>;
export type AiStoryShotRecipeBinding = z.infer<typeof AiStoryShotRecipeBindingSchema>;
export type AiStoryShotRecipeQcGate = typeof AI_STORY_SHOT_RECIPE_QC_GATES[number];

export const AI_STORY_SHOT_RECIPE_DEFINITIONS = Object.freeze([
  {
    recipeId: "DETAIL_REVEAL", semanticPurpose: "DETAIL_REVEAL",
    compatibleVisualRoles: ["DETAIL_REVEAL", "TEXTURE_MACRO"], compatibleShotPurposes: ["SHOW_DETAIL", "SHOW_EVIDENCE"],
    recommendedShotSizes: ["CLOSE", "EXTREME_CLOSE", "MACRO"], cameraFamilies: ["LOCKED", "SLOW_PUSH_IN", "MINOR_LATERAL_DOLLY", "RACK_FOCUS"],
    focusPattern: { mode: "PROGRESSIVE", semanticSteps: ["EVIDENCE_TARGET", "DETAIL_DISCLOSURE"] }, compositionPatterns: ["DETAIL_ISOLATION", "PRODUCT_DOMINANT"],
    blockingPattern: { level: "HIGH_LEVEL_ONLY", semanticIntent: "Keep the evidence target readable throughout the reveal" }, productEmphasisCompatibility: ["DETAIL_EVIDENCE"],
    motionComplexityClass: "MEDIUM", requiredEvidence: ["DETAIL_TARGET"], constraints: ["EVIDENCE_TARGET_RESOLVES"], mustAvoid: ["EXCESSIVE_CAMERA_MOTION"], profileCompatibility: ["CORE", "PRODUCT_STORY"],
  },
  {
    recipeId: "RELATIONSHIP_COVERAGE", semanticPurpose: "RELATIONSHIP_COVERAGE",
    compatibleVisualRoles: ["RELATIONSHIP", "REACTION"], compatibleShotPurposes: ["SHOW_RELATIONSHIP", "SHOW_REACTION", "SHOW_ACTION"],
    recommendedShotSizes: ["WIDE", "MEDIUM", "MEDIUM_CLOSE"], cameraFamilies: ["LOCKED", "MINOR_LATERAL_DOLLY", "GENTLE_PARALLAX", "TRACKING"],
    focusPattern: { mode: "PROGRESSIVE", semanticSteps: ["SUBJECT", "INTERACTION", "REACTION"] }, compositionPatterns: ["RELATIONSHIP_BALANCED", "SUBJECT_PRODUCT_RELATIONSHIP", "ACTION_CENTERED"],
    blockingPattern: { level: "HIGH_LEVEL_ONLY", semanticIntent: "Preserve readable subject relationships without prescribing physical paths" }, productEmphasisCompatibility: ["RELATIONSHIP_CONTEXT", "USAGE_CONTEXT"],
    motionComplexityClass: "HIGH", requiredEvidence: ["SCRIPT_ACTION"], constraints: ["SCRIPT_ACTION_SUPPORTED"], mustAvoid: [], profileCompatibility: ["CORE", "PRODUCT_STORY"],
  },
  {
    recipeId: "USAGE_DEMONSTRATION", semanticPurpose: "USAGE_DEMONSTRATION",
    compatibleVisualRoles: ["USAGE_DEMONSTRATION", "RELATIONSHIP"], compatibleShotPurposes: ["SHOW_ACTION", "SHOW_EVIDENCE", "EMPHASIZE_PRODUCT"],
    recommendedShotSizes: ["MEDIUM", "MEDIUM_CLOSE", "CLOSE"], cameraFamilies: ["LOCKED", "SLOW_PUSH_IN", "MINOR_LATERAL_DOLLY", "TRACKING"],
    focusPattern: { mode: "PROGRESSIVE", semanticSteps: ["ACTION_START", "PRODUCT_INTERACTION", "ACTION_RESULT"] }, compositionPatterns: ["ACTION_CENTERED", "SUBJECT_PRODUCT_RELATIONSHIP"],
    blockingPattern: { level: "HIGH_LEVEL_ONLY", semanticIntent: "Keep the Script-authorized usage and its result visually legible" }, productEmphasisCompatibility: ["USAGE_CONTEXT", "DETAIL_EVIDENCE"],
    motionComplexityClass: "HIGH", requiredEvidence: ["SCRIPT_ACTION"], constraints: ["SCRIPT_ACTION_SUPPORTED", "ACTION_RESULT_VISIBLE"], mustAvoid: [], profileCompatibility: ["CORE", "PRODUCT_STORY"],
  },
  {
    recipeId: "CONTEXT_SCALE", semanticPurpose: "CONTEXT_SCALE",
    compatibleVisualRoles: ["ENVIRONMENT_ESTABLISH", "RELATIONSHIP"], compatibleShotPurposes: ["ESTABLISH_CONTEXT", "SHOW_SCALE", "SHOW_ENVIRONMENT"],
    recommendedShotSizes: ["EXTREME_WIDE", "WIDE", "MEDIUM"], cameraFamilies: ["LOCKED", "SLOW_PULL_BACK", "GENTLE_PARALLAX", "PAN"],
    focusPattern: { mode: "PROGRESSIVE", semanticSteps: ["ENVIRONMENT", "SUBJECT_RELATION", "SCALE_EVIDENCE"] }, compositionPatterns: ["ENVIRONMENT_CONTEXTUAL", "SCALE_CONTEXT"],
    blockingPattern: { level: "HIGH_LEVEL_ONLY", semanticIntent: "Preserve spatial context and scale relationships" }, productEmphasisCompatibility: ["ENVIRONMENT_CONTEXT", "BACKGROUND_CONTEXT", "RELATIONSHIP_CONTEXT"],
    motionComplexityClass: "MEDIUM", requiredEvidence: ["CONTEXT_OR_SCALE"], constraints: ["CONTEXT_RESOLVES"], mustAvoid: [], profileCompatibility: ["CORE", "PRODUCT_STORY"],
  },
  {
    recipeId: "REACTION_PAYOFF", semanticPurpose: "REACTION_PAYOFF",
    compatibleVisualRoles: ["REACTION", "PAYOFF"], compatibleShotPurposes: ["SHOW_REACTION", "RESOLVE", "SHOW_RELATIONSHIP"],
    recommendedShotSizes: ["MEDIUM", "MEDIUM_CLOSE", "CLOSE"], cameraFamilies: ["LOCKED", "SLOW_PUSH_IN", "RACK_FOCUS"],
    focusPattern: { mode: "PROGRESSIVE", semanticSteps: ["CAUSE", "REACTION", "CONSEQUENCE"] }, compositionPatterns: ["REACTION_CENTERED", "RELATIONSHIP_BALANCED"],
    blockingPattern: { level: "HIGH_LEVEL_ONLY", semanticIntent: "Keep the canonical reaction or consequence readable" }, productEmphasisCompatibility: ["RELATIONSHIP_CONTEXT", "BACKGROUND_CONTEXT"],
    motionComplexityClass: "MEDIUM", requiredEvidence: ["REACTION_OR_CONSEQUENCE"], constraints: ["REACTION_TRUTH_RESOLVES"], mustAvoid: [], profileCompatibility: ["CORE", "PRODUCT_STORY"],
  },
  {
    recipeId: "HERO_REVEAL", semanticPurpose: "PRODUCT_HERO_REVEAL",
    compatibleVisualRoles: ["HERO_INTRODUCTION", "PACKSHOT"], compatibleShotPurposes: ["REVEAL_SUBJECT", "EMPHASIZE_PRODUCT", "RESOLVE"],
    recommendedShotSizes: ["WIDE", "MEDIUM", "MEDIUM_CLOSE", "CLOSE"], cameraFamilies: ["LOCKED", "SLOW_PUSH_IN", "GENTLE_PARALLAX"],
    focusPattern: { mode: "SINGLE", semanticSteps: ["PRIMARY_SUBJECT"] }, compositionPatterns: ["PRODUCT_DOMINANT"],
    blockingPattern: { level: "HIGH_LEVEL_ONLY", semanticIntent: "Keep the primary authority subject clearly readable" }, productEmphasisCompatibility: ["PRIMARY_HERO", "PACKSHOT"],
    motionComplexityClass: "LOW", requiredEvidence: [], constraints: ["PRIMARY_SUBJECT_RESOLVES"], mustAvoid: ["MAJOR_OCCLUSION", "LARGE_PRODUCT_PERSPECTIVE_CHANGE"], profileCompatibility: ["CORE", "PRODUCT_STORY"],
  },
] as const);

export const AI_STORY_SHOT_RECIPE_PROMPT_LIBRARY = false as const;
export const AI_STORY_SHOT_RECIPE_CATEGORY_POLICY = false as const;
export const AI_STORY_SHOT_RECIPE_SELECTION_REQUIRED = false as const;
