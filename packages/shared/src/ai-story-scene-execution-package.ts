import { z } from "zod";
import { AiStoryCastReferenceSchema, AI_STORY_VISUAL_IDENTITY_REQUIREMENTS } from "./ai-story-cast";
import { AiStoryDirectorSceneDirectionSchema } from "./ai-story-director-plan";
import { AiStorySceneMotionPlanSchema } from "./ai-story-motion-plan";
import { AiStoryPreGenerationQcEvaluationSchema } from "./ai-story-pre-generation-qc";
import { AiStoryCanonicalSceneSchema, AiStoryLocationAuthorityVersionSchema } from "./ai-story-scene";
import { AiStoryShotRecipeSchema } from "./ai-story-shot-recipe";
import { AiStoryEffectiveSceneGenerationAuthoritySchema } from "./ai-story-generation-authority";

export const AI_STORY_SCENE_EXECUTION_PACKAGE_CONTRACT_VERSION = "ai-story-scene-execution-package.v1" as const;
export const AI_STORY_SEMANTIC_PLAN_CONTRACT_VERSION = "ai-story-seedance-semantic-plan.v1" as const;
export const AI_STORY_SEEDANCE_MAPPING_VERSION = "seedance-director-adapter.v1" as const;
export const AI_STORY_SEEDANCE_CAPABILITY_CONTRACT_VERSION = "seedance-modelark-2026-08-29.v1" as const;
export const AI_STORY_SCENE_EXECUTION_MODES = ["TEXT_TO_VIDEO", "FIRST_FRAME_IMAGE_TO_VIDEO"] as const;
export const AI_STORY_REFERENCE_AUTHORITY_CLASSES = ["REQUIRED", "PREFERRED", "OPTIONAL"] as const;
export const AI_STORY_TRANSLATION_CLASSES = ["DIRECT_STRUCTURED_MAPPING", "CERTIFIED_PROMPT_SEMANTIC_MAPPING", "CONDITIONING_MAPPING", "NO_SAFE_MAPPING"] as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1).max(3000);

export const AiStoryExecutionVisualReferenceSchema = z.object({
  referenceId: Id,
  assetId: Id,
  authorityType: z.enum(["CAST", "PRODUCT", "LOCATION", "OTHER"]),
  authorityId: Id,
  authorityClass: z.enum(AI_STORY_REFERENCE_AUTHORITY_CLASSES),
  semanticBinding: Text,
  selectionPriority: z.number().int().min(0).max(1000),
  firstFrame: z.boolean(),
  mediaType: z.string().trim().min(1).max(160).optional(),
  uri: z.string().url().optional(),
  storagePath: z.string().trim().min(1).optional(),
}).strict();

export const AiStoryResolvedCastAuthoritySchema = z.object({
  reference: AiStoryCastReferenceSchema,
  displayName: Text.max(200),
  identity: Text,
  appearance: Text,
  coreContinuityFacts: z.array(Text),
  sceneStateFacts: z.array(Text),
  mustKeep: z.array(Text),
}).strict();

export const AiStoryResolvedProductAuthoritySchema = z.object({
  productAuthorityId: Id,
  sourceAssetId: Id,
  sourceAssetContentHash: Hash,
  displayName: Text.max(300),
  identityFacts: z.array(Text).min(1),
  visibleEvidenceGoals: z.array(Text),
  sceneStateFacts: z.array(Text),
  mustKeep: z.array(Text),
  mustAvoid: z.array(Text),
  visualIdentityRequirement: z.enum(AI_STORY_VISUAL_IDENTITY_REQUIREMENTS),
}).strict();

