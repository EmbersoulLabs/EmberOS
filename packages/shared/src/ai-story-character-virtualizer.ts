import { z } from "zod";
import {
  AI_STORY_REUSABLE_CHARACTER_ASSET_ROLES,
  publicReusableCharacterCard,
  type AiStoryReusableCharacterCard,
  type AiStoryReusableCharacterVersion,
} from "./ai-story-reusable-character";

export const AI_STORY_CHARACTER_VIRTUALIZER_CONTRACT_VERSION =
  "ai-story-character-virtualizer.v1" as const;
export const AI_STORY_CHARACTER_VIRTUALIZER_V1 = "BUILT" as const;
export const SOURCE_PORTRAIT = "SOURCE_PORTRAIT" as const;
export const CHARACTER_SOURCE_PORTRAIT = "CHARACTER_SOURCE_PORTRAIT" as const;
export const VIRTUAL_CHARACTER_CANDIDATE = "VIRTUAL_CHARACTER_CANDIDATE" as const;
export const CANONICAL_CHARACTER_IDENTITY = "CANONICAL_CHARACTER_IDENTITY" as const;
export const CHARACTER_VIRTUALIZATION = "CHARACTER_VIRTUALIZATION" as const;
export const EPISODE_GENERATION = "EPISODE_GENERATION" as const;
export const NO_BIOMETRIC_IDENTITY_SCORES = true as const;
export const NO_AUTOMATIC_VIRTUALIZATION_RETRY = true as const;
export const CHARACTER_VIRTUALIZER_REAL_IMAGE_PROVIDER_CALLS = 0 as const;
export const CHARACTER_VIRTUALIZER_SEEDANCE_VIDEO_CALLS = 0 as const;
export const CHARACTER_VIRTUALIZATION_PROVIDER_MODES = ["mock", "creative-image"] as const;
export const CHARACTER_VIRTUALIZATION_OPENAI_PROVIDER = "openai" as const;
export const CHARACTER_VIRTUALIZATION_OPENAI_MODEL = "gpt-image-2" as const;
export const CHARACTER_VIRTUALIZATION_OPENAI_OPERATION = "images.edit" as const;
export const CHARACTER_VIRTUALIZATION_MAX_RETRIES = 0 as const;
export const CHARACTER_VIRTUALIZATION_SOURCE_REFERENCE_ROLE = "INPUT_IMAGE" as const;
export const CHARACTER_VIRTUALIZATION_OUTPUT = Object.freeze({
  mimeType: "image/png" as const,
  width: 1024,
  height: 1536,
  sizeConstraint: "1024x1536" as const,
  /** Maps to OpenAI images.edit quality=medium through the shared Creative Image adapter. */
  quality: "STANDARD" as const,
});

export const AI_STORY_CHARACTER_VIRTUAL_STYLES = [
  "PREMIUM_3D",
  "STYLIZED_CGI",
  "ILLUSTRATED",
] as const;
export const AI_STORY_CHARACTER_VISUAL_CLASSES = [
  "PHOTOREALISTIC_SOURCE",
  "SYNTHETIC_3D",
  "STYLIZED_CGI",
  "ILLUSTRATED",
] as const;
export const AI_STORY_CHARACTER_VIRTUALIZATION_JOB_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "REJECTED",
] as const;
export const AI_STORY_CHARACTER_VIRTUALIZATION_ACCEPTANCE = [
  "NOT_READY",
  "VIRTUAL_CHARACTER_CANDIDATE",
  "ACCEPTED",
  "DISCARDED",
] as const;
export const AI_STORY_CHARACTER_VIRTUALIZATION_ASSET_SEMANTICS = [
  CHARACTER_SOURCE_PORTRAIT,
  VIRTUAL_CHARACTER_CANDIDATE,
  "ACCEPTED_VIRTUAL_IDENTITY_MASTER",
] as const;

