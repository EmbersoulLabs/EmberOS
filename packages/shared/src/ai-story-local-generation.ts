import { z } from "zod";
import {
  AI_STORY_SCENE_GENERATION_STRATEGIES,
  AiStoryEffectiveSceneGenerationAuthoritySchema,
  AiStoryEffectiveSceneGenerationAuthorityV2Schema,
  AiStoryVisualStartAuthoritySchema,
} from "./ai-story-generation-authority";
import { AiStoryPostQcRequirementSchema } from "./ai-story-post-generation-qc";
import { LOCAL_GPU_PRODUCT_ONLY_CANDIDATE_WORKFLOW } from "./ai-story-local-gpu";
import { ProductVisualMaterialSelectionAuthoritySchema } from "./ai-story-product-visual-material-selection";

export const AI_STORY_LOCAL_GENERATION_PACKAGE_VERSION =
  "local-generation-package.v1" as const;
export const AI_STORY_LOCAL_GENERATION_PACKAGE_VERSION_V2 =
  "local-generation-package.v2" as const;
export const AI_STORY_LOCAL_GENERATION_PACKAGE_VERSION_V3 =
  "local-generation-package.v3" as const;
export const AI_STORY_LOCAL_GENERATION_SOURCE_AUTHORITY_VERSION =
  "ai-story-local-generation-source-authority.v2" as const;
export const AI_STORY_LOCAL_GENERATION_SOURCE_AUTHORITY_VERSION_V3 =
  "ai-story-local-generation-source-authority.v3" as const;
export const AI_STORY_SCENE_RELEASE_AUTHORITY_VERSION =
  "ai-story-scene-release-authority.v2" as const;
export const AI_STORY_PREDECESSOR_AUTHORITY_VERSION =
  "ai-story-local-predecessor-authority.v1" as const;
export const AI_STORY_VIDEO_EXECUTION_MODES = [
  "MANUAL_LOCAL",
  "REMOTE_PROVIDER",
] as const;
export const AI_STORY_LOCAL_WORKFLOWS = [
  "MINIMAX_H3_NATIVE_DIALOGUE",
  "WAN_I2V",
  "WAN_T2V",
  "WAN_S2V",
  "WAN_ANIMATE",
  "GENERIC_LOCAL_VIDEO",
] as const;
/**
 * Current-write registry for certified Manual Local workflows. Adding a newly
 * certified workflow extends this registry without changing the V3 package
 * version. V1/V2 retain the broader historical workflow enum above.
 */
export const AI_STORY_CERTIFIED_LOCAL_WORKFLOWS = [
  "MINIMAX_H3_NATIVE_DIALOGUE",
] as const;
/** Package values that are not production-certified workflows. */
export const AI_STORY_V2_PACKAGE_WORKFLOWS = [
  ...AI_STORY_LOCAL_WORKFLOWS,
  LOCAL_GPU_PRODUCT_ONLY_CANDIDATE_WORKFLOW,
] as const;
export const AI_STORY_V3_PACKAGE_WORKFLOWS = [
  ...AI_STORY_CERTIFIED_LOCAL_WORKFLOWS,
  LOCAL_GPU_PRODUCT_ONLY_CANDIDATE_WORKFLOW,
] as const;
export const AI_STORY_LOCAL_GENERATION_STATES = [
  "AWAITING_LOCAL_OUTPUT",
  "LOCAL_OUTPUT_UPLOADED",
  "LOCAL_REGENERATION_REQUIRED",
  "QC_PASS",
] as const;
/** Modes Local Generation Package v2 can express. Not a cloud Provider catalog. */
export const AI_STORY_LOCAL_PACKAGE_GENERATION_MODES =
  AI_STORY_SCENE_GENERATION_STRATEGIES;
