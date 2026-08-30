import { z } from "zod";
import { isPublicUrlStorageIdentity } from "./photo-scene-asset";
import {
  isCanonicalSourceContentHash,
  SourceAssetContentHashSchema,
  type SourceAssetContentHash,
} from "./source-asset-content-hash";

export const PHOTO_SCENE_FROZEN_SCENE_CONTRACT = "photo-scene-frozen-scene-v1" as const;
export const PHOTO_SCENE_FROZEN_SCENE_CONTRACT_VERSION = 1 as const;

export const PHOTO_SCENE_OUTPUT_PRESETS = ["story_9x16", "feed_1x1", "portrait_4x5"] as const;
export type PhotoSceneOutputPresetId = (typeof PHOTO_SCENE_OUTPUT_PRESETS)[number];

export const PHOTO_SCENE_OUTPUT_PRESET_PIXELS = {
  story_9x16: { width: 1080, height: 1920, ratio: "9:16" },
  feed_1x1: { width: 1080, height: 1080, ratio: "1:1" },
  portrait_4x5: { width: 1080, height: 1350, ratio: "4:5" },
} as const;

export const OFFICIAL_SCENE_STATUSES = ["draft", "published", "retired"] as const;
export type OfficialSceneStatus = (typeof OFFICIAL_SCENE_STATUSES)[number];

export const OFFICIAL_SCENE_ANCHORS = [
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "top_left",
  "top_right",
  "bottom_left",
  "bottom_right",
] as const;
export type OfficialSceneAnchor = (typeof OFFICIAL_SCENE_ANCHORS)[number];

export const OFFICIAL_SCENE_SHADOW_PRESETS = ["none", "soft", "grounded"] as const;
export type OfficialSceneShadowPreset = (typeof OFFICIAL_SCENE_SHADOW_PRESETS)[number];

export const DEFAULT_OFFICIAL_SCENE_BUCKET = "photo-scene-official";
export const OFFICIAL_SCENE_OBJECT_PREFIX = "official-scene-object:";
export const PRODUCT_PLACEMENT_Z_INDEX = 1;
export const V1_PLACEMENT_ROTATION_DEG = 0;
export const MIN_SAFE_AREA_SIZE = 0.08;

export const PhotoSceneOutputPresetIdSchema = z.enum(PHOTO_SCENE_OUTPUT_PRESETS);
export const OfficialSceneStatusSchema = z.enum(OFFICIAL_SCENE_STATUSES);
export const OfficialSceneAnchorSchema = z.enum(OFFICIAL_SCENE_ANCHORS);
export const OfficialSceneShadowPresetSchema = z.enum(OFFICIAL_SCENE_SHADOW_PRESETS);

export class PhotoSceneOfficialSceneError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PhotoSceneOfficialSceneError";
    this.code = code;
  }
}

export const PhotoSceneSafeAreaV1Schema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().gt(0).max(1),
    height: z.number().finite().gt(0).max(1),
  })
  .strict()
  .superRefine((area, ctx) => {
    if (area.x + area.width > 1 + 1e-9 || area.y + area.height > 1 + 1e-9) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "safeArea exceeds unit square" });
    }
    if (area.width < MIN_SAFE_AREA_SIZE || area.height < MIN_SAFE_AREA_SIZE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "safeArea is too small" });
    }
  });

export type PhotoSceneSafeAreaV1 = z.infer<typeof PhotoSceneSafeAreaV1Schema>;

export const PhotoSceneScaleRangeV1Schema = z
  .object({
    min: z.number().finite().positive(),
    max: z.number().finite().positive(),
    defaultScale: z.number().finite().positive(),
  })
  .strict()
  .superRefine((range, ctx) => {
    if (range.min > range.max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "scale min must be <= max" });
    }
    if (range.defaultScale < range.min || range.defaultScale > range.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "default scale must be within min/max",
      });
    }
  });

export type PhotoSceneScaleRangeV1 = z.infer<typeof PhotoSceneScaleRangeV1Schema>;