export const AiStorySceneExecutionPackageSchema = z.object({
  sceneExecutionPackageId: Id,
  contractVersion: z.literal(AI_STORY_SCENE_EXECUTION_PACKAGE_CONTRACT_VERSION),
  packageFingerprint: Hash,
  orgId: Id,
  workspaceId: Id,
  campaignId: Id,
  storyId: Id,
  storyVersionId: Id,
  outlineVersionId: Id,
  scriptVersionId: Id,
  scriptFingerprint: Hash,
  handoffId: Id,
  handoffFingerprint: Hash,
  directorPlanId: Id,
  directorFingerprint: Hash,
  motionPlanId: Id,
  motionFingerprint: Hash,
  scene: AiStoryCanonicalSceneSchema,
  locationAuthority: AiStoryLocationAuthorityVersionSchema.nullable(),
  castAuthorities: z.array(AiStoryResolvedCastAuthoritySchema),
  productAuthorities: z.array(AiStoryResolvedProductAuthoritySchema),
  directorDirection: AiStoryDirectorSceneDirectionSchema,
  motionScenePlan: AiStorySceneMotionPlanSchema,
  shotRecipe: AiStoryShotRecipeSchema.nullable(),
  qcEvaluation: AiStoryPreGenerationQcEvaluationSchema,
  generation: z.object({
    mode: z.enum(AI_STORY_SCENE_EXECUTION_MODES),
    durationSec: z.union([z.literal(4), z.literal(5), z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
    ratio: z.enum(["9:16", "16:9", "1:1"]),
    resolution: z.enum(["480p", "720p", "1080p"]),
    watermark: z.boolean(),
    cameraMappingRequirement: z.enum(["REQUIRED", "OPTIONAL"]),
  }).strict(),
  visualReferences: z.array(AiStoryExecutionVisualReferenceSchema),
  generationAuthority: AiStoryEffectiveSceneGenerationAuthoritySchema.optional(),
  providerBinding: z.object({
    providerId: z.literal("seedance"),
    model: z.literal("dreamina-seedance-2-0-260128"),
    modelVersion: z.literal("dreamina-seedance-2-0-260128"),
    capabilityContractVersion: z.literal(AI_STORY_SEEDANCE_CAPABILITY_CONTRACT_VERSION),
    adapterMappingVersion: z.literal(AI_STORY_SEEDANCE_MAPPING_VERSION),
    qcCapabilityVersion: Text.max(160),
  }).strict(),
}).strict();

export const AiStorySeedanceSemanticPlanSchema = z.object({
  contractVersion: z.literal(AI_STORY_SEMANTIC_PLAN_CONTRACT_VERSION),
  sceneExecutionPackageId: Id,
  packageFingerprint: Hash,
  sections: z.array(z.object({
    section: z.enum(["SCENE_CONTEXT", "CAST_AUTHORITY", "LOCATION_AUTHORITY", "PRODUCT_AUTHORITY", "ENTRY_STATE", "SCENE_PURPOSE", "SCRIPT_ACTION", "ACTION_PROGRESSION", "REQUIRED_EXIT_STATE", "DIRECTOR_VISUAL_TREATMENT", "SHOT_RECIPE_SEMANTICS", "CAMERA", "FOCUS", "COMPOSITION", "BLOCKING", "ENVIRONMENTAL_MOTION", "REQUIRED_EVIDENCE", "MUST_KEEP", "MUST_AVOID"]),
    facts: z.array(Text),
  }).strict()),
  translationClasses: z.array(z.object({ concept: Text.max(160), translationClass: z.enum(AI_STORY_TRANSLATION_CLASSES) }).strict()),
}).strict();

export type AiStorySceneExecutionPackage = z.infer<typeof AiStorySceneExecutionPackageSchema>;
export type AiStoryExecutionVisualReference = z.infer<typeof AiStoryExecutionVisualReferenceSchema>;
export type AiStorySeedanceSemanticPlan = z.infer<typeof AiStorySeedanceSemanticPlanSchema>;

export const AI_STORY_SEEDANCE_TRANSLATION_MATRIX = Object.freeze([
  { concept: "generation mode", translationClass: "DIRECT_STRUCTURED_MAPPING" },
  { concept: "duration", translationClass: "DIRECT_STRUCTURED_MAPPING" },
  { concept: "ratio", translationClass: "DIRECT_STRUCTURED_MAPPING" },
  { concept: "resolution", translationClass: "DIRECT_STRUCTURED_MAPPING" },
  { concept: "first frame", translationClass: "CONDITIONING_MAPPING" },
  { concept: "generic visual reference", translationClass: "CONDITIONING_MAPPING" },
  { concept: "Scene purpose", translationClass: "CERTIFIED_PROMPT_SEMANTIC_MAPPING" },
  { concept: "Cast identity and state", translationClass: "CERTIFIED_PROMPT_SEMANTIC_MAPPING" },
  { concept: "Location identity and state", translationClass: "CERTIFIED_PROMPT_SEMANTIC_MAPPING" },
  { concept: "Product identity and evidence", translationClass: "CERTIFIED_PROMPT_SEMANTIC_MAPPING" },
  { concept: "Script Action", translationClass: "CERTIFIED_PROMPT_SEMANTIC_MAPPING" },
  { concept: "Motion Start Path End", translationClass: "CERTIFIED_PROMPT_SEMANTIC_MAPPING" },
  { concept: "shot size", translationClass: "CERTIFIED_PROMPT_SEMANTIC_MAPPING" },
  { concept: "focus", translationClass: "CERTIFIED_PROMPT_SEMANTIC_MAPPING" },
  { concept: "composition", translationClass: "CERTIFIED_PROMPT_SEMANTIC_MAPPING" },
  { concept: "blocking", translationClass: "CERTIFIED_PROMPT_SEMANTIC_MAPPING" },
  { concept: "native Character reference role", translationClass: "NO_SAFE_MAPPING" },
  { concept: "native Product reference role", translationClass: "NO_SAFE_MAPPING" },
  { concept: "native Location reference role", translationClass: "NO_SAFE_MAPPING" },
  { concept: "multi-shot orchestration", translationClass: "NO_SAFE_MAPPING" },
  { concept: "first/last-frame chaining", translationClass: "NO_SAFE_MAPPING" },
  { concept: "audio", translationClass: "NO_SAFE_MAPPING" },
] as const);

export const AI_STORY_ADAPTER_OWNS_CREATIVE_AUTHORITY = false as const;
export const AI_STORY_ENTITY_PRESENCE_DETERMINES_GENERATION_MODE = false as const;
export const AI_STORY_SEEDANCE_REFERENCE_BUDGET = 4 as const;