/** Reference authority types stored on a Local Generation Package reference. */
export const AI_STORY_LOCAL_REFERENCE_AUTHORITY_TYPES = [
  "CHARACTER",
  "PRODUCT",
  "LOCATION",
  "FIRST_FRAME",
  "OTHER",
] as const;
export const AI_STORY_LOCAL_REFERENCE_ROLES_V3 = [
  "VISUAL_START",
  "PRODUCT_IDENTITY",
  "CHARACTER_IDENTITY",
  "LOCATION_CONTEXT",
] as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1).max(100_000);

/**
 * `locale` is absent on historical packages. New writes copy the frozen
 * dialogue language and must not default it.
 */
const AiStoryLocalDialogueLineSchema = z.object({
  speakerCharacterId: Id.optional(),
  speakerLabel: Text,
  text: Text,
  offscreen: z.boolean(),
  locale: z.string().trim().min(1).max(50).optional(),
}).strict();

export const AiStoryLocalReferenceSchema = z.object({
  assetId: Id,
  contentHash: Hash,
  authorityType: z.enum(AI_STORY_LOCAL_REFERENCE_AUTHORITY_TYPES),
  authorityId: Id,
  displayName: z.string().trim().min(1).max(300),
  mediaType: z.string().trim().min(1).max(160).optional(),
  storagePath: z.string().trim().min(1).optional(),
  providerWireRole: z.enum(["first_frame", "reference_image"]).optional(),
}).strict();

const AiStoryLocalGenerationPackageV1Schema = z.object({
  version: z.literal(AI_STORY_LOCAL_GENERATION_PACKAGE_VERSION),
  packageId: Id,
  packageFingerprint: Hash,
  executionMode: z.literal("MANUAL_LOCAL"),
  organizationId: Id,
  workspaceId: Id,
  campaignId: Id,
  storyId: Id,
  storyVersionId: Id,
  executionPlanId: Id,
  runtimeAuthorizationId: Id,
  unitId: Id,
  sceneExecutionId: Id,
  sceneId: Text,
  order: z.number().int().positive(),
  durationSec: z.number().positive(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
  resolutionIntent: z.enum(["480p", "720p", "1080p"]),
  recommendedWorkflow: z.enum(AI_STORY_LOCAL_WORKFLOWS),
  generationMode: z.enum(AI_STORY_LOCAL_PACKAGE_GENERATION_MODES),
  prompt: Text,
  negativePrompt: z.string().max(10_000).default(""),
  dialogue: z.array(AiStoryLocalDialogueLineSchema),
  generateAudio: z.boolean(),
  audioBlocked: z.boolean(),
  characterAuthority: z.object({
    characterId: Id,
    characterVersionId: Id,
    dnaFingerprint: Hash,
    sourcePhotoSentToVideoProvider: z.literal(false),
  }).strict().nullable(),
  productAuthority: z.object({
    assetId: Id,
    contentHash: Hash,
    confirmedVariant: z.string().trim().min(1).max(160).nullable(),
  }).strict().nullable(),
  worldDescription: z.string().max(4_000),
  mustKeep: z.array(Text),
  mustAvoid: z.array(Text),
  qcRequirements: z.array(AiStoryPostQcRequirementSchema),
  continuityRequirements: z.array(Text),
  previousUnitEndState: z.array(Text),
  currentUnitStartState: z.array(Text),
  expectedEndState: z.array(Text),
  references: z.array(AiStoryLocalReferenceSchema),
  sourceAuthority: z.object({
    schedulingAuthorityId: Id,
    schedulingAuthorityFingerprint: Hash,
    plannerSnapshotId: Id,
    compiledRequestId: Id,
    compiledRequestFingerprint: Hash,
    sceneFingerprint: Hash,
    semanticPlanFingerprint: Hash,
    preGenerationQcEvaluationId: Id,
    preGenerationQcFingerprint: Hash,
    directorFingerprint: Hash,
    motionFingerprint: Hash,
    castSnapshotFingerprint: Hash,
    locationSnapshotFingerprint: Hash,
    productSnapshotFingerprint: Hash,
  }).strict(),
  planningAuthority: z.object({
    planningLineageSource:z.enum(["FROZEN_SCRIPT_DIRECTOR","LEGACY_COMPILED_V1"]),
    sceneVersion:z.number().int().positive(),
    scriptVersionId:Id.nullable(), handoffId:Id.nullable(), handoffFingerprint:Hash.nullable(),
  }).strict(),
  instructions: Text,
  state: z.enum(AI_STORY_LOCAL_GENERATION_STATES),
  retryOfPackageId: Id.nullable(),
  retryNumber: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (value.planningAuthority.planningLineageSource==="FROZEN_SCRIPT_DIRECTOR" &&
      (!value.planningAuthority.scriptVersionId || !value.planningAuthority.handoffId || !value.planningAuthority.handoffFingerprint)) {
    context.addIssue({code:z.ZodIssueCode.custom,message:"Frozen planning authority is incomplete"});
  }
  if (value.generateAudio === value.audioBlocked) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "generateAudio and audioBlocked must preserve one consistent audio authority",
    });
  }
  if (value.generationMode === "TEXT_TO_VIDEO" && value.references.some((reference) => reference.authorityType === "FIRST_FRAME")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "TEXT_TO_VIDEO cannot carry a first-frame reference",
    });
  }
});

