import { RENDER_MVP_LIMITS } from "./render";

export const LLM_BUDGET_PER_TASK_USD = 0.5;
export const CEO_MAX_RETRIES = 2;
export const MAX_UPLOAD_DURATION_SEC = RENDER_MVP_LIMITS.MAX_UPLOAD_DURATION_SEC;
export const MAX_COMBINED_SOURCE_DURATION_SEC = RENDER_MVP_LIMITS.MAX_COMBINED_SOURCE_DURATION_SEC;
export const MAX_CAMPAIGN_IMAGES = RENDER_MVP_LIMITS.MAX_IMAGES;
export const MAX_SOURCE_VIDEOS = RENDER_MVP_LIMITS.MAX_SOURCE_VIDEOS;
export const MAX_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024;
export const VISION_MAX_FRAMES = 8;
export const COPY_VARIANT_COUNT = 3;
/** Trim editor end cards (CapCut / 剪映) from source before montage. */
export const SOURCE_END_TRIM_SEC = 3.5;
export const PORTAL_TOKEN_EXPIRY_DAYS = 7;
export const EXPORT_ZIP_TTL_HOURS = 24;

export const STORAGE_PATHS = {
  source: (workspaceId: string, campaignId: string, assetId: string, ext: string) =>
    `${workspaceId}/campaigns/${campaignId}/source/${assetId}.${ext}`,
  preview: (workspaceId: string, campaignId: string, creativeId: string) =>
    `${workspaceId}/campaigns/${campaignId}/renders/${creativeId}/preview_720p.mp4`,
  export: (workspaceId: string, campaignId: string, creativeId: string) =>
    `${workspaceId}/campaigns/${campaignId}/renders/${creativeId}/export_1080p.mp4`,
  export2k: (workspaceId: string, campaignId: string, creativeId: string) =>
    `${workspaceId}/campaigns/${campaignId}/renders/${creativeId}/export_2k.mp4`,
  cover: (workspaceId: string, campaignId: string, creativeId: string) =>
    `${workspaceId}/campaigns/${campaignId}/renders/${creativeId}/cover.jpg`,
  renderCache: (
    workspaceId: string,
    campaignId: string,
    creativeId: string,
    fingerprint: string,
    profile: "preview" | "final" | "2k"
  ) =>
    `${workspaceId}/campaigns/${campaignId}/renders/${creativeId}/cache/${profile}_${fingerprint}_base.mp4`,
  exportPack: (workspaceId: string, campaignId: string, creativeId: string) =>
    `${workspaceId}/campaigns/${campaignId}/exports/${creativeId}/pack.zip`,
  taskExportPack: (
    workspaceId: string,
    campaignId: string,
    taskId: string,
    resolution: "720p" | "1080p" | "2k"
  ) =>
    `${workspaceId}/campaigns/${campaignId}/exports/task_${taskId}/pack_${resolution}.zip`,
  /** Workspace brand logo for video watermark (worker reads via brandProfile.logoUrl). */
  brandLogo: (workspaceId: string, filename = "logo-horizontal.png") =>
    `${workspaceId}/brand/${filename}`,
} as const;
