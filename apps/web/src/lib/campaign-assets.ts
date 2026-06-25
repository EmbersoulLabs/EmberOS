import { eq, and } from "drizzle-orm";
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

type Db = ReturnType<typeof getDb>;

export async function getCampaignAssets(db: Db, campaignId: string, workspaceId: string) {
  return db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.campaignId, campaignId), eq(schema.assets.workspaceId, workspaceId)));
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