const AiStoryLocalProductAuthorityV2Schema = z.object({
  assetId: Id,
  contentHash: Hash,
  confirmedVariant: z.string().trim().min(1).max(160).nullable(),
  selectedMaterialAssetId: Id.nullable(),
  selectedMaterialContentHash: Hash.nullable(),
  selection: z.enum(["SOURCE_ASSET", "EXTRACTED_DERIVATIVE", "NO_PRODUCT_VISUAL_INPUT"]),
}).strict();

const AiStoryLocalGenerationSourceAuthorityV2Schema = z.object({
  version: z.literal(AI_STORY_LOCAL_GENERATION_SOURCE_AUTHORITY_VERSION),
  localSourceAuthorityId: Id,
  localSourceAuthorityFingerprint: Hash,
  orgId: Id,
  workspaceId: Id,
  campaignId: Id,
  storyId: Id,
  storyVersionId: Id,
  executionPlanId: Id,
  runtimeAuthorizationId: Id,
  sceneExecutionId: Id,
  sceneExecutionFingerprint: Hash,
  instructionContentHash: Hash,
  sceneVersionId: Id,
  sceneFingerprint: Hash,
  generationAuthority: AiStoryEffectiveSceneGenerationAuthoritySchema,
  generationAuthorityFingerprint: Hash,
  preGenerationQcEvaluationId: Id,
  preGenerationQcFingerprint: Hash,
  directorFingerprint: Hash,
  motionFingerprint: Hash,
  scriptVersionId: Id,
  handoffId: Id,
  handoffFingerprint: Hash,
  characterAuthorityFingerprint: Hash,
  worldAuthorityFingerprint: Hash,
  productMaterialFingerprint: Hash,
  productMaterialSelection: ProductVisualMaterialSelectionAuthoritySchema.nullable(),
}).strict();