export const PhotoScenePlacementV1Schema = z
  .object({
    anchor: OfficialSceneAnchorSchema,
    offsetX: z.number().finite(),
    offsetY: z.number().finite(),
    scale: z.number().finite().positive(),
    rotation: z.literal(V1_PLACEMENT_ROTATION_DEG),
    zIndex: z.literal(PRODUCT_PLACEMENT_Z_INDEX),
    shadowPreset: OfficialSceneShadowPresetSchema,
  })
  .strict();

export type PhotoScenePlacementV1 = z.infer<typeof PhotoScenePlacementV1Schema>;

export const OfficialSceneObjectIdentitySchema = z
  .string()
  .min(1)
  .refine((value) => isOfficialSceneObjectIdentity(value), "Official scene identity must be a canonical object reference");

export const PhotoSceneFrozenSceneSelectionV1Schema = z
  .object({
    version: z.literal(PHOTO_SCENE_FROZEN_SCENE_CONTRACT_VERSION),
    contract: z.literal(PHOTO_SCENE_FROZEN_SCENE_CONTRACT),
    sceneId: z.string().uuid(),
    sceneVersion: z.number().int().positive(),
    sceneContentHash: SourceAssetContentHashSchema,
    backgroundStorageIdentity: OfficialSceneObjectIdentitySchema,
    presetId: PhotoSceneOutputPresetIdSchema,
    placement: PhotoScenePlacementV1Schema,
  })
  .strict();

export type PhotoSceneFrozenSceneSelectionV1 = z.infer<typeof PhotoSceneFrozenSceneSelectionV1Schema>;

export type OfficialSceneVersionSnapshot = {
  sceneId: string;
  sceneSlug: string;
  name: string;
  category: string;
  tags: string[];
  version: number;
  status: OfficialSceneStatus;
  supportedPresets: PhotoSceneOutputPresetId[];
  backgroundStorageIdentity: string;
  backgroundContentHash: SourceAssetContentHash;
  previewStorageIdentity: string;
  safeArea: PhotoSceneSafeAreaV1;
  productAnchor: OfficialSceneAnchor;
  scaleRange: PhotoSceneScaleRangeV1;
  defaultOffsetX: number;
  defaultOffsetY: number;
  defaultShadowPreset: OfficialSceneShadowPreset;
  publishedAt?: string | null;
  retiredAt?: string | null;
};

export function configuredOfficialSceneBucket(): string {
  return process.env.PHOTO_SCENE_OFFICIAL_BUCKET?.trim() || DEFAULT_OFFICIAL_SCENE_BUCKET;
}

export function officialSceneBackgroundObjectKey(sceneId: string, version: number): string {
  return `official/${sceneId}/v${version}/background.png`;
}

export function officialScenePreviewObjectKey(sceneId: string, version: number): string {
  return `official/${sceneId}/v${version}/preview.png`;
}

export function freezeOfficialSceneObjectIdentity(bucket: string, objectKey: string): string {
  if (!bucket || !objectKey || isPublicUrlStorageIdentity(objectKey) || isPublicUrlStorageIdentity(bucket)) {
    throw new PhotoSceneOfficialSceneError(
      "PUBLIC_URL_IDENTITY_DENIED",
      "Official scene identity cannot be a public URL"
    );
  }
  if (objectKey.includes("/library/") || objectKey.includes("/campaigns/")) {
    throw new PhotoSceneOfficialSceneError(
      "SCENE_STORAGE_ISOLATION",
      "Official scene objects cannot use tenant campaign-assets paths"
    );
  }
  return `${OFFICIAL_SCENE_OBJECT_PREFIX}${bucket}:${objectKey}`;
}

export function isOfficialSceneObjectIdentity(value: string): boolean {
  if (!value.startsWith(OFFICIAL_SCENE_OBJECT_PREFIX)) return false;
  const rest = value.slice(OFFICIAL_SCENE_OBJECT_PREFIX.length);
  const colon = rest.indexOf(":");
  if (colon <= 0) return false;
  const bucket = rest.slice(0, colon);
  const objectKey = rest.slice(colon + 1);
  return Boolean(bucket && objectKey) && !isPublicUrlStorageIdentity(objectKey);
}

