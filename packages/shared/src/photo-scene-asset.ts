import { z } from "zod";
import { isUuid } from "./ids";
import { STORAGE_PATHS } from "./constants";
import {
  isCanonicalSourceContentHash,
  SourceAssetContentHashSchema,
  type SourceAssetContentHash,
} from "./source-asset-content-hash";

/** Photo Scene V1 == Creative Studio V1. Roles live in metadata; media type remains `image`. */
export const PHOTO_SCENE_ASSET_ROLES = [
  "product_source",
  "extracted_product",
  "marketing_image",
] as const;

export type PhotoSceneAssetRole = (typeof PHOTO_SCENE_ASSET_ROLES)[number];

export const PHOTO_SCENE_METADATA_VERSION = 1 as const;

export const PHOTO_SCENE_PRODUCT_IMAGE_MIMES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
] as const;

const PRODUCT_IMAGE_MIME_SET = new Set<string>(PHOTO_SCENE_PRODUCT_IMAGE_MIMES);

export const PhotoSceneAssetRoleSchema = z.enum(PHOTO_SCENE_ASSET_ROLES);

export const PhotoSceneLineageV1Schema = z
  .object({
    sourceAssetId: z.string().uuid().optional(),
    sourceContentHash: SourceAssetContentHashSchema.optional(),
    extractedAssetId: z.string().uuid().optional(),
    extractedContentHash: SourceAssetContentHashSchema.optional(),
    operation: z.enum(["product_extraction", "marketing_image_compose"]).optional(),
    sceneId: z.string().min(1).optional(),
    sceneVersion: z.string().min(1).optional(),
    sceneContentHash: SourceAssetContentHashSchema.optional(),
    presetId: z.string().min(1).optional(),
    marketingSnapshotHash: SourceAssetContentHashSchema.optional(),
    brandSnapshotHash: SourceAssetContentHashSchema.optional(),
    generationId: z.string().uuid().optional(),
    generationFingerprint: SourceAssetContentHashSchema.optional(),
  })
  .strict();

export type PhotoSceneLineageV1 = z.infer<typeof PhotoSceneLineageV1Schema>;

export const PhotoSceneMetadataV1Schema = z
  .object({
    version: z.literal(PHOTO_SCENE_METADATA_VERSION),
    role: PhotoSceneAssetRoleSchema,
    lineage: PhotoSceneLineageV1Schema.optional(),
  })
  .strict();

export type PhotoSceneMetadataV1 = z.infer<typeof PhotoSceneMetadataV1Schema>;

export const PHOTO_SCENE_SERVER_CONTROLLED_FIELDS = [
  "id",
  "orgId",
  "workspaceId",
  "contentHash",
  "storagePath",
  "photoScene.role",
  "photoScene.lineage",
] as const;

export class PhotoSceneAssetAuthorityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PhotoSceneAssetAuthorityError";
    this.code = code;
  }
}

export type PhotoSceneAssetSnapshot = {
  id: string;
  orgId: string;
  workspaceId: string;
  campaignId?: string | null;
  type: string;
  mimeType?: string | null;
  storagePath: string;
  contentHash?: string | null;
  metadata?: Record<string, unknown> | null;
  width?: number | null;
  height?: number | null;
};

export type PhotoSceneCampaignSnapshot = {
  id: string;
  orgId: string;
  workspaceId: string;
};

export function isPhotoSceneAssetRole(value: unknown): value is PhotoSceneAssetRole {
  return (
    typeof value === "string" &&
    (PHOTO_SCENE_ASSET_ROLES as readonly string[]).includes(value)
  );
}

export function isSupportedPhotoSceneProductMime(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && PRODUCT_IMAGE_MIME_SET.has(mimeType.toLowerCase().trim());
}

export function photoSceneLibraryObjectKey(
  workspaceId: string,
  assetId: string,
  ext: string
): string {
  return STORAGE_PATHS.library(workspaceId, assetId, ext);
}

export function isPublicUrlStorageIdentity(value: string): boolean {
  return /^https?:\/\//i.test(value.trim()) || value.includes("/storage/v1/object/");
}