export const DEFAULT_CHARACTER_VIRTUAL_STYLE = "PREMIUM_3D" as const;
export const CHARACTER_SOURCE_PORTRAIT_MAX_BYTES = 20 * 1024 * 1024;
export const CHARACTER_SOURCE_PORTRAIT_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
] as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Money = z.string().regex(/^\d+(\.\d{1,4})?$/);

export const AiStoryCharacterVirtualStyleSchema = z.enum(AI_STORY_CHARACTER_VIRTUAL_STYLES);
export const AiStoryCharacterVisualClassSchema = z.enum(AI_STORY_CHARACTER_VISUAL_CLASSES);

export const AiStoryCharacterVirtualizationCostEstimateSchema = z
  .object({
    category: z.literal(CHARACTER_VIRTUALIZATION),
    currency: z.literal("USD"),
    estimatedExpected: Money,
    estimatedMin: Money,
    estimatedMax: Money,
    requiresExplicitAuthorization: z.literal(true),
    automaticRetry: z.literal(false),
  })
  .strict();

export const AiStoryCharacterVirtualizationJobSchema = z
  .object({
    id: Id,
    orgId: Id,
    workspaceId: Id,
    sourceAssetId: Id,
    sourceContentHash: Hash,
    sourceSemantic: z.literal(CHARACTER_SOURCE_PORTRAIT),
    style: AiStoryCharacterVirtualStyleSchema,
    visualClass: AiStoryCharacterVisualClassSchema,
    creativeDirection: z.string().trim().max(500).nullable(),
    permissionConfirmed: z.literal(true),
    status: z.enum(AI_STORY_CHARACTER_VIRTUALIZATION_JOB_STATUSES),
    acceptanceStatus: z.enum(AI_STORY_CHARACTER_VIRTUALIZATION_ACCEPTANCE),
    provider: z.string().min(1).max(80),
    providerModel: z.string().min(1).max(120),
    providerAttemptId: Id.nullable(),
    promptFingerprint: Hash.nullable(),
    outputAssetId: Id.nullable(),
    outputContentHash: Hash.nullable(),
    outputSemantic: z.enum(AI_STORY_CHARACTER_VIRTUALIZATION_ASSET_SEMANTICS).nullable(),
    costCategory: z.literal(CHARACTER_VIRTUALIZATION),
    costUsd: Money.nullable(),
    parentJobId: Id.nullable(),
    automaticRetry: z.literal(false),
    reusableCharacterId: Id.nullable(),
    reusableCharacterVersionId: Id.nullable(),
    seedanceVideoCalls: z.literal(0),
    realImageProviderCalls: z.union([z.literal(0), z.literal(1)]),
    userSafeError: z.string().max(500).nullable(),
    createdBy: Id,
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    contractVersion: z.literal(AI_STORY_CHARACTER_VIRTUALIZER_CONTRACT_VERSION),
  })
  .strict();

export const AiStoryCharacterVirtualizationLineageSchema = z
  .object({
    sourcePortraitAssetId: Id,
    sourcePortraitContentHash: Hash,
    sourceSemantic: z.literal(CHARACTER_SOURCE_PORTRAIT),
    virtualizationJobId: Id,
    virtualOutputAssetId: Id.nullable(),
    virtualOutputContentHash: Hash.nullable(),
    virtualOutputRole: z.enum(["VIRTUAL_CHARACTER_CANDIDATE", "IDENTITY_MASTER"]).nullable(),
    reusableCharacterId: Id.nullable(),
    reusableCharacterVersionId: Id.nullable(),
    identityMasterAssetId: Id.nullable(),
    identityMasterContentHash: Hash.nullable(),
  })
  .strict();

export const AiStoryCharacterVirtualizationPublicJobSchema = AiStoryCharacterVirtualizationJobSchema.omit({
  promptFingerprint: true,
}).extend({
  compiledProviderPrompt: z.undefined().optional(),
});

