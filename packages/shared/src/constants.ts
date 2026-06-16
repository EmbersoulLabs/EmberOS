export const LLM_BUDGET_PER_TASK_USD = 0.5;
export const CEO_MAX_RETRIES = 2;
export const MAX_UPLOAD_DURATION_SEC = 180;
export const MAX_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024;
export const VISION_MAX_FRAMES = 8;
export const COPY_VARIANT_COUNT = 3;
export const PORTAL_TOKEN_EXPIRY_DAYS = 7;
export const EXPORT_ZIP_TTL_HOURS = 24;

export const STORAGE_PATHS = {
  source: (workspaceId: string, campaignId: string, assetId: string, ext: string) =>
    `${workspaceId}/campaigns/${campaignId}/source/${assetId}.${ext}`,
  preview: (workspaceId: string, campaignId: string, creativeId: string) =>
    `${workspaceId}/campaigns/${campaignId}/renders/${creativeId}/preview_720p.mp4`,
  export: (workspaceId: string, campaignId: string, creativeId: string) =>
    `${workspaceId}/campaigns/${campaignId}/renders/${creativeId}/export_1080p.mp4`,
  cover: (workspaceId: string, campaignId: string, creativeId: string) =>
    `${workspaceId}/campaigns/${campaignId}/renders/${creativeId}/cover.jpg`,
  exportPack: (workspaceId: string, campaignId: string, creativeId: string) =>
    `${workspaceId}/campaigns/${campaignId}/exports/${creativeId}/pack.zip`,
} as const;
