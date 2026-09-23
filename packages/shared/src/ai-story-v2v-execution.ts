/**
 * Provider-neutral VIDEO_TO_VIDEO contract.
 * Contract layer only. No adapter, no Provider call, no vendor fields.
 *
 * The adapter-bound scene-package envelope stays TEXT_TO_VIDEO and
 * FIRST_FRAME_IMAGE_TO_VIDEO. This module is the explicit execution authority.
 */
import { z } from "zod";
import { AI_STORY_EDITORIAL_SOURCE_MATERIAL_KINDS } from "./ai-story-narrative-editorial-plan";
import { AI_STORY_ENTITY_PRESENCE_DETERMINES_GENERATION_MODE } from "./ai-story-scene-execution-package";
import { AiStoryAssemblyV2SourceMediaSchema } from "./ai-story-assembly-v2";

export const AI_STORY_V2V_EXECUTION_CONTRACT_VERSION = "ai-story-v2v-execution.v1" as const;
export const AI_STORY_V2V_EXECUTION_MODE = "VIDEO_TO_VIDEO" as const;
export const AI_STORY_PROVIDER_NEUTRAL_EXECUTION_MODES = [
  "TEXT_TO_VIDEO",
  "FIRST_FRAME_IMAGE_TO_VIDEO",
  "VIDEO_TO_VIDEO",
] as const;

export const AI_STORY_V2V_SOURCE_PURPOSE = "MOTION_PLATE" as const;
export const AI_STORY_V2V_PERMISSION_AUTHORITY = "USER_CONFIRMED_AUTHORIZED_USE" as const;
export const AI_STORY_V2V_PERMISSION_STATEMENT =
  "I confirm I have permission to use this video." as const;
export const AI_STORY_V2V_TRANSFORMATION_INTENT =
  "KEEP_SOURCE_MOTION_CHANGE_CHARACTER" as const;
export const AI_STORY_V2V_TARGET_CLASS = "SYNTHETIC_REUSABLE_CHARACTER" as const;
export const AI_STORY_V2V_GENERATIVE_UNIT_TYPE = "PROVIDER_VIDEO" as const;
export const AI_STORY_V2V_EXISTING_VIDEO_SEMANTICS =
  "NON_GENERATIVE_EXISTING_MEDIA" as const;
export const AI_STORY_V2V_EXISTING_VIDEO_DISPATCHES_PROVIDER = false as const;
export const AI_STORY_V2V_PROVIDER_SOURCE_ROLE = "PROVIDER_SOURCE_VIDEO" as const;
export const AI_STORY_V2V_CONTINUITY_ROLE = "STORY_CONTINUITY_REFERENCE" as const;
export const AI_STORY_V2V_CONTINUITY_REFERENCE_IS_WIRE_SOURCE = false as const;
export const AI_STORY_V2V_SOURCE_VIDEO_COUNT = 1 as const;
export const AI_STORY_V2V_ADDITIONAL_REFERENCE_VIDEOS = "NOT_CERTIFIED" as const;
export const AI_STORY_V2V_REFERENCE_IMAGE_SEMANTICS = "NOT_CERTIFIED" as const;
export const AI_STORY_V2V_DURATION_RELATIONSHIP =
  "OUTPUT_DURATION_FOLLOWS_SOURCE" as const;
export const AI_STORY_V2V_AUDIO_AUTHORITY = "SOURCE_AUDIO_REMOVED" as const;
export const AI_STORY_V2V_PROVIDER_OUTPUT_AUDIO_AUTHORITY = "NONE" as const;
export const AI_STORY_V2V_NATIVE_DIALOGUE = "NOT_CERTIFIED" as const;
export const AI_STORY_V2V_RETRY = "NOT_CERTIFIED" as const;
export const AI_STORY_V2V_PRODUCT_REPLACEMENT = "POST_V1" as const;
export const AI_STORY_V2V_STRUCTURAL_ENVIRONMENT_REPLACEMENT = "POST_V1" as const;
export const AI_STORY_V2V_SOURCE_PERSON_IDENTITY = "NOT_RECORDED" as const;
export const AI_STORY_V2V_BIOMETRIC_IDENTITY = "NONE" as const;
export const AI_STORY_V2V_FACE_RECOGNITION = "NONE" as const;
export const AI_STORY_V2V_EDITORIAL_SOURCE_KIND = "GENERATED_VIDEO" as const;
export const AI_STORY_V2V_COST_ESTIMATE_IS_AUTHORIZATION = false as const;
export const AI_STORY_V2V_CONTRACT_PROVIDER_CALLS = 0 as const;
export const AI_STORY_V2V_CONTRACT_PROVIDER_COST_USD = 0 as const;
export const AI_STORY_V2V_CONTRACT_PRODUCTION_MUTATION = 0 as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export class AiStoryV2vContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryV2vContractError";
  }
}