export type AiStoryCharacterVirtualStyle = z.infer<typeof AiStoryCharacterVirtualStyleSchema>;
export type AiStoryCharacterVisualClass = z.infer<typeof AiStoryCharacterVisualClassSchema>;
export type AiStoryCharacterVirtualizationCostEstimate = z.infer<
  typeof AiStoryCharacterVirtualizationCostEstimateSchema
>;
export type AiStoryCharacterVirtualizationJob = z.infer<typeof AiStoryCharacterVirtualizationJobSchema>;
export type AiStoryCharacterVirtualizationLineage = z.infer<typeof AiStoryCharacterVirtualizationLineageSchema>;
export type AiStoryCharacterVirtualizationPublicJob = z.infer<
  typeof AiStoryCharacterVirtualizationPublicJobSchema
>;

export type CharacterVirtualizationProviderMode =
  (typeof CHARACTER_VIRTUALIZATION_PROVIDER_MODES)[number];

export type CharacterVirtualizationProviderAuthorization = {
  authorizationId: string;
  executionIdentity: string;
  idempotencyKey: string;
  scope: { tenantId: string; workspaceId: string };
  authorizedBy: string;
  authorizedAt: string;
  maximumProviderCalls: 1;
};

export type CharacterVirtualizationProviderRequest = {
  sourceImage: {
    assetId: string;
    contentHash: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    bytes?: Uint8Array;
  };
  style: AiStoryCharacterVirtualStyle;
  creativeDirection: string | null;
  compiledPrompt: string;
  outputRequirements: { mimeType: "image/png"; width: number; height: number };
  authorization?: CharacterVirtualizationProviderAuthorization;
};

export type CharacterVirtualizationProviderSuccess = {
  ok: true;
  bytes: Uint8Array;
  mimeType: "image/png";
  width: number;
  height: number;
  provider: string;
  providerModel: string;
  providerAttemptId: string;
  contentHash: string;
  operation?: typeof CHARACTER_VIRTUALIZATION_OPENAI_OPERATION;
  retries?: typeof CHARACTER_VIRTUALIZATION_MAX_RETRIES;
  realImageProviderCalls: 0 | 1;
  costUsd: string | null;
};

export type CharacterVirtualizationProviderFailure = {
  ok: false;
  code: "PROVIDER_REJECTED" | "PROVIDER_UNAVAILABLE" | "PROVIDER_RESULT_INVALID" | "OUTPUT_PERSIST_FAILED";
  userSafeMessage: string;
  provider: string;
  providerModel: string;
  providerAttemptId: string;
  realImageProviderCalls: 0 | 1;
  costUsd?: string | null;
};

export type CharacterVirtualizationProviderResult =
  | CharacterVirtualizationProviderSuccess
  | CharacterVirtualizationProviderFailure;

export interface CharacterVirtualizationProvider {
  readonly providerId: string;
  readonly providerModel: string;
  readonly externalPaidCall: boolean;
  virtualizeCharacter(
    request: CharacterVirtualizationProviderRequest
  ): Promise<CharacterVirtualizationProviderResult>;
}

export class AiStoryCharacterVirtualizerError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AiStoryCharacterVirtualizerError";
  }
}

export const AI_STORY_CHARACTER_VIRTUALIZER_COPY = Object.freeze({
  createCharacter: "Create Character",
  createFromPhoto: "Create from Photo",
  createVirtualCharacter: "Create Virtual Character",
  uploadPhoto: "Upload Photo",
  permissionConfirm: "I confirm I have permission to use this photo.",
  premium3d: "Premium 3D",
  stylizedCgi: "Stylized CGI",
  illustrated: "Illustrated",
  creativeDirection: "Optional creative direction",
  generate: "Create Virtual Character",
  generateAgain: "Generate Again",
  useThisCharacter: "Use This Character",
  saveCharacter: "Save Character",
  sourcePhoto: "Source photo",
  virtualCharacter: "Virtual Character",
  identityLocked: "Identity locked",
  identityMaster: "Identity Master",
  advancedSetup: "Advanced Character Setup",
  estimatedCost: "Estimated Character creation cost",
  providerRejected: "This photo could not be turned into a virtual Character. No Character was created.",
  additionalReferences: "Additional references",
});

