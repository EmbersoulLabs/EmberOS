import { z } from "zod";
import { isUuid } from "./ids";
import {
  isCanonicalSourceContentHash,
  SourceAssetContentHashSchema,
  type SourceAssetContentHash,
} from "./source-asset-content-hash";
import {
  PhotoSceneAssetAuthorityError,
  assertPhotoSceneProductSource,
  isCanonicalPhotoSceneLibraryPath,
  isPhotoSceneTenantStoragePath,
  readPhotoSceneMetadata,
  type PhotoSceneAssetSnapshot,
} from "./photo-scene-asset";

export const PHOTO_SCENE_EXTRACTION_CONTRACT = "photo-scene-extraction-v1" as const;
export const PHOTO_SCENE_EXTRACTION_CONTRACT_VERSION = 1 as const;
export const PHOTO_SCENE_EXTRACTION_POLICY = "background_removal_v1" as const;

export const PHOTO_SCENE_GENERATION_OPERATIONS = ["product_extraction", "marketing_image"] as const;
export type PhotoSceneGenerationOperation = (typeof PHOTO_SCENE_GENERATION_OPERATIONS)[number];

export const PHOTO_SCENE_GENERATION_STATUSES = ["queued", "processing", "ready", "failed"] as const;
export type PhotoSceneGenerationStatus = (typeof PHOTO_SCENE_GENERATION_STATUSES)[number];

export const PHOTO_SCENE_INFLIGHT_STATUSES = ["queued", "processing"] as const;
export type PhotoSceneInflightStatus = (typeof PHOTO_SCENE_INFLIGHT_STATUSES)[number];

export const EXTRACTION_ERROR_CATEGORIES = [
  "INVALID_SOURCE",
  "SOURCE_IDENTITY_MISSING",
  "SOURCE_OBJECT_MISSING",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_REJECTED",
  "INVALID_PROVIDER_OUTPUT",
  "STORAGE_WRITE_FAILED",
  "OUTPUT_FINALIZATION_FAILED",
  "WORKSPACE_ISOLATION",
] as const;
export type ExtractionErrorCategory = (typeof EXTRACTION_ERROR_CATEGORIES)[number];

export const USER_SAFE_EXTRACTION_FAILURE_MESSAGE =
  "Could not extract this product image. Try again or choose another image.";

export const USER_SAFE_INVALID_SOURCE_MESSAGE =
  "This image cannot be used as a product source. Choose another image.";

export const EXTRACTED_PRODUCT_MIME = "image/png";
export const EXTRACTED_PRODUCT_EXT = "png";
export const EXTRACTED_MAX_BYTES = 25 * 1024 * 1024;
export const EXTRACTED_MAX_DIMENSION = 8192;

export class PhotoSceneExtractionError extends Error {
  readonly code: ExtractionErrorCategory;

  constructor(code: ExtractionErrorCategory, message: string) {
    super(message);
    this.name = "PhotoSceneExtractionError";
    this.code = code;
  }
}