const AiStoryLocalGenerationPackageV2Schema = z.object({
  version: z.literal(AI_STORY_LOCAL_GENERATION_PACKAGE_VERSION_V2),
  packageId: Id,
  packageFingerprint: Hash,
  executionMode: z.literal("MANUAL_LOCAL"),
  organizationId: Id,
  workspaceId: Id,
  campaignId: Id,
  storyId: Id,
  storyVersionId: Id,
  executionPlanId: Id,
  runtimeAuthorizationId: Id,
  unitId: Id,
  sceneExecutionId: Id,
  sceneId: Text,
  order: z.number().int().positive(),
  durationSec: z.number().positive(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
  resolutionIntent: z.enum(["480p", "720p", "1080p"]),
  recommendedWorkflow: z.enum(AI_STORY_V2_PACKAGE_WORKFLOWS),
  generationMode: z.enum(AI_STORY_LOCAL_PACKAGE_GENERATION_MODES),
  prompt: Text,
  negativePrompt: z.string().max(10_000).default(""),
  dialogue: z.array(AiStoryLocalDialogueLineSchema),
  generateAudio: z.boolean(),
  audioBlocked: z.boolean(),
  audioQcExpectationKind: z.literal("NO_DIALOGUE_WITH_AMBIENT_AUDIO").optional(),
  characterAuthority: z.object({
    characterId: Id,
    characterVersionId: Id,
    dnaFingerprint: Hash,
    sourcePhotoSentToVideoProvider: z.literal(false),
  }).strict().nullable(),
  productAuthority: AiStoryLocalProductAuthorityV2Schema.nullable(),
  worldDescription: z.string().max(4_000),
  mustKeep: z.array(Text),
  mustAvoid: z.array(Text),
  qcRequirements: z.array(AiStoryPostQcRequirementSchema),
  continuityRequirements: z.array(Text),
  previousUnitEndState: z.array(Text),
  currentUnitStartState: z.array(Text),
  expectedEndState: z.array(Text),
  references: z.array(AiStoryLocalReferenceSchema),
  sourceAuthority: AiStoryLocalGenerationSourceAuthorityV2Schema,
  planningAuthority: z.object({
    planningLineageSource: z.literal("FROZEN_SCRIPT_DIRECTOR"),
    sceneVersion: z.number().int().positive(),
    scriptVersionId: Id,
    handoffId: Id,
    handoffFingerprint: Hash,
  }).strict(),
  instructions: Text,
  state: z.enum(AI_STORY_LOCAL_GENERATION_STATES),
  retryOfPackageId: Id.nullable(),
  retryNumber: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (value.generateAudio === value.audioBlocked) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "generateAudio and audioBlocked must preserve one consistent audio authority" });
  }
  if (value.generationMode === "TEXT_TO_VIDEO" && value.references.some((reference) => reference.authorityType === "FIRST_FRAME")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "TEXT_TO_VIDEO cannot carry a first-frame reference" });
  }
  const firstFrames = value.references.filter((reference) => reference.authorityType === "FIRST_FRAME");
  if (value.generationMode !== "TEXT_TO_VIDEO" && firstFrames.length !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Image-conditioned local execution requires exactly one first-frame reference" });
  }
  if (value.productAuthority?.selection === "EXTRACTED_DERIVATIVE" || value.productAuthority?.selection === "SOURCE_ASSET") {
    if (!value.productAuthority.selectedMaterialAssetId || !value.productAuthority.selectedMaterialContentHash) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Selected Product material identity is required" });
    }
    if (value.generationMode !== "TEXT_TO_VIDEO" && firstFrames[0] && (
      firstFrames[0].assetId !== value.productAuthority.selectedMaterialAssetId ||
      firstFrames[0].contentHash !== value.productAuthority.selectedMaterialContentHash
    )) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "First-frame reference must be the selected Product material" });
    }
  }
});

export const AiStoryLocalReferenceV3Schema = z.object({
  role: z.enum(AI_STORY_LOCAL_REFERENCE_ROLES_V3),
  assetId: Id,
  contentHash: Hash,
  authorityId: Id,
  displayName: z.string().trim().min(1).max(300),
  mediaType: z.string().trim().min(1).max(160),
}).strict();

export const AiStoryLocalPredecessorAuthoritySemanticSchema = z.object({
  contractVersion: z.literal(AI_STORY_PREDECESSOR_AUTHORITY_VERSION),
  predecessorSceneExecutionId: Id,
  predecessorPackageId: Id,
  predecessorGenerationResultId: Id,
  predecessorPostQcEvaluationId: Id,
  predecessorDecisionId: Id,
  predecessorOutputAssetId: Id,
  predecessorOutputContentHash: Hash,
  continuityFrameAssetId: Id,
  continuityFrameContentHash: Hash,
  continuitySourceContentHash: Hash,
  extractionContractVersion: z.string().trim().min(1).max(160),
}).strict();

export const AiStoryLocalPredecessorAuthoritySchema = z.object({
  semantic: AiStoryLocalPredecessorAuthoritySemanticSchema,
  semanticFingerprint: Hash,
  audit: z.object({
    /** Audit-only: excluded from semantic fingerprints and deterministic IDs. */
    extractedAt: z.string().datetime(),
  }).strict(),
}).strict();

