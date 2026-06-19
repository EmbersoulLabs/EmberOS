import { eq, and } from "drizzle-orm";
import type { getDb } from "@ceo-agent/db";
import { schema } from "@ceo-agent/db";
import {
  MAX_CAMPAIGN_IMAGES,
  MAX_SOURCE_VIDEOS,
  MAX_UPLOAD_DURATION_SEC,
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
  const videos = assets.filter((a) => a.type === "video");
  const images = assets.filter((a) => a.type === "image");

  if (videos.length === 0 && images.length === 0) {
    return { ok: false, error: "Upload at least one asset before running" };
  }
  if (videos.length > MAX_SOURCE_VIDEOS) {
    return { ok: false, error: `MVP allows at most ${MAX_SOURCE_VIDEOS} source video per campaign` };
  }
  if (images.length > MAX_CAMPAIGN_IMAGES) {
    return { ok: false, error: `MVP allows at most ${MAX_CAMPAIGN_IMAGES} images per campaign` };
  }

  for (const video of videos) {
    const duration = video.durationSec ? parseFloat(String(video.durationSec)) : null;
    if (duration != null && duration > MAX_UPLOAD_DURATION_SEC) {
      return {
        ok: false,
        error: `Video exceeds ${MAX_UPLOAD_DURATION_SEC}s limit (${duration.toFixed(1)}s). Trim before running.`,
      };
    }
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
  const videos = assets.filter((a) => a.type === "video");
  const images = assets.filter((a) => a.type === "image");

  if (type === "video" && videos.length >= MAX_SOURCE_VIDEOS) {
    return { ok: false, error: `Only ${MAX_SOURCE_VIDEOS} source video allowed per campaign (MVP)` };
  }
  if (type === "image" && images.length >= MAX_CAMPAIGN_IMAGES) {
    return { ok: false, error: `Maximum ${MAX_CAMPAIGN_IMAGES} images per campaign (MVP)` };
  }

  return { ok: true };
}
