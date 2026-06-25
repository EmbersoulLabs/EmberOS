import { RENDER_MVP_LIMITS } from "./render";

export type VideoAssetLike = {
  type: string;
  durationSec?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: Date | string | null;
};

export function parseVideoDurationSec(durationSec?: string | null): number | null {
  if (durationSec == null || durationSec === "") return null;
  const value = parseFloat(String(durationSec));
  return Number.isFinite(value) ? value : null;
}

export function isMergedSourceAsset(metadata?: Record<string, unknown> | null): boolean {
  return metadata?.merged === true;
}

export function isRejectedSourceAsset(metadata?: Record<string, unknown> | null): boolean {
  return metadata?.rejected === true;
}

/** User-uploaded source videos only (excludes merged output and rejected probes). */
export function listUploadVideoAssets<T extends VideoAssetLike>(assets: T[]): T[] {
  return assets
    .filter(
      (asset) =>
        asset.type === "video" &&
        !isMergedSourceAsset(asset.metadata) &&
        !isRejectedSourceAsset(asset.metadata)
    )
    .sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return aTime - bTime;
    });
}

export function sumUploadVideoDurationSec(assets: VideoAssetLike[]): number {
  return listUploadVideoAssets(assets).reduce((total, asset) => {
    const duration = parseVideoDurationSec(asset.durationSec);
    return total + (duration ?? 0);
  }, 0);
}

export function validateCombinedVideoDurationSec(
  totalSec: number
): { ok: true } | { ok: false; error: string } {
  const max = RENDER_MVP_LIMITS.MAX_COMBINED_SOURCE_DURATION_SEC;
  if (totalSec > max) {
    const maxMin = Math.round(max / 60);
    return {
      ok: false,
      error: `Combined video duration exceeds ${maxMin} minutes (${totalSec.toFixed(1)}s total). Trim or remove clips.`,
    };
  }
  return { ok: true };
}

export function resolveAutoClipSourceAsset<T extends VideoAssetLike>(
  assets: T[]
): { asset: T; durationSec: number } | null {
  const merged = assets.find(
    (asset) => asset.type === "video" && isMergedSourceAsset(asset.metadata)
  );
  if (merged) {
    const duration = parseVideoDurationSec(merged.durationSec);
    return { asset: merged, durationSec: duration ?? 60 };
  }

  const uploads = listUploadVideoAssets(assets);
  if (uploads.length === 0) return null;

  const summed = sumUploadVideoDurationSec(uploads);
  const fallback = parseVideoDurationSec(uploads[0]!.durationSec);
  return {
    asset: uploads[0]!,
    durationSec: summed > 0 ? summed : (fallback ?? 60),
  };
}

export function hasRawVideoAssets(assets: VideoAssetLike[]): boolean {
  return assets.some((asset) => asset.type === "video");
}

export function hasRejectedVideosOnly(assets: VideoAssetLike[]): boolean {
  const raw = assets.filter((asset) => asset.type === "video");
  return raw.length > 0 && listUploadVideoAssets(assets).length === 0;
}

/** Uploaded videos waiting for ffmpeg.probe (no duration yet). */
export function listVideosPendingProbe<T extends VideoAssetLike>(assets: T[]): T[] {
  return listUploadVideoAssets(assets).filter(
    (asset) => parseVideoDurationSec(asset.durationSec) == null
  );
}