export function visualClassForVirtualStyle(style: AiStoryCharacterVirtualStyle): AiStoryCharacterVisualClass {
  if (style === "PREMIUM_3D") return "SYNTHETIC_3D";
  if (style === "STYLIZED_CGI") return "STYLIZED_CGI";
  return "ILLUSTRATED";
}

export function characterVirtualizationCostEstimate(
  style: AiStoryCharacterVirtualStyle = DEFAULT_CHARACTER_VIRTUAL_STYLE
): AiStoryCharacterVirtualizationCostEstimate {
  const expected = style === "PREMIUM_3D" ? "0.04" : style === "STYLIZED_CGI" ? "0.03" : "0.02";
  return AiStoryCharacterVirtualizationCostEstimateSchema.parse({
    category: CHARACTER_VIRTUALIZATION,
    currency: "USD",
    estimatedExpected: expected,
    estimatedMin: "0.02",
    estimatedMax: "0.06",
    requiresExplicitAuthorization: true,
    automaticRetry: false,
  });
}

export function isCharacterSourcePortraitMime(mimeType: string | null | undefined) {
  return CHARACTER_SOURCE_PORTRAIT_MIME_TYPES.includes(
    (mimeType ?? "").toLowerCase() as (typeof CHARACTER_SOURCE_PORTRAIT_MIME_TYPES)[number]
  );
}

export function validateCharacterSourcePortrait(input: {
  type: string;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  semantic?: string | null;
  role?: string | null;
}): { ok: true } | { ok: false; code: string; message: string } {
  if (input.type !== "image") {
    return { ok: false, code: "SOURCE_PORTRAIT_INVALID", message: "Upload a single portrait photo." };
  }
  if (!isCharacterSourcePortraitMime(input.mimeType)) {
    return { ok: false, code: "SOURCE_PORTRAIT_INVALID", message: "Use a JPEG, PNG, or WebP portrait." };
  }
  if ((input.fileSizeBytes ?? 0) <= 0 || (input.fileSizeBytes ?? 0) > CHARACTER_SOURCE_PORTRAIT_MAX_BYTES) {
    return { ok: false, code: "SOURCE_PORTRAIT_TOO_LARGE", message: "Portrait exceeds the supported file-size limit." };
  }
  if (input.role === "IDENTITY_MASTER" || input.semantic === "IDENTITY_MASTER") {
    return {
      ok: false,
      code: "SOURCE_PORTRAIT_NOT_IDENTITY_MASTER",
      message: "A source portrait cannot be used as Character identity.",
    };
  }
  return { ok: true };
}

export function publicVirtualizationJob(
  job: AiStoryCharacterVirtualizationJob
): AiStoryCharacterVirtualizationPublicJob {
  const { promptFingerprint: _hidden, ...publicJob } = job;
  return AiStoryCharacterVirtualizationPublicJobSchema.parse(publicJob);
}

export function compileVirtualizationLineage(
  job: Pick<
    AiStoryCharacterVirtualizationJob,
    | "id"
    | "sourceAssetId"
    | "sourceContentHash"
    | "outputAssetId"
    | "outputContentHash"
    | "acceptanceStatus"
    | "reusableCharacterId"
    | "reusableCharacterVersionId"
  >
): AiStoryCharacterVirtualizationLineage {
  const accepted = job.acceptanceStatus === "ACCEPTED";
  return AiStoryCharacterVirtualizationLineageSchema.parse({
    sourcePortraitAssetId: job.sourceAssetId,
    sourcePortraitContentHash: job.sourceContentHash,
    sourceSemantic: CHARACTER_SOURCE_PORTRAIT,
    virtualizationJobId: job.id,
    virtualOutputAssetId: job.outputAssetId,
    virtualOutputContentHash: job.outputContentHash,
    virtualOutputRole: job.outputAssetId
      ? accepted
        ? "IDENTITY_MASTER"
        : "VIRTUAL_CHARACTER_CANDIDATE"
      : null,
    reusableCharacterId: job.reusableCharacterId,
    reusableCharacterVersionId: job.reusableCharacterVersionId,
    identityMasterAssetId: accepted ? job.outputAssetId : null,
    identityMasterContentHash: accepted ? job.outputContentHash : null,
  });
}