export const AiStoryV2vSourceVideoAuthoritySchema = z.object({
  sourceVideoAssetId: Id,
  sourceVideoContentHash: Hash,
  durationMs: z.number().int().positive(),
  durationSec: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  hasAudio: z.boolean(),
  orgId: Id,
  workspaceId: Id,
  campaignId: Id,
  sourcePurpose: z.literal(AI_STORY_V2V_SOURCE_PURPOSE),
  sourceVideoCount: z.literal(AI_STORY_V2V_SOURCE_VIDEO_COUNT),
  permissionAuthority: z.literal(AI_STORY_V2V_PERMISSION_AUTHORITY),
  permissionStatement: z.literal(AI_STORY_V2V_PERMISSION_STATEMENT),
  frozenAt: z.string().datetime(),
}).strict().superRefine((value, ctx) => {
  if (Math.abs(value.durationSec * 1000 - value.durationMs) > 0.5) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["durationSec"],
      message: "durationSec must describe the same interval as durationMs",
    });
  }
});

export const AiStoryV2vTargetCharacterAuthoritySchema = z.object({
  targetClass: z.literal(AI_STORY_V2V_TARGET_CLASS),
  reusableCharacterId: Id,
  reusableCharacterVersionId: Id,
  identityFingerprint: Hash,
  characterDnaFingerprint: Hash.optional(),
}).strict();

export const AiStoryV2vExecutionAuthoritySchema = z.object({
  contractVersion: z.literal(AI_STORY_V2V_EXECUTION_CONTRACT_VERSION),
  executionMode: z.literal(AI_STORY_V2V_EXECUTION_MODE),
  generationUnitId: Id,
  unitType: z.literal(AI_STORY_V2V_GENERATIVE_UNIT_TYPE),
  providerSourceRole: z.literal(AI_STORY_V2V_PROVIDER_SOURCE_ROLE),
  sourceVideo: AiStoryV2vSourceVideoAuthoritySchema,
  targetCharacter: AiStoryV2vTargetCharacterAuthoritySchema,
  transformationIntent: z.literal(AI_STORY_V2V_TRANSFORMATION_INTENT),
  durationRelationship: z.literal(AI_STORY_V2V_DURATION_RELATIONSHIP),
  outputDurationMs: z.number().int().positive(),
  audioAuthority: z.literal(AI_STORY_V2V_AUDIO_AUTHORITY),
  sourceHasAudio: z.boolean(),
  providerOutputAudioAuthority: z.literal(AI_STORY_V2V_PROVIDER_OUTPUT_AUDIO_AUTHORITY),
  additionalReferenceVideoCount: z.literal(0),
  referenceImageSemantics: z.literal(AI_STORY_V2V_REFERENCE_IMAGE_SEMANTICS),
  commercialAuthorizationId: Id,
  authorizedAt: z.string().datetime(),
  fingerprint: Hash,
}).strict().superRefine((value, ctx) => {
  if (value.outputDurationMs !== value.sourceVideo.durationMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["outputDurationMs"],
      message: "OUTPUT_DURATION_FOLLOWS_SOURCE",
    });
  }
  if (value.sourceHasAudio !== value.sourceVideo.hasAudio) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceHasAudio"],
      message: "sourceHasAudio must match the frozen source video",
    });
  }
  if (value.targetCharacter.reusableCharacterId === value.sourceVideo.sourceVideoAssetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetCharacter", "reusableCharacterId"],
      message: "Target Character authority is separate from the source motion plate",
    });
  }
});

export const AiStoryV2vCostEstimateInputSchema = z.object({
  providerId: z.string().trim().min(1).max(80),
  modelId: z.string().trim().min(1).max(120),
  sourceDurationMs: z.number().int().positive(),
  outputDurationMs: z.number().int().positive(),
  resolution: z.string().trim().min(1).max(32),
  referenceCount: z.number().int().nonnegative(),
}).strict().superRefine((value, ctx) => {
  if (value.outputDurationMs !== value.sourceDurationMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["outputDurationMs"],
      message: "OUTPUT_DURATION_FOLLOWS_SOURCE",
    });
  }
});

