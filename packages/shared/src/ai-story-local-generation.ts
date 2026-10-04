import { z } from "zod";
import {
  AI_STORY_SCENE_GENERATION_STRATEGIES,
  AiStoryEffectiveSceneGenerationAuthoritySchema,
} from "./ai-story-generation-authority";
import { AiStoryPostQcRequirementSchema } from "./ai-story-post-generation-qc";
import { ProductVisualMaterialSelectionAuthoritySchema } from "./ai-story-product-visual-material-selection";

export const AI_STORY_LOCAL_GENERATION_PACKAGE_VERSION =
  "local-generation-package.v1" as const;
export const AI_STORY_LOCAL_GENERATION_PACKAGE_VERSION_V2 =
  "local-generation-package.v2" as const;
export const AI_STORY_LOCAL_GENERATION_SOURCE_AUTHORITY_VERSION =
  "ai-story-local-generation-source-authority.v2" as const;
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

export const AiStoryLocalGenerationPackageSchema = z.union([
  AiStoryLocalGenerationPackageV1Schema,
  AiStoryLocalGenerationPackageV2Schema,
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
export type AiStoryLocalGenerationPackage = z.infer<typeof AiStoryLocalGenerationPackageSchema>;
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
