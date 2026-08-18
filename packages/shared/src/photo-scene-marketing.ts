import { z } from "zod";
import {
  PhotoSceneFrozenSceneSelectionV1Schema,
  PhotoSceneOfficialSceneError,
  PhotoSceneOutputPresetIdSchema,
  PhotoSceneSafeAreaV1Schema,
  PHOTO_SCENE_OUTPUT_PRESET_PIXELS,
  assertPlacementAgainstScene,
  type OfficialSceneVersionSnapshot,
  type PhotoSceneFrozenSceneSelectionV1,
  type PhotoSceneOutputPresetId,
} from "./photo-scene-official-scene";
import { isPublicUrlStorageIdentity, readPhotoSceneMetadata } from "./photo-scene-asset";
import {
  SourceAssetContentHashSchema,
  isCanonicalSourceContentHash,
  type SourceAssetContentHash,
} from "./source-asset-content-hash";
import { freezeLogoObjectReference } from "./business-branding-storage";
import { isUuid } from "./ids";

export const PHOTO_SCENE_MARKETING_CONTRACT = "photo-scene-marketing-image-v1" as const;
export const PHOTO_SCENE_MARKETING_CONTRACT_VERSION = 1 as const;
export const PHOTO_SCENE_MARKETING_POLICY = "deterministic_compositor_v1" as const;
export const DETERMINISTIC_COMPOSITOR_KEY = "deterministic_compositor";
export const MARKETING_IMAGE_MIME = "image/png";
export const MARKETING_IMAGE_EXT = "png";
export const MARKETING_COMPOSITION_EXTERNAL_COST_USD = 0;

export const USER_SAFE_MARKETING_FAILURE_MESSAGE =
  "Could not generate this marketing image. Try again or change the scene.";

export const MARKETING_ERROR_CATEGORIES = [
  "INVALID_EXTRACTED_PRODUCT",
  "SOURCE_IDENTITY_MISMATCH",
  "SCENE_NOT_FOUND",
  "SCENE_VERSION_NOT_AVAILABLE",
  "SCENE_IDENTITY_MISMATCH",
  "SCENE_PRESET_INCOMPATIBLE",
  "INVALID_PLACEMENT",
  "BRAND_ASSET_UNAVAILABLE",
  "COMPOSITION_FAILED",
  "STORAGE_WRITE_FAILED",
  "OUTPUT_FINALIZATION_FAILED",
  "WORKSPACE_ISOLATION",
] as const;
export type MarketingErrorCategory = (typeof MARKETING_ERROR_CATEGORIES)[number];

export class PhotoSceneMarketingError extends Error {
  readonly code: MarketingErrorCategory;

  constructor(code: MarketingErrorCategory, message: string) {
    super(message);
    this.name = "PhotoSceneMarketingError";
    this.code = code;
  }
}

export function isMarketingErrorCategory(value: unknown): value is MarketingErrorCategory {
  return typeof value === "string" && (MARKETING_ERROR_CATEGORIES as readonly string[]).includes(value);
}

export function userSafeMarketingMessage(_code?: MarketingErrorCategory | null): string {
  return USER_SAFE_MARKETING_FAILURE_MESSAGE;
}

export const PhotoSceneOverlayCopyV1Schema = z
  .object({
    headline: z.string().max(80).optional(),
    cta: z.string().max(40).optional(),
    label: z.string().max(24).optional(),
  })
  .strict();

export type PhotoSceneOverlayCopyV1 = z.infer<typeof PhotoSceneOverlayCopyV1Schema>;

export const PhotoSceneBrandSnapshotV1Schema = z
  .object({
    profileId: z.string().uuid().nullable(),
    profileVersion: z.number().int().positive().nullable(),
    companyName: z.string().max(120).nullable(),
    logoIdentity: z.string().min(1).nullable(),
    logoContentHash: SourceAssetContentHashSchema.nullable(),
    brandColors: z.array(z.string().max(32)).max(8),
    brandFonts: z.array(z.string().max(64)).max(8),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.logoIdentity && isPublicUrlStorageIdentity(value.logoIdentity)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Brand logo identity cannot be a URL" });
    }
  });