export function parseOfficialSceneObjectIdentity(
  value: string
): { bucket: string; objectKey: string } | null {
  if (!isOfficialSceneObjectIdentity(value)) return null;
  const rest = value.slice(OFFICIAL_SCENE_OBJECT_PREFIX.length);
  const colon = rest.indexOf(":");
  return { bucket: rest.slice(0, colon), objectKey: rest.slice(colon + 1) };
}

export function officialScenePreviewDeliveryUrl(
  supabaseUrl: string | undefined,
  identity: string
): string | null {
  const parsed = parseOfficialSceneObjectIdentity(identity);
  if (!parsed || !supabaseUrl?.trim()) return null;
  const origin = supabaseUrl.replace(/\/+$/, "");
  return `${origin}/storage/v1/object/public/${parsed.bucket}/${parsed.objectKey}`;
}

export function computeProductPlacementNormalized(input: {
  safeArea: PhotoSceneSafeAreaV1;
  placement: PhotoScenePlacementV1;
  productWidth: number;
  productHeight: number;
}): { x: number; y: number; width: number; height: number } {
  const { safeArea, placement, productWidth, productHeight } = input;
  const origin = anchorPointInSafeArea(safeArea, placement.anchor);
  const cx = origin.x + placement.offsetX;
  const cy = origin.y + placement.offsetY;
  const boxW = Math.max(0.01, safeArea.width * placement.scale);
  const boxH = Math.max(0.01, safeArea.height * placement.scale);
  const aspect = productWidth > 0 && productHeight > 0 ? productWidth / productHeight : 1;
  let width = boxW;
  let height = width / aspect;
  if (height > boxH) {
    height = boxH;
    width = height * aspect;
  }
  return {
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
  };
}

export function computeProductPlacementPixels(input: {
  canvasWidth: number;
  canvasHeight: number;
  safeArea: PhotoSceneSafeAreaV1;
  placement: PhotoScenePlacementV1;
  productWidth: number;
  productHeight: number;
}): { x: number; y: number; width: number; height: number } {
  const normalized = computeProductPlacementNormalized(input);
  return {
    x: Math.round(normalized.x * input.canvasWidth),
    y: Math.round(normalized.y * input.canvasHeight),
    width: Math.max(1, Math.round(normalized.width * input.canvasWidth)),
    height: Math.max(1, Math.round(normalized.height * input.canvasHeight)),
  };
}

export function defaultPlacementForScene(scene: OfficialSceneVersionSnapshot): PhotoScenePlacementV1 {
  return {
    anchor: scene.productAnchor,
    offsetX: scene.defaultOffsetX,
    offsetY: scene.defaultOffsetY,
    scale: scene.scaleRange.defaultScale,
    rotation: V1_PLACEMENT_ROTATION_DEG,
    zIndex: PRODUCT_PLACEMENT_Z_INDEX,
    shadowPreset: scene.defaultShadowPreset,
  };
}

export function anchorPointInSafeArea(
  safeArea: PhotoSceneSafeAreaV1,
  anchor: OfficialSceneAnchor
): { x: number; y: number } {
  const left = safeArea.x;
  const right = safeArea.x + safeArea.width;
  const top = safeArea.y;
  const bottom = safeArea.y + safeArea.height;
  const cx = left + safeArea.width / 2;
  const cy = top + safeArea.height / 2;
  switch (anchor) {
    case "center":
      return { x: cx, y: cy };
    case "top":
      return { x: cx, y: top };
    case "bottom":
      return { x: cx, y: bottom };
    case "left":
      return { x: left, y: cy };
    case "right":
      return { x: right, y: cy };
    case "top_left":
      return { x: left, y: top };
    case "top_right":
      return { x: right, y: top };
    case "bottom_left":
      return { x: left, y: bottom };
    case "bottom_right":
      return { x: right, y: bottom };
  }
}

function pointInSafeArea(safeArea: PhotoSceneSafeAreaV1, x: number, y: number): boolean {
  return (
    x + 1e-9 >= safeArea.x &&
    y + 1e-9 >= safeArea.y &&
    x <= safeArea.x + safeArea.width + 1e-9 &&
    y <= safeArea.y + safeArea.height + 1e-9
  );
}

