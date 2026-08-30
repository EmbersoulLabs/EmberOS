import { eq } from "drizzle-orm";
import {
  getCampaignSceneSelection,
  getDb,
  getOfficialSceneVersion,
  getPhotoSceneGeneration,
  latestCampaignPhotoSceneExtraction,
  listPublishedOfficialSceneVersions,
  schema,
  upsertCampaignSceneSelection,
} from "@ceo-agent/db";
import {
  PhotoSceneFrozenSceneSelectionV1Schema,
  PhotoSceneOfficialSceneError,
  PhotoSceneOutputPresetIdSchema,
  PhotoSceneSafeAreaV1Schema,
  PhotoSceneScaleRangeV1Schema,
  assertTenantCannotMutateOfficialSceneCatalog,
  freezeOfficialSceneSelection,
  isPublicUrlStorageIdentity,
  isReconstructable,
  listSelectableOfficialScenes,
  officialScenePreviewDeliveryUrl,
  resolveFrozenOfficialSceneSelection,
  type OfficialSceneVersionSnapshot,
  type PhotoSceneFrozenSceneSelectionV1,
  type PhotoSceneOutputPresetId,
  type PhotoScenePlacementV1,
} from "@ceo-agent/shared";

type Db = ReturnType<typeof getDb>;

function asNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

export function mapOfficialSceneVersionRow(input: {
  scene: typeof schema.photoSceneOfficialScenes.$inferSelect;
  version: typeof schema.photoSceneOfficialSceneVersions.$inferSelect;
}): OfficialSceneVersionSnapshot {
  const scaleRange = PhotoSceneScaleRangeV1Schema.parse({
    min: asNumber(input.version.scaleMin),
    max: asNumber(input.version.scaleMax),
    defaultScale: asNumber(input.version.defaultScale),
  });
  return {
    sceneId: input.scene.id,
    sceneSlug: input.scene.slug,
    name: input.scene.name,
    category: input.scene.category,
    tags: input.scene.tags ?? [],
    version: input.version.version,
    status: input.version.status as OfficialSceneVersionSnapshot["status"],
    supportedPresets: PhotoSceneOutputPresetIdSchema.array().parse(input.version.supportedPresets),
    backgroundStorageIdentity: input.version.backgroundStorageIdentity,
    backgroundContentHash: input.version.backgroundContentHash as OfficialSceneVersionSnapshot["backgroundContentHash"],
    previewStorageIdentity: input.version.previewStorageIdentity,
    safeArea: PhotoSceneSafeAreaV1Schema.parse(input.version.safeArea),
    productAnchor: input.version.productAnchor as OfficialSceneVersionSnapshot["productAnchor"],
    scaleRange,
    defaultOffsetX: asNumber(input.version.defaultOffsetX),
    defaultOffsetY: asNumber(input.version.defaultOffsetY),
    defaultShadowPreset: input.version.defaultShadowPreset as OfficialSceneVersionSnapshot["defaultShadowPreset"],
    publishedAt: input.version.publishedAt?.toISOString() ?? null,
    retiredAt: input.version.retiredAt?.toISOString() ?? null,
  };
}

export function toOfficialScenePickerDto(scene: OfficialSceneVersionSnapshot) {
  return {
    sceneId: scene.sceneId,
    slug: scene.sceneSlug,
    name: scene.name,
    category: scene.category,
    tags: scene.tags,
    version: scene.version,
    status: scene.status,
    supportedPresets: scene.supportedPresets,
    sceneContentHash: scene.backgroundContentHash,
    backgroundStorageIdentity: scene.backgroundStorageIdentity,
    previewStorageIdentity: scene.previewStorageIdentity,
    previewUrl: officialScenePreviewDeliveryUrl(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      scene.previewStorageIdentity
    ),
    safeArea: scene.safeArea,
    productAnchor: scene.productAnchor,
    scaleRange: scene.scaleRange,
    defaultOffsetX: scene.defaultOffsetX,
    defaultOffsetY: scene.defaultOffsetY,
    defaultShadowPreset: scene.defaultShadowPreset,
  };
}

export async function listPublishedOfficialScenesForPicker(
  db: Db,
  filter?: { presetId?: PhotoSceneOutputPresetId; category?: string }
) {
  const rows = await listPublishedOfficialSceneVersions(db);
  const snapshots = rows.map(mapOfficialSceneVersionRow);
  return listSelectableOfficialScenes(snapshots, filter).map(toOfficialScenePickerDto);
}