export type PhotoSceneBrandSnapshotV1 = z.infer<typeof PhotoSceneBrandSnapshotV1Schema>;

export const PhotoSceneMarketingSnapshotV1Schema = z
  .object({
    campaignId: z.string().uuid(),
    taskId: z.string().uuid().nullable(),
    campaignName: z.string().max(200).nullable(),
    campaignBrief: z.string().max(2000).nullable(),
    hook: z.string().max(80).nullable(),
    cta: z.string().max(40).nullable(),
  })
  .strict();

export type PhotoSceneMarketingSnapshotV1 = z.infer<typeof PhotoSceneMarketingSnapshotV1Schema>;

export const PhotoSceneMarketingInputCapsuleV1Schema = z
  .object({
    version: z.literal(PHOTO_SCENE_MARKETING_CONTRACT_VERSION),
    contract: z.literal(PHOTO_SCENE_MARKETING_CONTRACT),
    operation: z.literal("marketing_image"),
    policy: z.literal(PHOTO_SCENE_MARKETING_POLICY),
    orgId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    campaignId: z.string().uuid(),
    extractedProductAssetId: z.string().uuid(),
    extractedProductContentHash: SourceAssetContentHashSchema,
    extractedProductStorageIdentity: z.string().min(1),
    scene: PhotoSceneFrozenSceneSelectionV1Schema,
    sceneSafeArea: PhotoSceneSafeAreaV1Schema,
    brandSnapshot: PhotoSceneBrandSnapshotV1Schema,
    brandSnapshotHash: SourceAssetContentHashSchema,
    marketingSnapshot: PhotoSceneMarketingSnapshotV1Schema,
    marketingSnapshotHash: SourceAssetContentHashSchema,
    overlayCopy: PhotoSceneOverlayCopyV1Schema,
    presetId: PhotoSceneOutputPresetIdSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    outputFormat: z.literal("image/png"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (isPublicUrlStorageIdentity(value.extractedProductStorageIdentity)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Extracted product identity cannot be a URL" });
    }
    const expected = PHOTO_SCENE_OUTPUT_PRESET_PIXELS[value.presetId];
    if (value.width !== expected.width || value.height !== expected.height) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Preset pixel size mismatch" });
    }
  });

export type PhotoSceneMarketingInputCapsuleV1 = z.infer<typeof PhotoSceneMarketingInputCapsuleV1Schema>;

export const PhotoSceneMarketingFingerprintIdentityV1Schema = z
  .object({
    version: z.literal(PHOTO_SCENE_MARKETING_CONTRACT_VERSION),
    contract: z.literal(PHOTO_SCENE_MARKETING_CONTRACT),
    operation: z.literal("marketing_image"),
    policy: z.literal(PHOTO_SCENE_MARKETING_POLICY),
    workspaceId: z.string().uuid(),
    extractedProductContentHash: SourceAssetContentHashSchema,
    sceneId: z.string().uuid(),
    sceneVersion: z.number().int().positive(),
    sceneContentHash: SourceAssetContentHashSchema,
    sceneSafeArea: PhotoSceneSafeAreaV1Schema,
    placement: PhotoSceneFrozenSceneSelectionV1Schema.shape.placement,
    presetId: PhotoSceneOutputPresetIdSchema,
    brandSnapshotHash: SourceAssetContentHashSchema,
    marketingSnapshotHash: SourceAssetContentHashSchema,
    overlayCopy: PhotoSceneOverlayCopyV1Schema,
  })
  .strict();

export type PhotoSceneMarketingFingerprintIdentityV1 = z.infer<
  typeof PhotoSceneMarketingFingerprintIdentityV1Schema
>;