export function assertPlacementAgainstScene(
  scene: Pick<
    OfficialSceneVersionSnapshot,
    "safeArea" | "productAnchor" | "scaleRange" | "supportedPresets"
  >,
  placement: PhotoScenePlacementV1,
  presetId: PhotoSceneOutputPresetId
): PhotoScenePlacementV1 {
  const parsed = PhotoScenePlacementV1Schema.safeParse(placement);
  if (!parsed.success) {
    throw new PhotoSceneOfficialSceneError("PLACEMENT_INVALID", "Placement is outside the V1 contract");
  }
  const safeArea = PhotoSceneSafeAreaV1Schema.parse(scene.safeArea);
  if (parsed.data.anchor !== scene.productAnchor) {
    throw new PhotoSceneOfficialSceneError("PLACEMENT_INVALID", "Anchor must match the official scene");
  }
  if (
    parsed.data.scale < scene.scaleRange.min ||
    parsed.data.scale > scene.scaleRange.max
  ) {
    throw new PhotoSceneOfficialSceneError("PLACEMENT_INVALID", "Scale is outside the scene range");
  }
  if (!scene.supportedPresets.includes(presetId)) {
    throw new PhotoSceneOfficialSceneError(
      "PRESET_INCOMPATIBLE",
      "This official scene does not support the selected output preset"
    );
  }
  const origin = anchorPointInSafeArea(safeArea, parsed.data.anchor);
  const placed = { x: origin.x + parsed.data.offsetX, y: origin.y + parsed.data.offsetY };
  if (!pointInSafeArea(safeArea, placed.x, placed.y)) {
    throw new PhotoSceneOfficialSceneError(
      "PLACEMENT_INVALID",
      "Product placement must remain inside the safe area"
    );
  }
  return parsed.data;
}

export function assertTenantCannotMutateOfficialSceneCatalog(): never {
  throw new PhotoSceneOfficialSceneError(
    "TENANT_SCENE_MUTATION_DENIED",
    "Official scenes are a global catalog and cannot be created or edited by tenants"
  );
}

export function assertPublishedVersionImmutable(
  published: OfficialSceneVersionSnapshot,
  attempted: Partial<
    Pick<
      OfficialSceneVersionSnapshot,
      | "backgroundStorageIdentity"
      | "backgroundContentHash"
      | "previewStorageIdentity"
      | "safeArea"
      | "supportedPresets"
      | "productAnchor"
      | "scaleRange"
    >
  >
): void {
  if (published.status === "draft") return;
  const identityChanged =
    attempted.backgroundStorageIdentity !== undefined &&
    attempted.backgroundStorageIdentity !== published.backgroundStorageIdentity;
  const hashChanged =
    attempted.backgroundContentHash !== undefined &&
    attempted.backgroundContentHash !== published.backgroundContentHash;
  const previewChanged =
    attempted.previewStorageIdentity !== undefined &&
    attempted.previewStorageIdentity !== published.previewStorageIdentity;
  const areaChanged =
    attempted.safeArea !== undefined &&
    JSON.stringify(attempted.safeArea) !== JSON.stringify(published.safeArea);
  const presetsChanged =
    attempted.supportedPresets !== undefined &&
    JSON.stringify(attempted.supportedPresets) !== JSON.stringify(published.supportedPresets);
  const anchorChanged =
    attempted.productAnchor !== undefined && attempted.productAnchor !== published.productAnchor;
  const scaleChanged =
    attempted.scaleRange !== undefined &&
    JSON.stringify(attempted.scaleRange) !== JSON.stringify(published.scaleRange);
  if (
    identityChanged ||
    hashChanged ||
    previewChanged ||
    areaChanged ||
    presetsChanged ||
    anchorChanged ||
    scaleChanged
  ) {
    throw new PhotoSceneOfficialSceneError(
      "SCENE_VERSION_IMMUTABLE",
      "Published or retired official scene versions cannot change visual authority"
    );
  }
}