export const PhotoSceneExtractionInputCapsuleV1Schema = z
  .object({
    version: z.literal(PHOTO_SCENE_EXTRACTION_CONTRACT_VERSION),
    contract: z.literal(PHOTO_SCENE_EXTRACTION_CONTRACT),
    operation: z.literal("product_extraction"),
    policy: z.literal(PHOTO_SCENE_EXTRACTION_POLICY),
    orgId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    campaignId: z.string().uuid(),
    sourceAssetId: z.string().uuid(),
    sourceContentHash: SourceAssetContentHashSchema,
    storagePath: z.string().min(1),
    mimeType: z.string().min(1),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();

export type PhotoSceneExtractionInputCapsuleV1 = z.infer<
  typeof PhotoSceneExtractionInputCapsuleV1Schema
>;

export const PhotoSceneExtractionFingerprintIdentityV1Schema = z
  .object({
    version: z.literal(PHOTO_SCENE_EXTRACTION_CONTRACT_VERSION),
    contract: z.literal(PHOTO_SCENE_EXTRACTION_CONTRACT),
    operation: z.literal("product_extraction"),
    policy: z.literal(PHOTO_SCENE_EXTRACTION_POLICY),
    workspaceId: z.string().uuid(),
    sourceContentHash: SourceAssetContentHashSchema,
  })
  .strict();

export type PhotoSceneExtractionFingerprintIdentityV1 = z.infer<
  typeof PhotoSceneExtractionFingerprintIdentityV1Schema
>;

export function isPhotoSceneGenerationStatus(
  value: unknown
): value is PhotoSceneGenerationStatus {
  return (
    typeof value === "string" &&
    (PHOTO_SCENE_GENERATION_STATUSES as readonly string[]).includes(value)
  );
}

export function isExtractionErrorCategory(value: unknown): value is ExtractionErrorCategory {
  return (
    typeof value === "string" &&
    (EXTRACTION_ERROR_CATEGORIES as readonly string[]).includes(value)
  );
}

export function userSafeExtractionMessage(code: ExtractionErrorCategory | null | undefined): string {
  if (code === "INVALID_SOURCE" || code === "WORKSPACE_ISOLATION") {
    return USER_SAFE_INVALID_SOURCE_MESSAGE;
  }
  return USER_SAFE_EXTRACTION_FAILURE_MESSAGE;
}

export function freezePhotoSceneExtractionInput(input: {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  source: PhotoSceneAssetSnapshot;
}): PhotoSceneExtractionInputCapsuleV1 {
  const sourceContentHash = assertPhotoSceneProductSource({
    asset: input.source,
    expectedOrgId: input.orgId,
    expectedWorkspaceId: input.workspaceId,
  });
  if (!isUuid(input.campaignId)) {
    throw new PhotoSceneExtractionError("INVALID_SOURCE", "Campaign identity must be a UUID");
  }
  return PhotoSceneExtractionInputCapsuleV1Schema.parse({
    version: PHOTO_SCENE_EXTRACTION_CONTRACT_VERSION,
    contract: PHOTO_SCENE_EXTRACTION_CONTRACT,
    operation: "product_extraction",
    policy: PHOTO_SCENE_EXTRACTION_POLICY,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    sourceAssetId: input.source.id,
    sourceContentHash,
    storagePath: input.source.storagePath,
    mimeType: input.source.mimeType ?? "image/png",
    ...(typeof input.source.width === "number" && input.source.width > 0
      ? { width: input.source.width }
      : {}),
    ...(typeof input.source.height === "number" && input.source.height > 0
      ? { height: input.source.height }
      : {}),
  });
}

export function extractionFingerprintIdentity(
  capsule: PhotoSceneExtractionInputCapsuleV1
): PhotoSceneExtractionFingerprintIdentityV1 {
  return PhotoSceneExtractionFingerprintIdentityV1Schema.parse({
    version: capsule.version,
    contract: capsule.contract,
    operation: capsule.operation,
    policy: capsule.policy,
    workspaceId: capsule.workspaceId,
    sourceContentHash: capsule.sourceContentHash,
  });
}

export type PhotoSceneGenerationSnapshot = {
  id: string;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  operation: string;
  status: string;
  sourceAssetId: string;
  sourceContentHash: string;
  inputCapsule: PhotoSceneExtractionInputCapsuleV1 | Record<string, unknown>;
  inputFingerprint: string;
  outputAssetId?: string | null;
  providerKey?: string | null;
  attemptCount: number;
  errorCode?: string | null;
  boundedError?: string | null;
  costUsd?: string | number | null;
};

export function assertPhotoSceneGenerationAccess(input: {
  generation: Pick<PhotoSceneGenerationSnapshot, "orgId" | "workspaceId">;
  expectedOrgId: string;
  expectedWorkspaceId: string;
}): void {
  if (
    input.generation.orgId !== input.expectedOrgId ||
    input.generation.workspaceId !== input.expectedWorkspaceId
  ) {
    throw new PhotoSceneExtractionError(
      "WORKSPACE_ISOLATION",
      "Photo Scene generation does not belong to the authorized workspace"
    );
  }
}

export type ExtractionReuseCandidate = {
  generation: PhotoSceneGenerationSnapshot;
  outputAsset: PhotoSceneAssetSnapshot | null;
};

export type ExtractionReuseDecision =
  | { reuse: true; generationId: string }
  | { reuse: false; reason: "NO_CANDIDATE" | "FAILED" | "NOT_READY" | "MISSING_OUTPUT" | "INCOMPATIBLE" | "FOREIGN_WORKSPACE" | "HASH_MISMATCH" };

export function evaluateExtractionReuse(input: {
  workspaceId: string;
  fingerprint: string;
  sourceContentHash: SourceAssetContentHash;
  candidate: ExtractionReuseCandidate | null;
}): ExtractionReuseDecision {
  if (!input.candidate) return { reuse: false, reason: "NO_CANDIDATE" };
  const { generation, outputAsset } = input.candidate;
  if (generation.workspaceId !== input.workspaceId) {
    return { reuse: false, reason: "FOREIGN_WORKSPACE" };
  }
  if (generation.status === "failed") return { reuse: false, reason: "FAILED" };
  if (generation.status !== "ready") return { reuse: false, reason: "NOT_READY" };
  if (generation.inputFingerprint !== input.fingerprint) {
    return { reuse: false, reason: "INCOMPATIBLE" };
  }
  if (generation.sourceContentHash !== input.sourceContentHash) {
    return { reuse: false, reason: "HASH_MISMATCH" };
  }
  if (!outputAsset || !generation.outputAssetId || outputAsset.id !== generation.outputAssetId) {
    return { reuse: false, reason: "MISSING_OUTPUT" };
  }
  if (outputAsset.workspaceId !== input.workspaceId) {
    return { reuse: false, reason: "FOREIGN_WORKSPACE" };
  }
  const role = readPhotoSceneMetadata(outputAsset.metadata ?? undefined)?.role;
  if (role !== "extracted_product") return { reuse: false, reason: "INCOMPATIBLE" };
  if (!isCanonicalSourceContentHash(outputAsset.contentHash)) {
    return { reuse: false, reason: "MISSING_OUTPUT" };
  }
  if (!isPhotoSceneTenantStoragePath(input.workspaceId, outputAsset.storagePath)) {
    return { reuse: false, reason: "MISSING_OUTPUT" };
  }
  if (
    !isCanonicalPhotoSceneLibraryPath(input.workspaceId, outputAsset.id, outputAsset.storagePath)
  ) {
    return { reuse: false, reason: "MISSING_OUTPUT" };
  }
  return { reuse: true, generationId: generation.id };
}

export type ExtractionRetryDecision =
  | { ok: true }
  | { ok: false; reason: "NOT_FAILED" | "FROZEN_INPUT_CHANGED" | "FOREIGN_WORKSPACE" };

export function evaluateExtractionRetry(input: {
  generation: PhotoSceneGenerationSnapshot;
  expectedWorkspaceId: string;
  expectedFingerprint: string;
  expectedSourceAssetId: string;
  expectedSourceContentHash: string;
}): ExtractionRetryDecision {
  if (input.generation.workspaceId !== input.expectedWorkspaceId) {
    return { ok: false, reason: "FOREIGN_WORKSPACE" };
  }
  if (input.generation.status !== "failed") return { ok: false, reason: "NOT_FAILED" };
  if (
    input.generation.inputFingerprint !== input.expectedFingerprint ||
    input.generation.sourceAssetId !== input.expectedSourceAssetId ||
    input.generation.sourceContentHash !== input.expectedSourceContentHash
  ) {
    return { ok: false, reason: "FROZEN_INPUT_CHANGED" };
  }
  return { ok: true };
}

export function evaluateGenerateAgain(input: {
  previousFingerprint: string;
  nextFingerprint: string;
}): { newGenerationRequired: boolean } {
  return { newGenerationRequired: input.previousFingerprint !== input.nextFingerprint };
}

export function clientPollCannotDeclareFailure(): false {
  return false;
}

export type InflightGenerationJoin = {
  join: true;
  generationId: string;
  status: PhotoSceneInflightStatus;
};

export function joinInflightExtraction(input: {
  workspaceId: string;
  fingerprint: string;
  candidate: PhotoSceneGenerationSnapshot | null;
}): InflightGenerationJoin | { join: false } {
  if (!input.candidate) return { join: false };
  if (input.candidate.workspaceId !== input.workspaceId) return { join: false };
  if (input.candidate.inputFingerprint !== input.fingerprint) return { join: false };
  if (
    input.candidate.status === "queued" ||
    input.candidate.status === "processing"
  ) {
    return {
      join: true,
      generationId: input.candidate.id,
      status: input.candidate.status,
    };
  }
  return { join: false };
}

export function extractedProductLineage(input: {
  sourceAssetId: string;
  sourceContentHash: SourceAssetContentHash;
  generationId: string;
  generationFingerprint: SourceAssetContentHash;
}): {
  sourceAssetId: string;
  sourceContentHash: SourceAssetContentHash;
  operation: "product_extraction";
  generationId: string;
  generationFingerprint: SourceAssetContentHash;
} {
  return {
    sourceAssetId: input.sourceAssetId,
    sourceContentHash: input.sourceContentHash,
    operation: "product_extraction",
    generationId: input.generationId,
    generationFingerprint: input.generationFingerprint,
  };
}

export { PhotoSceneAssetAuthorityError };