export function freezeBrandSnapshot(input: {
  profileId?: string | null;
  profileVersion?: number | null;
  companyName?: string | null;
  logo?: string | null;
  logoContentHash?: string | null;
  brandColors?: string[] | null;
  brandFonts?: string[] | null;
}): PhotoSceneBrandSnapshotV1 {
  const logoIdentity = freezeLogoObjectReference(input.logo);
  return PhotoSceneBrandSnapshotV1Schema.parse({
    profileId: input.profileId && isUuid(input.profileId) ? input.profileId : null,
    profileVersion: typeof input.profileVersion === "number" && input.profileVersion > 0 ? input.profileVersion : null,
    companyName: input.companyName?.trim() || null,
    logoIdentity,
    logoContentHash: isCanonicalSourceContentHash(input.logoContentHash) ? input.logoContentHash : null,
    brandColors: (input.brandColors ?? []).filter(Boolean).slice(0, 8),
    brandFonts: (input.brandFonts ?? []).filter(Boolean).slice(0, 8),
  });
}

export function freezeMarketingPackageSnapshot(input: {
  campaignId: string;
  taskId?: string | null;
  campaignName?: string | null;
  campaignBrief?: string | null;
  hook?: string | null;
  cta?: string | null;
}): PhotoSceneMarketingSnapshotV1 {
  return PhotoSceneMarketingSnapshotV1Schema.parse({
    campaignId: input.campaignId,
    taskId: input.taskId && isUuid(input.taskId) ? input.taskId : null,
    campaignName: input.campaignName?.trim() || null,
    campaignBrief: input.campaignBrief?.trim() || null,
    hook: boundOverlayText(input.hook, 80),
    cta: boundOverlayText(input.cta, 40),
  });
}