export const AiStoryLocalReleaseAuthoritySemanticSchema = z.object({
  contractVersion: z.literal(AI_STORY_SCENE_RELEASE_AUTHORITY_VERSION),
  executionMode: z.literal("MANUAL_LOCAL"),
  organizationId: Id,
  workspaceId: Id,
  executionPlanId: Id,
  runtimeAuthorizationId: Id,
  sceneExecutionId: Id,
  sceneOrder: z.number().int().positive(),
  releaseRevision: z.number().int().nonnegative(),
  gateKind: z.enum(["INITIAL_UNIT", "PREDECESSOR_CONTINUITY"]),
  gateEvidenceFingerprint: Hash.nullable(),
}).strict();

export const AiStoryLocalReleaseAuthoritySchema = z.object({
  releaseAuthorityId: Id,
  semantic: AiStoryLocalReleaseAuthoritySemanticSchema,
  semanticFingerprint: Hash,
  audit: z.object({
    /** Audit-only fields never participate in semantic identity. */
    releasedBy: Id,
    releasedAt: z.string().datetime(),
  }).strict(),
}).strict();

const AiStoryLocalGenerationSourceAuthorityV3Schema = z.object({
  version: z.literal(AI_STORY_LOCAL_GENERATION_SOURCE_AUTHORITY_VERSION_V3),
  localSourceAuthorityId: Id,
  localSourceAuthorityFingerprint: Hash,
  orgId: Id,
  workspaceId: Id,
  campaignId: Id,
  storyId: Id,
  storyVersionId: Id,
  executionPlanId: Id,
  runtimeAuthorizationId: Id,
  sceneExecutionId: Id,
  sceneExecutionFingerprint: Hash,
  instructionContentHash: Hash,
  sceneVersionId: Id,
  sceneFingerprint: Hash,
  generationAuthority: AiStoryEffectiveSceneGenerationAuthorityV2Schema,
  generationAuthorityFingerprint: Hash,
  preGenerationQcEvaluationId: Id,
  preGenerationQcFingerprint: Hash,
  directorFingerprint: Hash,
  motionFingerprint: Hash,
  scriptVersionId: Id,
  handoffId: Id,
  handoffFingerprint: Hash,
  characterAuthorityFingerprint: Hash,
  worldAuthorityFingerprint: Hash,
  productMaterialFingerprint: Hash,
  productMaterialSelection: ProductVisualMaterialSelectionAuthoritySchema.nullable(),
}).strict();