export function sourcePortraitCannotReplaceCanonicalOutput(input: {
  sourceAssetId: string;
  sourceContentHash: string;
  identityMasterAssetId: string;
  identityMasterContentHash: string;
}) {
  return (
    input.sourceAssetId !== input.identityMasterAssetId &&
    input.sourceContentHash !== input.identityMasterContentHash
  );
}

export function evaluateSourcePortraitDeletion(input: {
  sourceAssetId: string;
  identityMasterAssetId: string | null;
  acceptedCharacterExists: boolean;
}): { allowed: boolean; characterPreserved: boolean; code: string } {
  if (input.identityMasterAssetId && input.sourceAssetId === input.identityMasterAssetId) {
    return {
      allowed: false,
      characterPreserved: true,
      code: "IDENTITY_MASTER_RETAINED",
    };
  }
  if (input.acceptedCharacterExists) {
    return { allowed: true, characterPreserved: true, code: "SOURCE_PORTRAIT_DETACHED" };
  }
  return { allowed: true, characterPreserved: true, code: "SOURCE_PORTRAIT_ONLY" };
}

export function virtualCharacterLibraryCard(
  version: Pick<AiStoryReusableCharacterVersion, "reusableCharacterId" | "name" | "canonicalAssets" | "status">,
  episodeCount: number,
  extras?: { visualClass?: AiStoryCharacterVisualClass; virtualStyle?: AiStoryCharacterVirtualStyle }
): AiStoryReusableCharacterCard & {
  visualClass?: AiStoryCharacterVisualClass;
  virtualStyle?: AiStoryCharacterVirtualStyle;
  identityLocked: true;
} {
  return {
    ...publicReusableCharacterCard(version, episodeCount),
    ...(extras?.visualClass ? { visualClass: extras.visualClass } : {}),
    ...(extras?.virtualStyle ? { virtualStyle: extras.virtualStyle } : {}),
    identityLocked: true,
  };
}

export function additionalReferenceRoles() {
  return AI_STORY_REUSABLE_CHARACTER_ASSET_ROLES.filter((role) => role !== "IDENTITY_MASTER");
}

export function readCharacterVirtualizationProviderMode(
  env: NodeJS.ProcessEnv = process.env
): CharacterVirtualizationProviderMode {
  const raw = (env.CHARACTER_VIRTUALIZATION_PROVIDER ?? "mock").trim().toLowerCase();
  if (raw === "mock" || raw === "") return "mock";
  if (raw === "creative-image") return "creative-image";
  throw new AiStoryCharacterVirtualizerError(
    "VIRTUALIZATION_PROVIDER_INVALID",
    "Character virtualization Provider configuration is invalid."
  );
}

export function characterVirtualizationUserSafeFailure(code: CharacterVirtualizationProviderFailure["code"]) {
  if (code === "PROVIDER_REJECTED") {
    return AI_STORY_CHARACTER_VIRTUALIZER_COPY.providerRejected;
  }
  return "Character creation could not be completed. No Character was created.";
}

export function assertCandidateRequiresAcceptance(job: Pick<AiStoryCharacterVirtualizationJob, "status" | "acceptanceStatus" | "reusableCharacterId">) {
  if (job.status === "SUCCEEDED" && job.acceptanceStatus === "VIRTUAL_CHARACTER_CANDIDATE" && !job.reusableCharacterId) {
    return true;
  }
  return false;
}
