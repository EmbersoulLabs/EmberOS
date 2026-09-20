import { z } from "zod";
import { AI_STORY_SHOT_RECIPE_QC_GATES, AiStoryShotRecipeBindingSchema } from "./ai-story-shot-recipe";

export const AI_STORY_PRE_GENERATION_QC_CONTRACT_VERSION = "ai-story-pre-generation-qc.v1" as const;
export const AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION_V1 = 1 as const;
export const AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION_V2 = 2 as const;
/** Current evaluations use Gate Set V2. Historical rows remain Gate Set V1. */
export const AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION = AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION_V2;
export const AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSIONS = [AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION_V1, AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION_V2] as const;

export const AI_STORY_PRE_GENERATION_QC_GATE_ORDER_V1 = [
  "UPSTREAM_ARTIFACT_INTEGRITY_GATE",
  "SCRIPT_REFERENCE_INTEGRITY_GATE",
  "BEAT_COVERAGE_GATE",
  "SCENE_FUNCTION_GATE",
  "SCRIPT_DUPLICATION_GATE",
  "SCRIPT_STATE_CONTINUITY_GATE",
  "SCRIPT_TIMING_FEASIBILITY_GATE",
  "HANDOFF_INTEGRITY_GATE",
  "DIRECTOR_VISUAL_DIFFERENTIATION_GATE",
  "SCRIPT_TRUTH_PRESERVATION_GATE",
  "MOTION_ACTION_COMPLETION_GATE",
  "MOTION_PHYSICAL_PLAUSIBILITY_GATE",
  "MOTION_CONTINUITY_GATE",
  "PRODUCT_AUTHORITY_CAUSALITY_CONTINUITY_GATE",
  "MOTION_COMPLEXITY_GATE",
  "PRODUCT_GROUNDED_MOTION_SAFETY_GATE",
  "PROVIDER_CAPABILITY_GATE",
  "PROVIDER_COMPILATION_READINESS_GATE",
] as const;

export const AI_STORY_PRE_GENERATION_QC_PROMPT_TEAM_REPAIR_GATES = [
  "CINEMATIC_CAMERA_GRAMMAR_GATE",
  "SUBJECT_MOTION_FIRST_CLASS_GATE",
  "SUBJECT_MOTION_COMPLETION_GATE",
  "CONTINUITY_NOT_DUPLICATION_GATE",
  "CINEMATIC_EXECUTION_CONTRACT_GATE",
  "MUST_KEEP_MUST_CHANGE_SEPARATION_GATE",
  "ANTI_PPT_CREATIVE_GATE",
] as const;

export const AI_STORY_PRE_GENERATION_QC_GATE_ORDER_V2 = [
  ...AI_STORY_PRE_GENERATION_QC_GATE_ORDER_V1,
  ...AI_STORY_PRE_GENERATION_QC_PROMPT_TEAM_REPAIR_GATES,
] as const;

export const AI_STORY_PRE_GENERATION_QC_GATE_ORDER = AI_STORY_PRE_GENERATION_QC_GATE_ORDER_V2;
export const AI_STORY_PRE_GENERATION_QC_GATE_ORDER_V1_LENGTH = AI_STORY_PRE_GENERATION_QC_GATE_ORDER_V1.length;

export const AI_STORY_PRE_GENERATION_QC_CLASSIFICATIONS = ["HARD_GATE", "SOFT_WARNING", "AI_QC", "HUMAN_PREVIEW"] as const;
export const AI_STORY_PRE_GENERATION_QC_LAYERS = ["OUTLINE", "SCRIPT", "SCENE", "LOCATION", "CAST", "HANDOFF", "DIRECTOR", "MOTION", "PRODUCT_AUTHORITY", "PRODUCT_GROUNDING", "PROVIDER_ADAPTER"] as const;
export const AI_STORY_PRE_GENERATION_QC_REPAIR_OWNERS = [...AI_STORY_PRE_GENERATION_QC_LAYERS, "NONE"] as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1);

export const AiStoryPreGenerationQcArtifactIdsSchema = z.object({
  storyId: Id, storyVersionId: Id, outlineVersionId: Id, scriptVersionId: Id,
  handoffId: Id, directorPlanId: Id, motionPlanId: Id, sceneExecutionId: Id,
  sceneVersionIds: z.array(Id).optional(),
}).strict();

export const AiStoryPreGenerationQcGateResultSchema = z.object({
  gateId: z.enum(AI_STORY_PRE_GENERATION_QC_GATE_ORDER),
  gateVersion: z.number().int().positive(),
  classification: z.enum(AI_STORY_PRE_GENERATION_QC_CLASSIFICATIONS),
  status: z.enum(["PASS", "WARN", "BLOCK"]),
  failedLayer: z.enum(AI_STORY_PRE_GENERATION_QC_LAYERS).nullable(),
  reasonCode: Text.max(160),
  safeEvidence: z.array(Text.max(1000)),
  repairOwner: z.enum(AI_STORY_PRE_GENERATION_QC_REPAIR_OWNERS),
  evaluatedArtifactIds: AiStoryPreGenerationQcArtifactIdsSchema,
  contractVersion: z.literal(AI_STORY_PRE_GENERATION_QC_CONTRACT_VERSION),
}).strict();