export function isPhotoSceneTenantStoragePath(
  workspaceId: string,
  storagePath: string
): boolean {
  if (!workspaceId || !storagePath || isPublicUrlStorageIdentity(storagePath)) return false;
  if (storagePath.startsWith(`${workspaceId}/library/`)) return true;
  return storagePath.startsWith(`${workspaceId}/campaigns/`) && storagePath.includes("/source/");
}

export function isCanonicalPhotoSceneLibraryPath(
  workspaceId: string,
  assetId: string,
  storagePath: string
): boolean {
  if (!isPhotoSceneTenantStoragePath(workspaceId, storagePath)) return false;
  const file = storagePath.slice(`${workspaceId}/library/`.length);
  return file.startsWith(`${assetId}.`);
}

export function readPhotoSceneMetadata(
  metadata: Record<string, unknown> | null | undefined
): PhotoSceneMetadataV1 | null {
  const raw = metadata?.photoScene;
  const parsed = PhotoSceneMetadataV1Schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function photoSceneMetadata(
  role: PhotoSceneAssetRole,
  lineage?: PhotoSceneLineageV1
): PhotoSceneMetadataV1 {
  return lineage
    ? { version: PHOTO_SCENE_METADATA_VERSION, role, lineage }
    : { version: PHOTO_SCENE_METADATA_VERSION, role };
}

/** Strip client-controlled identity before any Photo Scene write. */
export function rejectClientPhotoSceneIdentityOverrides(input: Record<string, unknown>): {
  orgId?: unknown;
  workspaceId?: unknown;
  contentHash?: unknown;
  storagePath?: unknown;
  id?: unknown;
  photoScene?: unknown;
} {
  const rejected = {
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    contentHash: input.contentHash,
    storagePath: input.storagePath,
    id: input.id,
    photoScene: (input.metadata as Record<string, unknown> | undefined)?.photoScene ?? input.photoScene,
  };
  if (
    rejected.orgId != null ||
    rejected.workspaceId != null ||
    rejected.contentHash != null ||
    rejected.storagePath != null ||
    rejected.id != null ||
    rejected.photoScene != null
  ) {
    throw new PhotoSceneAssetAuthorityError(
      "CLIENT_IDENTITY_OVERRIDE_REJECTED",
      "Photo Scene identity, storage, hash, and lineage are server-controlled"
    );
  }
  return rejected;
}

export function assertPhotoSceneProductSource(input: {
  asset: PhotoSceneAssetSnapshot;
  expectedOrgId: string;
  expectedWorkspaceId: string;
}): SourceAssetContentHash {
  const { asset, expectedOrgId, expectedWorkspaceId } = input;
  if (!isUuid(asset.id) || !isUuid(expectedOrgId) || !isUuid(expectedWorkspaceId)) {
    throw new PhotoSceneAssetAuthorityError("VALIDATION_ERROR", "Photo Scene identity must be UUIDs");
  }
  if (asset.orgId !== expectedOrgId || asset.workspaceId !== expectedWorkspaceId) {
    throw new PhotoSceneAssetAuthorityError(
      "WORKSPACE_ISOLATION",
      "Photo Scene source does not belong to the authorized workspace"
    );
  }
  if (asset.type !== "image") {
    throw new PhotoSceneAssetAuthorityError("UNSUPPORTED_MEDIA", "Photo Scene source must be an image asset");
  }
  if (!isSupportedPhotoSceneProductMime(asset.mimeType)) {
    throw new PhotoSceneAssetAuthorityError(
      "UNSUPPORTED_MEDIA",
      "Photo Scene source MIME must be jpeg, png, or webp"
    );
  }
  if (isPublicUrlStorageIdentity(asset.storagePath)) {
    throw new PhotoSceneAssetAuthorityError(
      "PUBLIC_URL_IDENTITY",
      "Photo Scene storage identity cannot be a public URL"
    );
  }
  if (!isPhotoSceneTenantStoragePath(expectedWorkspaceId, asset.storagePath)) {
    throw new PhotoSceneAssetAuthorityError(
      "STORAGE_PREFIX",
      "Photo Scene object is outside the authorized workspace storage prefix"
    );
  }
  if (!isCanonicalSourceContentHash(asset.contentHash)) {
    throw new PhotoSceneAssetAuthorityError(
      "SOURCE_IDENTITY_NOT_FINALIZED",
      "Photo Scene source requires a server-finalized sha256 contentHash"
    );
  }
  const photoScene = readPhotoSceneMetadata(asset.metadata ?? undefined);
  if (photoScene && photoScene.role !== "product_source") {
    throw new PhotoSceneAssetAuthorityError(
      "INVALID_ROLE",
      `Asset role ${photoScene.role} is not a Photo Scene product source`
    );
  }
  return asset.contentHash;
}

export function assertSameWorkspaceCampaignBind(input: {
  asset: PhotoSceneAssetSnapshot;
  campaign: PhotoSceneCampaignSnapshot;
}): void {
  if (input.asset.orgId !== input.campaign.orgId || input.asset.workspaceId !== input.campaign.workspaceId) {
    throw new PhotoSceneAssetAuthorityError(
      "CAMPAIGN_ISOLATION",
      "Asset workspace and campaign workspace must agree"
    );
  }
  if (input.asset.workspaceId !== input.campaign.workspaceId) {
    throw new PhotoSceneAssetAuthorityError("CAMPAIGN_ISOLATION", "Cross-workspace campaign bind is denied");
  }
}

export function sourceMutationChanged(previousHash: string | null | undefined, nextHash: string): boolean {
  if (!isCanonicalSourceContentHash(previousHash)) return true;
  return previousHash !== nextHash;
}

export type PhotoSceneDerivedAssetPlan = {
  id: string;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  type: "image";
  storagePath: string;
  mimeType: string;
  contentHash: SourceAssetContentHash;
  metadata: { photoScene: PhotoSceneMetadataV1 };
  campaignRef: { campaignId: string; assetId: string };
};

export function planPhotoSceneDerivedAsset(input: {
  assetId: string;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  ext: string;
  mimeType: string;
  contentHash: string;
  role: Exclude<PhotoSceneAssetRole, "product_source">;
  lineage: PhotoSceneLineageV1;
}): PhotoSceneDerivedAssetPlan {
  if (!isUuid(input.assetId) || !isUuid(input.orgId) || !isUuid(input.workspaceId) || !isUuid(input.campaignId)) {
    throw new PhotoSceneAssetAuthorityError("VALIDATION_ERROR", "Derived Photo Scene identity must be UUIDs");
  }
  if (!isCanonicalSourceContentHash(input.contentHash)) {
    throw new PhotoSceneAssetAuthorityError("SOURCE_IDENTITY_NOT_FINALIZED", "Derived asset hash is not canonical");
  }
  if (input.role === "extracted_product" && !input.lineage.sourceAssetId) {
    throw new PhotoSceneAssetAuthorityError("LINEAGE_REQUIRED", "Extraction output requires sourceAssetId");
  }
  if (
    input.lineage.sourceAssetId &&
    input.lineage.sourceAssetId === input.assetId
  ) {
    throw new PhotoSceneAssetAuthorityError("LINEAGE_INVALID", "Derived asset cannot lineage to itself");
  }
  const storagePath = photoSceneLibraryObjectKey(input.workspaceId, input.assetId, input.ext);
  return {
    id: input.assetId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    type: "image",
    storagePath,
    mimeType: input.mimeType,
    contentHash: input.contentHash,
    metadata: {
      photoScene: photoSceneMetadata(input.role, input.lineage),
    },
    campaignRef: { campaignId: input.campaignId, assetId: input.assetId },
  };
}

export function assertLineageSourceOwnership(input: {
  derivedWorkspaceId: string;
  derivedOrgId: string;
  source: PhotoSceneAssetSnapshot;
}): void {
  if (input.source.workspaceId !== input.derivedWorkspaceId || input.source.orgId !== input.derivedOrgId) {
    throw new PhotoSceneAssetAuthorityError(
      "WORKSPACE_ISOLATION",
      "Photo Scene lineage cannot reference a foreign workspace asset"
    );
  }
}
