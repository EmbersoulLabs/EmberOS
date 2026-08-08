import type { getDb } from "@ceo-agent/db";
import { getCampaignAssets } from "@ceo-agent/db";
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

type ExistingAsset = Awaited<ReturnType<typeof getCampaignAssets>>[number];

export type NewAssetValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: "ASSET_LIMIT" | "VIDEO_TOO_LONG" | "COMBINED_DURATION_TOO_LONG";
      error: string;
    };

export { getCampaignAssets };

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
  type: "video" | "image",
  durationSec?: number
): Promise<NewAssetValidationResult> {
  const assets = await getCampaignAssets(db, campaignId, workspaceId);
  return validateNewAssetAgainstExisting(assets, type, durationSec);
}

export function validateNewAssetAgainstExisting(
  assets: ExistingAsset[],
  type: "video" | "image",
  durationSec?: number
): NewAssetValidationResult {
  const uploadVideos = listUploadVideoAssets(assets);
  const images = assets.filter((a) => a.type === "image");

  if (type === "video" && uploadVideos.length >= MAX_SOURCE_VIDEOS) {
    return {
      ok: false,
      code: "ASSET_LIMIT",
      error: `At most ${MAX_SOURCE_VIDEOS} source videos per campaign. You can add up to ${MAX_CAMPAIGN_IMAGES} product images.`,
    };
  }
  if (type === "image" && images.length >= MAX_CAMPAIGN_IMAGES) {
    return { ok: false, code: "ASSET_LIMIT", error: `Maximum ${MAX_CAMPAIGN_IMAGES} images per campaign (MVP)` };
  }

  if (type === "video" && durationSec != null) {
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      return {
        ok: false,
        code: "VIDEO_TOO_LONG",
        error: "Video duration could not be read. Use a supported MP4, MOV, or WebM file.",
      };
    }
    if (durationSec > MAX_UPLOAD_DURATION_SEC) {
      return {
        ok: false,
        code: "VIDEO_TOO_LONG",
        error: `Video duration ${durationSec.toFixed(1)}s exceeds the ${Math.round(MAX_UPLOAD_DURATION_SEC / 60)} minute per-file limit.`,
      };
    }
    const combinedSec = sumUploadVideoDurationSec(assets) + durationSec;
    const combined = validateCombinedVideoDurationSec(combinedSec);
    if (!combined.ok) {
      return {
        ok: false,
        code: "COMBINED_DURATION_TOO_LONG",
        error: combined.error,
      };
    }
  }

  return { ok: true };
}