export const AiStoryPreGenerationQcRecipeGateResultSchema = z.object({
  gateId: z.enum(AI_STORY_SHOT_RECIPE_QC_GATES),
  gateVersion: z.number().int().positive(),
  status: z.enum(["PASS", "WARN", "BLOCK"]),
  reasonCodes: z.array(Text.max(160)),
  safeEvidence: z.array(Text.max(1000)),
  repairOwners: z.array(z.enum(["SCRIPT", "DIRECTOR", "MOTION"])),
}).strict();

export const AiStoryPreGenerationQcEvaluationSchema = z.object({
  qcEvaluationId: Id,
  orgId: Id,
  workspaceId: Id,
  storyId: Id,
  storyVersionId: Id,
  outlineVersionId: Id,
  scriptVersionId: Id,
  handoffId: Id,
  directorPlanId: Id,
  motionPlanId: Id,
  sceneExecutionId: Id,
  sceneVersionIds: z.array(Id).optional(),
  contractVersion: z.literal(AI_STORY_PRE_GENERATION_QC_CONTRACT_VERSION),
  gateSetVersion: z.union([z.literal(AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION_V1), z.literal(AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION_V2)]),
  providerCapabilityId: Text.max(160),
  providerCapabilityVersion: Text.max(160),
  productAuthorityIds: z.array(Id),
  gateResults: z.array(AiStoryPreGenerationQcGateResultSchema).min(AI_STORY_PRE_GENERATION_QC_GATE_ORDER_V1_LENGTH),
  recipeGateResults: z.array(AiStoryPreGenerationQcRecipeGateResultSchema).length(AI_STORY_SHOT_RECIPE_QC_GATES.length).optional(),
  shotRecipeBindings: z.array(AiStoryShotRecipeBindingSchema).optional(),
  dispatchDecision: z.enum(["DISPATCH_ELIGIBLE", "DISPATCH_ELIGIBLE_WITH_WARNINGS", "DISPATCH_BLOCKED"]),
  preDispatchBlocked: z.boolean(),
  providerCallAvoided: z.boolean(),
  estimatedAttemptCostAvoidedUsd: z.number().nonnegative().nullable(),
  sceneFunction: Text.max(160),
  visualRole: Text.max(160),
  cameraFamily: Text.max(160),
  motionRiskClass: z.enum(["LOW", "MODERATE", "HIGH"]),
  productGrounded: z.boolean(),
  profileId: Text.max(160),
  qcFingerprint: Hash,
  evaluatedBy: Id,
  evaluatedAt: z.string().datetime(),
}).strict();

export type AiStoryPreGenerationQcGateId = typeof AI_STORY_PRE_GENERATION_QC_GATE_ORDER[number];
export type AiStoryPreGenerationQcGateResult = z.infer<typeof AiStoryPreGenerationQcGateResultSchema>;
export type AiStoryPreGenerationQcEvaluation = z.infer<typeof AiStoryPreGenerationQcEvaluationSchema>;
export type AiStoryPreGenerationQcRecipeGateResult = z.infer<typeof AiStoryPreGenerationQcRecipeGateResultSchema>;

export const AiStoryPreGenerationQcProviderCapabilitySchema = z.object({
  capabilityId: Text.max(160),
  capabilityVersion: Text.max(160),
  supportedExecutionModes: z.array(Text.max(160)),
  supportedReferenceRoles: z.array(Text.max(160)),
  supportedTimingStructures: z.array(Text.max(160)),
  estimatedAttemptCostUsd: z.number().nonnegative().nullable(),
  verified: z.boolean(),
}).strict();
export type AiStoryPreGenerationQcProviderCapability = z.infer<typeof AiStoryPreGenerationQcProviderCapabilitySchema>;

export const AiStoryPreGenerationQcCompilationRequestSchema = z.object({
  sceneExecutionId: Id,
  requestedCapabilityId: Text.max(160),
  executionMode: Text.max(160),
  referenceRoles: z.array(Text.max(160)),
  timingStructure: Text.max(160),
  providerNeutralInputsComplete: z.boolean(),
}).strict();

export const AiStoryPreGenerationQcProductAuthoritySchema = z.object({
  productAuthorityId: Id,
  sourceAssetId: Id,
  sourceAssetContentHash: Hash,
}).strict();

export const AI_STORY_PRE_GENERATION_QC_OWNS_BILLING = false as const;
export const AI_STORY_PRE_GENERATION_QC_DISPATCHES_PROVIDER = false as const;
export const AI_STORY_PRE_GENERATION_QC_AUTO_REPAIR = false as const;
export const AI_STORY_PRE_GENERATION_QC_AI_HAS_HARD_AUTHORITY = false as const;

export function preGenerationQcAllowsDispatch(evaluation: AiStoryPreGenerationQcEvaluation) {
  return evaluation.dispatchDecision !== "DISPATCH_BLOCKED";
}

export function projectLegacyStoryToPreGenerationQcCompatibility(story: { storyId: string; storyVersionId: string }) {
  return { kind: "LEGACY_PREGEN_QC_COMPATIBILITY" as const, ...story, canonicalQcEvaluation: null, dispatchAuthority: null };
}