export const AiStoryLocalGenerationPackageV3Schema = z.object({
  version: z.literal(AI_STORY_LOCAL_GENERATION_PACKAGE_VERSION_V3),
  packageId: Id,
  packageFingerprint: Hash,
  executionMode: z.literal("MANUAL_LOCAL"),
  organizationId: Id,
  workspaceId: Id,
  campaignId: Id,
  storyId: Id,
  storyVersionId: Id,
  executionPlanId: Id,
  runtimeAuthorizationId: Id,
  unitId: Id,
  sceneExecutionId: Id,
  sceneId: Text,
  order: z.number().int().positive(),
  durationSec: z.number().positive(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
  resolutionIntent: z.enum(["480p", "720p", "1080p"]),
  recommendedWorkflow: z.enum(AI_STORY_V3_PACKAGE_WORKFLOWS),
  audioQcExpectationKind: z.literal("NO_DIALOGUE_WITH_AMBIENT_AUDIO").optional(),
  /** Canonical strategy; deliberately independent from the local workflow. */
  generationMode: z.enum(AI_STORY_LOCAL_PACKAGE_GENERATION_MODES),
  prompt: Text,
  negativePrompt: z.string().max(10_000).default(""),
  dialogue: z.array(AiStoryLocalDialogueLineSchema),
  generateAudio: z.boolean(),
  audioBlocked: z.boolean(),
  characterAuthority: z.object({
    characterId: Id,
    characterVersionId: Id,
    dnaFingerprint: Hash,
    sourcePhotoSentToVideoProvider: z.literal(false),
  }).strict().nullable(),
  productAuthority: AiStoryLocalProductAuthorityV2Schema.nullable(),
  visualStartAuthority: AiStoryVisualStartAuthoritySchema,
  predecessorAuthority: AiStoryLocalPredecessorAuthoritySchema.nullable(),
  releaseAuthority: AiStoryLocalReleaseAuthoritySchema,
  worldDescription: z.string().max(4_000),
  mustKeep: z.array(Text),
  mustAvoid: z.array(Text),
  qcRequirements: z.array(AiStoryPostQcRequirementSchema),
  continuityRequirements: z.array(Text),
  previousUnitEndState: z.array(Text),
  currentUnitStartState: z.array(Text),
  expectedEndState: z.array(Text),
  references: z.array(AiStoryLocalReferenceV3Schema),
  sourceAuthority: AiStoryLocalGenerationSourceAuthorityV3Schema,
  planningAuthority: z.object({
    planningLineageSource: z.literal("FROZEN_SCRIPT_DIRECTOR"),
    sceneVersion: z.number().int().positive(),
    scriptVersionId: Id,
    handoffId: Id,
    handoffFingerprint: Hash,
  }).strict(),
  instructions: Text,
  state: z.enum(AI_STORY_LOCAL_GENERATION_STATES),
  successorOfPackageId: Id.nullable(),
  successorNumber: z.number().int().nonnegative(),
  retryOfPackageId: Id.nullable(),
  retryNumber: z.number().int().nonnegative(),
  /** Audit-only: excluded from semantic fingerprints and deterministic IDs. */
  createdAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (value.generateAudio === value.audioBlocked) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "generateAudio and audioBlocked must preserve one consistent audio authority" });
  }
  const visualReferences = value.references.filter((reference) => reference.role === "VISUAL_START");
  if (value.visualStartAuthority.sourceType === "NONE") {
    if (visualReferences.length !== 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Reference-free execution cannot carry a visual-start reference" });
    }
  } else if (
    visualReferences.length !== 1 ||
    visualReferences[0]?.assetId !== value.visualStartAuthority.assetId ||
    visualReferences[0]?.contentHash !== value.visualStartAuthority.contentHash
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Visual-start reference must match visualStartAuthority" });
  }

  if (value.visualStartAuthority.sourceType === "PREDECESSOR_CONTINUITY") {
    const predecessor = value.predecessorAuthority?.semantic;
    if (!predecessor) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "PREDECESSOR_CONTINUITY requires predecessorAuthority" });
    } else if (
      predecessor.continuityFrameAssetId !== value.visualStartAuthority.assetId ||
      predecessor.continuityFrameContentHash !== value.visualStartAuthority.contentHash
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Visual-start continuity must match predecessor authority" });
    } else if (predecessor.continuitySourceContentHash !== predecessor.predecessorOutputContentHash) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Continuity source must match predecessor output authority" });
    }
  } else if (value.predecessorAuthority !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Predecessor authority is only valid for predecessor continuity" });
  }

  const productReferences = value.references.filter((reference) => reference.role === "PRODUCT_IDENTITY");
  const selectedProductAssetId = value.productAuthority?.selectedMaterialAssetId;
  const selectedProductHash = value.productAuthority?.selectedMaterialContentHash;
  if (selectedProductAssetId && selectedProductHash) {
    if (
      productReferences.length !== 1 ||
      productReferences[0]?.assetId !== selectedProductAssetId ||
      productReferences[0]?.contentHash !== selectedProductHash
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Product reference must match selected Product material" });
    }
  } else if (productReferences.length !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Product reference requires selected Product material authority" });
  }

  if (value.generationMode !== value.sourceAuthority.generationAuthority.strategy) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Package generation mode must preserve canonical generation strategy" });
  }
  if (
    JSON.stringify(value.visualStartAuthority) !==
    JSON.stringify(value.sourceAuthority.generationAuthority.visualStartAuthority)
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Package visual-start authority must match Generation Authority V2" });
  }
  const predecessorGate = value.releaseAuthority.semantic.gateKind === "PREDECESSOR_CONTINUITY";
  if (predecessorGate !== Boolean(value.predecessorAuthority)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Release gate and predecessor authority must agree" });
  }
  if (
    predecessorGate &&
    value.releaseAuthority.semantic.gateEvidenceFingerprint !== value.predecessorAuthority?.semanticFingerprint
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Release gate must bind the predecessor semantic fingerprint" });
  }
  if (!predecessorGate && value.releaseAuthority.semantic.gateEvidenceFingerprint !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Initial release cannot carry predecessor gate evidence" });
  }
  const release = value.releaseAuthority.semantic;
  if (
    release.organizationId !== value.organizationId ||
    release.workspaceId !== value.workspaceId ||
    release.executionPlanId !== value.executionPlanId ||
    release.runtimeAuthorizationId !== value.runtimeAuthorizationId ||
    release.sceneExecutionId !== value.sceneExecutionId ||
    release.sceneOrder !== value.order
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Release authority must match Package execution identity" });
  }
});