export function assertSceneBackgroundBytesBound(
  version: Pick<OfficialSceneVersionSnapshot, "backgroundContentHash">,
  bytesHash: string
): void {
  if (!isCanonicalSourceContentHash(bytesHash) || bytesHash !== version.backgroundContentHash) {
    throw new PhotoSceneOfficialSceneError(
      "SCENE_HASH_MISMATCH",
      "Official scene version does not match background bytes"
    );
  }
}

export function assertHardDeleteProhibited(status: OfficialSceneStatus): void {
  if (status !== "draft") {
    throw new PhotoSceneOfficialSceneError(
      "SCENE_HARD_DELETE_PROHIBITED",
      "Published or retired official scene versions cannot be deleted"
    );
  }
}

export function isSelectableByTenant(status: OfficialSceneStatus): boolean {
  return status === "published";
}

export function isReconstructable(status: OfficialSceneStatus): boolean {
  return status === "published" || status === "retired";
}

export function listSelectableOfficialScenes(
  versions: OfficialSceneVersionSnapshot[],
  filter?: { presetId?: PhotoSceneOutputPresetId; category?: string }
): OfficialSceneVersionSnapshot[] {
  return versions.filter((version) => {
    if (!isSelectableByTenant(version.status)) return false;
    if (filter?.presetId && !version.supportedPresets.includes(filter.presetId)) return false;
    if (filter?.category && version.category !== filter.category) return false;
    return true;
  });
}

export function publishOfficialSceneVersion(
  existing: OfficialSceneVersionSnapshot[],
  next: OfficialSceneVersionSnapshot,
  now = new Date().toISOString()
): OfficialSceneVersionSnapshot[] {
  if (next.status !== "published") {
    throw new PhotoSceneOfficialSceneError("SCENE_STATUS_INVALID", "Publish requires status published");
  }
  PhotoSceneSafeAreaV1Schema.parse(next.safeArea);
  PhotoSceneScaleRangeV1Schema.parse(next.scaleRange);
  if (!isOfficialSceneObjectIdentity(next.backgroundStorageIdentity)) {
    throw new PhotoSceneOfficialSceneError(
      "PUBLIC_URL_IDENTITY_DENIED",
      "Official scene background identity is invalid"
    );
  }
  if (!isCanonicalSourceContentHash(next.backgroundContentHash)) {
    throw new PhotoSceneOfficialSceneError("SCENE_HASH_MISMATCH", "Official scene hash is invalid");
  }
  const published = { ...next, status: "published" as const, publishedAt: next.publishedAt ?? now, retiredAt: null };
  return existing
    .filter((row) => !(row.sceneId === published.sceneId && row.version === published.version))
    .map((row) =>
      row.sceneId === published.sceneId && row.status === "published"
        ? { ...row, status: "retired" as const, retiredAt: now }
        : row
    )
    .concat(published);
}

export function retireOfficialSceneVersion(
  existing: OfficialSceneVersionSnapshot[],
  sceneId: string,
  version: number,
  now = new Date().toISOString()
): OfficialSceneVersionSnapshot[] {
  return existing.map((row) =>
    row.sceneId === sceneId && row.version === version
      ? { ...row, status: "retired" as const, retiredAt: now }
      : row
  );
}

export function freezeOfficialSceneSelection(input: {
  scene: OfficialSceneVersionSnapshot;
  presetId: PhotoSceneOutputPresetId;
  placement?: Partial<PhotoScenePlacementV1>;
}): PhotoSceneFrozenSceneSelectionV1 {
  if (!isSelectableByTenant(input.scene.status)) {
    throw new PhotoSceneOfficialSceneError(
      "SCENE_NOT_SELECTABLE",
      "Only published official scenes can be selected"
    );
  }
  const placement = assertPlacementAgainstScene(
    input.scene,
    {
      ...defaultPlacementForScene(input.scene),
      ...input.placement,
      rotation: V1_PLACEMENT_ROTATION_DEG,
      zIndex: PRODUCT_PLACEMENT_Z_INDEX,
    },
    input.presetId
  );
  return PhotoSceneFrozenSceneSelectionV1Schema.parse({
    version: PHOTO_SCENE_FROZEN_SCENE_CONTRACT_VERSION,
    contract: PHOTO_SCENE_FROZEN_SCENE_CONTRACT,
    sceneId: input.scene.sceneId,
    sceneVersion: input.scene.version,
    sceneContentHash: input.scene.backgroundContentHash,
    backgroundStorageIdentity: input.scene.backgroundStorageIdentity,
    presetId: input.presetId,
    placement,
  });
}