function boundOverlayText(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** V1 overlay copy comes only from already-persisted Marketing Package fields. Never invent AI copy. */
export function extractBoundedMarketingCopy(strategyJson: unknown): {
  hook: string | null;
  cta: string | null;
} {
  if (!strategyJson || typeof strategyJson !== "object") {
    return { hook: null, cta: null };
  }
  const rec = strategyJson as Record<string, unknown>;
  const nested =
    rec.content && typeof rec.content === "object"
      ? (rec.content as Record<string, unknown>)
      : rec;
  const firstText = (value: unknown): string | null => {
    if (typeof value === "string") return boundOverlayText(value, 80);
    if (Array.isArray(value) && value[0]) {
      const item = value[0];
      if (typeof item === "string") return boundOverlayText(item, 80);
      if (item && typeof item === "object") {
        const recItem = item as Record<string, unknown>;
        return boundOverlayText(
          typeof recItem.text === "string"
            ? recItem.text
            : typeof recItem.hookText === "string"
              ? recItem.hookText
              : typeof recItem.ctaText === "string"
                ? recItem.ctaText
                : null,
          80
        );
      }
    }
    return null;
  };
  return {
    hook: firstText(nested.hooks) ?? boundOverlayText(typeof rec.hook === "string" ? rec.hook : null, 80),
    cta: boundOverlayText(
      firstText(nested.cta) ?? (typeof rec.cta === "string" ? rec.cta : null),
      40
    ),
  };
}

export function overlayCopyFromSnapshots(input: {
  marketing: PhotoSceneMarketingSnapshotV1;
  brand: PhotoSceneBrandSnapshotV1;
}): PhotoSceneOverlayCopyV1 {
  return PhotoSceneOverlayCopyV1Schema.parse({
    ...(input.marketing.hook ? { headline: input.marketing.hook } : {}),
    ...(input.marketing.cta ? { cta: input.marketing.cta } : {}),
    ...(input.brand.companyName ? { label: input.brand.companyName.slice(0, 24) } : {}),
  });
}

export function freezeMarketingImageInput(input: {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  extracted: {
    id: string;
    workspaceId: string;
    orgId: string;
    type: string;
    storagePath: string;
    contentHash?: string | null;
    metadata?: Record<string, unknown> | null;
  };
  scene: OfficialSceneVersionSnapshot;
  frozenScene: PhotoSceneFrozenSceneSelectionV1;
  brandSnapshot: PhotoSceneBrandSnapshotV1;
  brandSnapshotHash: SourceAssetContentHash;
  marketingSnapshot: PhotoSceneMarketingSnapshotV1;
  marketingSnapshotHash: SourceAssetContentHash;
}): PhotoSceneMarketingInputCapsuleV1 {
  if (input.extracted.orgId !== input.orgId || input.extracted.workspaceId !== input.workspaceId) {
    throw new PhotoSceneMarketingError("WORKSPACE_ISOLATION", "Extracted product is not in this workspace");
  }
  const role = readPhotoSceneMetadata(input.extracted.metadata ?? undefined)?.role;
  if (input.extracted.type !== "image" || role !== "extracted_product") {
    throw new PhotoSceneMarketingError("INVALID_EXTRACTED_PRODUCT", "A ready extracted product is required");
  }
  if (!isCanonicalSourceContentHash(input.extracted.contentHash)) {
    throw new PhotoSceneMarketingError("SOURCE_IDENTITY_MISMATCH", "Extracted product hash is missing");
  }
  if (isPublicUrlStorageIdentity(input.extracted.storagePath)) {
    throw new PhotoSceneMarketingError("INVALID_EXTRACTED_PRODUCT", "Extracted product identity cannot be a URL");
  }
  if (input.frozenScene.presetId && !input.scene.supportedPresets.includes(input.frozenScene.presetId)) {
    throw new PhotoSceneMarketingError(
      "SCENE_PRESET_INCOMPATIBLE",
      "This official scene does not support the selected output preset"
    );
  }
  if (
    input.frozenScene.sceneId !== input.scene.sceneId ||
    input.frozenScene.sceneVersion !== input.scene.version ||
    input.frozenScene.sceneContentHash !== input.scene.backgroundContentHash
  ) {
    throw new PhotoSceneMarketingError("SCENE_IDENTITY_MISMATCH", "Frozen scene does not match catalog version");
  }
  try {
    assertPlacementAgainstScene(input.scene, input.frozenScene.placement, input.frozenScene.presetId);
  } catch (err) {
    if (err instanceof PhotoSceneOfficialSceneError) {
      if (err.code === "PRESET_INCOMPATIBLE") {
        throw new PhotoSceneMarketingError(
          "SCENE_PRESET_INCOMPATIBLE",
          "This official scene does not support the selected output preset"
        );
      }
      throw new PhotoSceneMarketingError("INVALID_PLACEMENT", "Placement is outside the official scene contract");
    }
    throw err;
  }
  const pixels = PHOTO_SCENE_OUTPUT_PRESET_PIXELS[input.frozenScene.presetId];
  const overlayCopy = overlayCopyFromSnapshots({
    marketing: input.marketingSnapshot,
    brand: input.brandSnapshot,
  });
  return PhotoSceneMarketingInputCapsuleV1Schema.parse({
    version: PHOTO_SCENE_MARKETING_CONTRACT_VERSION,
    contract: PHOTO_SCENE_MARKETING_CONTRACT,
    operation: "marketing_image",
    policy: PHOTO_SCENE_MARKETING_POLICY,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    extractedProductAssetId: input.extracted.id,
    extractedProductContentHash: input.extracted.contentHash,
    extractedProductStorageIdentity: input.extracted.storagePath,
    scene: input.frozenScene,
    sceneSafeArea: input.scene.safeArea,
    brandSnapshot: input.brandSnapshot,
    brandSnapshotHash: input.brandSnapshotHash,
    marketingSnapshot: input.marketingSnapshot,
    marketingSnapshotHash: input.marketingSnapshotHash,
    overlayCopy,
    presetId: input.frozenScene.presetId,
    width: pixels.width,
    height: pixels.height,
    outputFormat: "image/png",
  });
}

export function marketingFingerprintIdentity(
  capsule: PhotoSceneMarketingInputCapsuleV1
): PhotoSceneMarketingFingerprintIdentityV1 {
  return PhotoSceneMarketingFingerprintIdentityV1Schema.parse({
    version: capsule.version,
    contract: capsule.contract,
    operation: capsule.operation,
    policy: capsule.policy,
    workspaceId: capsule.workspaceId,
    extractedProductContentHash: capsule.extractedProductContentHash,
    sceneId: capsule.scene.sceneId,
    sceneVersion: capsule.scene.sceneVersion,
    sceneContentHash: capsule.scene.sceneContentHash,
    sceneSafeArea: capsule.sceneSafeArea,
    placement: capsule.scene.placement,
    presetId: capsule.presetId,
    brandSnapshotHash: capsule.brandSnapshotHash,
    marketingSnapshotHash: capsule.marketingSnapshotHash,
    overlayCopy: capsule.overlayCopy,
  });
}

export function evaluateMarketingRetry(input: {
  generation: {
    status: string;
    operation: string;
    workspaceId: string;
    sourceAssetId: string;
    sourceContentHash: string;
    inputFingerprint: string;
  };
  expectedWorkspaceId: string;
  expectedFingerprint: string;
  expectedExtractedAssetId: string;
  expectedExtractedHash: string;
}): { ok: true } | { ok: false; reason: string } {
  if (input.generation.workspaceId !== input.expectedWorkspaceId) {
    return { ok: false, reason: "FOREIGN_WORKSPACE" };
  }
  if (input.generation.operation !== "marketing_image") return { ok: false, reason: "WRONG_OPERATION" };
  if (input.generation.status !== "failed") return { ok: false, reason: "NOT_FAILED" };
  if (input.generation.inputFingerprint !== input.expectedFingerprint) {
    return { ok: false, reason: "FROZEN_INPUT_CHANGED" };
  }
  if (
    input.generation.sourceAssetId !== input.expectedExtractedAssetId ||
    input.generation.sourceContentHash !== input.expectedExtractedHash
  ) {
    return { ok: false, reason: "FROZEN_INPUT_CHANGED" };
  }
  return { ok: true };
}

export function evaluateMarketingGenerateAgain(input: {
  previousFingerprint: string;
  nextFingerprint: string;
}): { newGenerationRequired: true; fingerprintChanged: boolean } {
  return {
    newGenerationRequired: true,
    fingerprintChanged: input.previousFingerprint !== input.nextFingerprint,
  };
}

export function joinInflightMarketing(input: {
  workspaceId: string;
  fingerprint: string;
  candidate: { id: string; workspaceId: string; inputFingerprint: string; status: string } | null;
}): { join: true; generationId: string; status: "queued" | "processing" } | { join: false } {
  if (!input.candidate) return { join: false };
  if (input.candidate.workspaceId !== input.workspaceId) return { join: false };
  if (input.candidate.inputFingerprint !== input.fingerprint) return { join: false };
  if (input.candidate.status === "queued" || input.candidate.status === "processing") {
    return {
      join: true,
      generationId: input.candidate.id,
      status: input.candidate.status,
    };
  }
  return { join: false };
}

export function marketingLineage(input: {
  generationId: string;
  generationFingerprint: string;
  extractedAssetId: string;
  extractedContentHash: string;
  sourceAssetId?: string;
  sceneId: string;
  sceneVersion: string;
  sceneContentHash: string;
  presetId: PhotoSceneOutputPresetId;
  marketingSnapshotHash: string;
  brandSnapshotHash: string;
}): {
  sourceAssetId?: string;
  extractedAssetId: string;
  extractedContentHash: string;
  operation: "marketing_image_compose";
  sceneId: string;
  sceneVersion: string;
  sceneContentHash: string;
  presetId: PhotoSceneOutputPresetId;
  marketingSnapshotHash: string;
  brandSnapshotHash: string;
  generationId: string;
  generationFingerprint: string;
} {
  return {
    ...(input.sourceAssetId ? { sourceAssetId: input.sourceAssetId } : {}),
    extractedAssetId: input.extractedAssetId,
    extractedContentHash: input.extractedContentHash,
    operation: "marketing_image_compose",
    sceneId: input.sceneId,
    sceneVersion: input.sceneVersion,
    sceneContentHash: input.sceneContentHash,
    presetId: input.presetId,
    marketingSnapshotHash: input.marketingSnapshotHash,
    brandSnapshotHash: input.brandSnapshotHash,
    generationId: input.generationId,
    generationFingerprint: input.generationFingerprint,
  };
}