export type AiStoryV2vSourceVideoAuthority = z.infer<typeof AiStoryV2vSourceVideoAuthoritySchema>;
export type AiStoryV2vTargetCharacterAuthority = z.infer<typeof AiStoryV2vTargetCharacterAuthoritySchema>;
export type AiStoryV2vExecutionAuthority = z.infer<typeof AiStoryV2vExecutionAuthoritySchema>;
export type AiStoryV2vCostEstimateInput = z.infer<typeof AiStoryV2vCostEstimateInputSchema>;
export type AiStoryProviderNeutralExecutionMode =
  (typeof AI_STORY_PROVIDER_NEUTRAL_EXECUTION_MODES)[number];

export function resolveExplicitProviderNeutralExecutionMode(input: {
  explicitMode?: AiStoryProviderNeutralExecutionMode;
  sourceVideoPresent?: boolean;
}): AiStoryProviderNeutralExecutionMode {
  if (AI_STORY_ENTITY_PRESENCE_DETERMINES_GENERATION_MODE) {
    throw new AiStoryV2vContractError(
      "ENTITY_PRESENCE_MUST_NOT_SELECT_MODE",
      "Source media presence must not select an execution mode",
    );
  }
  if (!input.explicitMode) {
    throw new AiStoryV2vContractError(
      "EXPLICIT_EXECUTION_MODE_REQUIRED",
      input.sourceVideoPresent
        ? "A source video does not select VIDEO_TO_VIDEO. Freeze an explicit execution mode."
        : "An explicit execution mode is required",
    );
  }
  return input.explicitMode;
}

export function assertOutputDurationFollowsSource(
  sourceDurationMs: number,
  requestedOutputDurationMs: number,
): number {
  if (requestedOutputDurationMs !== sourceDurationMs) {
    throw new AiStoryV2vContractError(
      "V2V_SILENT_TRIM_FORBIDDEN",
      "Output duration follows the source. Trim only by freezing a derived source asset before authorization.",
    );
  }
  return sourceDurationMs;
}

export function continuityReferenceIsProviderWire(
  role: typeof AI_STORY_V2V_PROVIDER_SOURCE_ROLE | typeof AI_STORY_V2V_CONTINUITY_ROLE,
): boolean {
  return role === AI_STORY_V2V_PROVIDER_SOURCE_ROLE;
}

export function bindV2vExecutionToProviderVideoUnit<
  T extends { unitType: string; generationUnitId: string },
>(
  unit: T,
  authority: Pick<AiStoryV2vExecutionAuthority, "generationUnitId" | "fingerprint" | "unitType" | "executionMode">,
): T & { v2vExecutionFingerprint: string } {
  if (unit.unitType === "EXISTING_VIDEO") {
    throw new AiStoryV2vContractError(
      "EXISTING_VIDEO_NON_GENERATIVE",
      "EXISTING_VIDEO uses existing media downstream and must not dispatch a generative Provider",
    );
  }
  if (unit.unitType !== "PROVIDER_VIDEO" || authority.unitType !== "PROVIDER_VIDEO" || authority.executionMode !== "VIDEO_TO_VIDEO") {
    throw new AiStoryV2vContractError(
      "V2V_UNIT_TYPE_INVALID",
      "VIDEO_TO_VIDEO binds only a PROVIDER_VIDEO Generation Unit",
    );
  }
  if (unit.generationUnitId !== authority.generationUnitId) {
    throw new AiStoryV2vContractError(
      "V2V_UNIT_BINDING_MISMATCH",
      "Source authority must bind the same Generation Unit",
    );
  }
  return { ...unit, v2vExecutionFingerprint: authority.fingerprint };
}

export function acceptedV2vResultAsAssemblySource(input: {
  sourceResultId: string;
  generationUnitId: string;
  directorShotId: string;
  sourceUri: string;
  contentHash: string;
  durationMs: number;
  width: number;
  height: number;
  frameRate: number;
}) {
  if (!(AI_STORY_EDITORIAL_SOURCE_MATERIAL_KINDS as readonly string[]).includes(AI_STORY_V2V_EDITORIAL_SOURCE_KIND)) {
    throw new AiStoryV2vContractError(
      "V2V_EDITORIAL_KIND_INCOMPATIBLE",
      "Accepted V2V output must use existing generated-video editorial semantics",
    );
  }
  return AiStoryAssemblyV2SourceMediaSchema.parse({
    sourceResultId: input.sourceResultId,
    generationUnitId: input.generationUnitId,
    directorShotId: input.directorShotId,
    sourceUri: input.sourceUri,
    contentHash: input.contentHash,
    mediaType: "video/mp4",
    acceptanceStatus: "ACCEPTED",
    durationMs: input.durationMs,
    width: input.width,
    height: input.height,
    frameRate: input.frameRate,
    nativeAvMode: "VIDEO_ONLY",
    hasAudio: false,
    semanticTimingEvidence: [],
  });
}