export function resolveFrozenOfficialSceneSelection(
  frozen: PhotoSceneFrozenSceneSelectionV1,
  catalog: OfficialSceneVersionSnapshot[]
): OfficialSceneVersionSnapshot {
  const parsed = PhotoSceneFrozenSceneSelectionV1Schema.parse(frozen);
  if (
    "previewUrl" in (frozen as object) ||
    JSON.stringify(frozen).includes("token=") ||
    JSON.stringify(frozen).includes("Authorization")
  ) {
    throw new PhotoSceneOfficialSceneError(
      "PUBLIC_URL_IDENTITY_DENIED",
      "Frozen scene selection cannot include delivery credentials"
    );
  }
  const match = catalog.find(
    (row) => row.sceneId === parsed.sceneId && row.version === parsed.sceneVersion
  );
  if (!match || !isReconstructable(match.status)) {
    throw new PhotoSceneOfficialSceneError(
      "SCENE_VERSION_NOT_FOUND",
      "Frozen official scene version cannot be reconstructed"
    );
  }
  if (match.backgroundContentHash !== parsed.sceneContentHash) {
    throw new PhotoSceneOfficialSceneError(
      "SCENE_HASH_MISMATCH",
      "Frozen official scene hash does not match catalog version"
    );
  }
  if (match.backgroundStorageIdentity !== parsed.backgroundStorageIdentity) {
    throw new PhotoSceneOfficialSceneError(
      "SCENE_HASH_MISMATCH",
      "Frozen official scene storage identity does not match catalog version"
    );
  }
  assertPlacementAgainstScene(match, parsed.placement, parsed.presetId);
  return match;
}

export function currentPublishedPolicySelection(
  catalog: OfficialSceneVersionSnapshot[],
  sceneId: string
): OfficialSceneVersionSnapshot | null {
  return catalog.find((row) => row.sceneId === sceneId && row.status === "published") ?? null;
}

export type OfficialSceneProductionSeedExisting = {
  sceneId: string;
  version: number;
  backgroundContentHash: string;
  backgroundStorageIdentity: string;
  previewStorageIdentity: string;
};

export type OfficialSceneProductionSeedDecision =
  | { action: "insert" }
  | { action: "verified_noop" };

/** Production seed never overwrites an existing scene version's bytes or identities. */
export function evaluateOfficialSceneProductionSeed(input: {
  existing: OfficialSceneProductionSeedExisting | null;
  nextHash: string;
  nextBackgroundIdentity: string;
  nextPreviewIdentity: string;
}): OfficialSceneProductionSeedDecision {
  if (!isCanonicalSourceContentHash(input.nextHash)) {
    throw new PhotoSceneOfficialSceneError("SCENE_HASH_MISMATCH", "Official scene hash is invalid");
  }
  if (
    !isOfficialSceneObjectIdentity(input.nextBackgroundIdentity) ||
    !isOfficialSceneObjectIdentity(input.nextPreviewIdentity)
  ) {
    throw new PhotoSceneOfficialSceneError(
      "PUBLIC_URL_IDENTITY_DENIED",
      "Official scene identity cannot be a public URL"
    );
  }
  if (!input.existing) return { action: "insert" };
  if (
    input.existing.backgroundContentHash === input.nextHash &&
    input.existing.backgroundStorageIdentity === input.nextBackgroundIdentity &&
    input.existing.previewStorageIdentity === input.nextPreviewIdentity
  ) {
    return { action: "verified_noop" };
  }
  throw new PhotoSceneOfficialSceneError(
    "SCENE_VERSION_IMMUTABLE",
    "Existing official scene version bytes/hash cannot be overwritten"
  );
}