export async function resolveOfficialSceneVersionForRead(
  db: Db,
  sceneId: string,
  version: number
) {
  const row = await getOfficialSceneVersion(db, sceneId, version);
  if (!row) {
    throw new PhotoSceneOfficialSceneError("SCENE_VERSION_NOT_FOUND", "Official scene version was not found");
  }
  const snapshot = mapOfficialSceneVersionRow(row);
  if (!isReconstructable(snapshot.status)) {
    throw new PhotoSceneOfficialSceneError("SCENE_NOT_SELECTABLE", "This official scene is not available");
  }
  return snapshot;
}

export async function persistOfficialSceneSelection(
  db: Db,
  input: {
    campaign: typeof schema.campaigns.$inferSelect;
    userId: string;
    extractedAssetId?: string | null;
    sceneId: string;
    sceneVersion: number;
    presetId: PhotoSceneOutputPresetId;
    placement?: Partial<PhotoScenePlacementV1>;
  }
) {
  const row = await getOfficialSceneVersion(db, input.sceneId, input.sceneVersion);
  if (!row) {
    throw new PhotoSceneOfficialSceneError("SCENE_VERSION_NOT_FOUND", "Official scene version was not found");
  }
  const scene = mapOfficialSceneVersionRow(row);
  const frozen = freezeOfficialSceneSelection({
    scene,
    presetId: input.presetId,
    placement: input.placement,
  });
  if (isPublicUrlStorageIdentity(JSON.stringify(frozen))) {
    throw new PhotoSceneOfficialSceneError(
      "PUBLIC_URL_IDENTITY_DENIED",
      "Frozen scene selection cannot persist a URL"
    );
  }
  let extractedAssetId = input.extractedAssetId ?? null;
  if (extractedAssetId) {
    const [asset] = await db
      .select({ id: schema.assets.id, workspaceId: schema.assets.workspaceId })
      .from(schema.assets)
      .where(eq(schema.assets.id, extractedAssetId))
      .limit(1);
    if (!asset || asset.workspaceId !== input.campaign.workspaceId) {
      throw new PhotoSceneOfficialSceneError("WORKSPACE_ISOLATION", "Extracted product is not in this workspace");
    }
  }
  const saved = await upsertCampaignSceneSelection(db, {
    orgId: input.campaign.orgId,
    workspaceId: input.campaign.workspaceId,
    campaignId: input.campaign.id,
    extractedAssetId,
    frozenSelection: frozen,
    createdBy: input.userId,
  });
  return { selection: saved, frozen, scene: toOfficialScenePickerDto(scene) };
}

export async function readOfficialSceneSelection(
  db: Db,
  input: { workspaceId: string; campaignId: string; orgId: string }
) {
  const row = await getCampaignSceneSelection(db, input);
  if (!row || row.orgId !== input.orgId) return null;
  const frozen = PhotoSceneFrozenSceneSelectionV1Schema.parse(row.frozenSelection);
  const catalogRow = await getOfficialSceneVersion(db, frozen.sceneId, frozen.sceneVersion);
  if (!catalogRow) {
    throw new PhotoSceneOfficialSceneError(
      "SCENE_VERSION_NOT_FOUND",
      "Frozen official scene version cannot be reconstructed"
    );
  }
  const scene = resolveFrozenOfficialSceneSelection(frozen, [mapOfficialSceneVersionRow(catalogRow)]);
  return {
    id: row.id,
    extractedAssetId: row.extractedAssetId,
    frozen,
    scene: toOfficialScenePickerDto(scene),
    updatedAt: row.updatedAt.toISOString(),
    marketingImageCreated: false as const,
  };
}

export async function latestReadyExtractedProductId(
  db: Db,
  input: { workspaceId: string; campaignId: string; generationId?: string }
) {
  const generation = input.generationId
    ? await getPhotoSceneGeneration(db, input.generationId, input.workspaceId)
    : await latestCampaignPhotoSceneExtraction(db, input);
  if (!generation || generation.status !== "ready" || !generation.outputAssetId) return null;
  return generation.outputAssetId;
}

export function refuseTenantCatalogWrite(): never {
  return assertTenantCannotMutateOfficialSceneCatalog();
}

export function mapOfficialSceneApiError(error: unknown): { message: string; code: string; status: number } {
  if (error instanceof PhotoSceneOfficialSceneError) {
    const status =
      error.code === "TENANT_SCENE_MUTATION_DENIED" || error.code === "WORKSPACE_ISOLATION"
        ? 403
        : error.code === "SCENE_VERSION_NOT_FOUND"
          ? 404
          : 400;
    return { message: error.message, code: error.code, status };
  }
  throw error;
}

export type SavedOfficialSceneSelection = {
  frozen: PhotoSceneFrozenSceneSelectionV1;
};
