import { eq, and, asc, or } from "drizzle-orm";
import type { getDb } from "@ceo-agent/db";
import { schema } from "@ceo-agent/db";
import {
  MAX_CAMPAIGN_IMAGES,
  MAX_SOURCE_VIDEOS,
  MAX_UPLOAD_DURATION_SEC,
  listUploadVideoAssets,
  parseVideoDurationSec,
  sumUploadVideoDurationSec,
  validateCombinedVideoDurationSec,
  hasRejectedVideosOnly,
  listVideosPendingProbe,
} from "@ceo-agent/shared";

type Db = {
  select: ReturnType<typeof getDb>["select"];
};

export async function getCampaignAssets(db: Db, campaignId: string, workspaceId: string) {
  return db
    .select({
      id: schema.assets.id,
      orgId: schema.assets.orgId,
      workspaceId: schema.assets.workspaceId,
      campaignId: schema.assets.campaignId,
      type: schema.assets.type,
      storagePath: schema.assets.storagePath,
      displayName: schema.assets.displayName,
      originalFilename: schema.assets.originalFilename,
      status: schema.assets.status,
      source: schema.assets.source,
      uploadedBy: schema.assets.uploadedBy,
      mimeType: schema.assets.mimeType,
      durationSec: schema.assets.durationSec,
      width: schema.assets.width,
      height: schema.assets.height,
      fileSizeBytes: schema.assets.fileSizeBytes,
      metadata: schema.assets.metadata,
      contentHash: schema.assets.contentHash,
      createdAt: schema.assets.createdAt,
      updatedAt: schema.assets.updatedAt,
      deletedAt: schema.assets.deletedAt,
    })
    .from(schema.assets)
    .leftJoin(
      schema.campaignAssetRefs,
      eq(schema.campaignAssetRefs.assetId, schema.assets.id)
    )
    .where(
      and(
        eq(schema.assets.workspaceId, workspaceId),
        or(
          eq(schema.assets.campaignId, campaignId),
          eq(schema.campaignAssetRefs.campaignId, campaignId)
        )
      )
    )
    .orderBy(asc(schema.assets.createdAt), asc(schema.assets.id));
}

export async function validateCampaignAssetsForRun(
  db: Db,
  campaignId: string,
  workspaceId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const assets = await getCampaignAssets(db, campaignId, workspaceId);
  const uploadVideos = listUploadVideoAssets(assets);
  const images = assets.filter((a) => a.type === "image");

  if (uploadVideos.length === 0 && images.length === 0) {
    return { ok: false, error: "Upload at least one asset before running" };
  }
  if (hasRejectedVideosOnly(assets)) {
    return {
      ok: false,
      error:
        "Uploaded videos could not be processed (duration limit or format). Remove or trim them and try again.",
    };
  }
  if (listVideosPendingProbe(assets).length > 0) {
    return {
      ok: false,
      error: "Videos are still being analyzed. Wait a few seconds and run again.",
    };
  }
  if (uploadVideos.length > MAX_SOURCE_VIDEOS) {
    return {
      ok: false,
      error: `At most ${MAX_SOURCE_VIDEOS} source videos per campaign`,
    };
  }
  if (images.length > MAX_CAMPAIGN_IMAGES) {
    return { ok: false, error: `MVP allows at most ${MAX_CAMPAIGN_IMAGES} images per campaign` };
  }

  for (const video of uploadVideos) {
    const duration = parseVideoDurationSec(video.durationSec);
    if (duration != null && duration > MAX_UPLOAD_DURATION_SEC) {
      return {
        ok: false,
        error: `A video exceeds ${MAX_UPLOAD_DURATION_SEC}s limit (${duration.toFixed(1)}s). Trim before running.`,
      };
    }
  }

  const combined = sumUploadVideoDurationSec(assets);
  if (combined > 0) {
    const combinedCheck = validateCombinedVideoDurationSec(combined);
    if (!combinedCheck.ok) return combinedCheck;
  }

  return { ok: true };
}

export async function validateNewAssetUpload(
  db: Db,
  campaignId: string,
  workspaceId: string,
  type: "video" | "image"
): Promise<{ ok: true } | { ok: false; error: string }> {
  const assets = await getCampaignAssets(db, campaignId, workspaceId);
  const uploadVideos = listUploadVideoAssets(assets);
  const images = assets.filter((a) => a.type === "image");

  if (type === "video" && uploadVideos.length >= MAX_SOURCE_VIDEOS) {
    return {
      ok: false,
      error: `At most ${MAX_SOURCE_VIDEOS} source videos per campaign. You can add up to ${MAX_CAMPAIGN_IMAGES} product images.`,
    };
  }
  if (type === "image" && images.length >= MAX_CAMPAIGN_IMAGES) {
    return { ok: false, error: `Maximum ${MAX_CAMPAIGN_IMAGES} images per campaign (MVP)` };
  }

  return { ok: true };
}