export const AiStoryLocalGenerationPackageSchema = z.union([
  AiStoryLocalGenerationPackageV1Schema,
  AiStoryLocalGenerationPackageV2Schema,
  AiStoryLocalGenerationPackageV3Schema,
]);

export const AiStoryLocalGenerationOutputSchema = z.object({
  outputId: Id,
  packageId: Id,
  unitId: Id,
  sceneExecutionId: Id,
  assetId: Id,
  contentHash: Hash,
  mediaType: z.literal("video/mp4"),
  durationSec: z.number().positive(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  uploadedBy: Id,
  uploadedAt: z.string().datetime(),
  qcState: z.enum(["PENDING", "PASS", "LOCAL_REGENERATION_REQUIRED"]),
  continuityFrameAssetId: Id.nullable(),
}).strict();

export type AiStoryVideoExecutionMode = (typeof AI_STORY_VIDEO_EXECUTION_MODES)[number];
export type AiStoryLocalWorkflow = (typeof AI_STORY_LOCAL_WORKFLOWS)[number];
export type AiStoryCertifiedLocalWorkflow = (typeof AI_STORY_CERTIFIED_LOCAL_WORKFLOWS)[number];
export type AiStoryLocalGenerationPackage = z.infer<typeof AiStoryLocalGenerationPackageSchema>;
export type AiStoryLocalGenerationPackageV3 = z.infer<typeof AiStoryLocalGenerationPackageV3Schema>;
export type AiStoryLocalPredecessorAuthority = z.infer<typeof AiStoryLocalPredecessorAuthoritySchema>;
export type AiStoryLocalReleaseAuthority = z.infer<typeof AiStoryLocalReleaseAuthoritySchema>;
export type AiStoryLocalGenerationOutput = z.infer<typeof AiStoryLocalGenerationOutputSchema>;

export const AiStoryLocalMediaJobIdentitySchema = z.object({
  workspaceId:Id, executionPlanId:Id, packageId:Id, actorUserId:Id,
});
export const AiStoryLocalMediaJobSchema = AiStoryLocalMediaJobIdentitySchema.extend({
  jobId:Id, kind:z.enum(["VALIDATE_OUTPUT","EXTRACT_FRAME"]),
  assetId:Id.nullable(), generationResultId:Id.nullable(),
  state:z.enum(["PENDING","RUNNING","SUCCEEDED","FAILED"]), claimToken:Id.nullable(),
  errorCode:z.string().nullable(),
});
export type AiStoryLocalMediaJob = z.infer<typeof AiStoryLocalMediaJobSchema>;
export type AiStoryLocalMediaJobInput = z.infer<typeof AiStoryLocalMediaJobIdentitySchema> &
  ({kind:"VALIDATE_OUTPUT";assetId:string}|{kind:"EXTRACT_FRAME";generationResultId:string});
