import { z } from "zod";
export const LIBRARY_ASSET_TYPES = ["image", "video", "audio", "pdf"] as const;
export type LibraryAssetType = (typeof LIBRARY_ASSET_TYPES)[number];
export const ASSET_STORY_STATUSES = ["draft", "ready", "archived"] as const;

export function inferAssetTypeFromMime(mimeType: string): LibraryAssetType | null {
  const mime = mimeType.toLowerCase().trim();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  return null;
}

export function inferAssetTypeFromFilename(filename: string): LibraryAssetType | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "avi", "mkv", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "aac", "m4a", "ogg", "flac"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  return null;
}

export function resolveLibraryAssetType(input: {
  mimeType?: string;
  filename?: string;
  type?: string;
}): { ok: true; type: LibraryAssetType } | { ok: false; error: string } {
  const fromMime = input.mimeType ? inferAssetTypeFromMime(input.mimeType) : null;
  const fromName = input.filename ? inferAssetTypeFromFilename(input.filename) : null;
  const fromBody = input.type && LIBRARY_ASSET_TYPES.includes(input.type as LibraryAssetType)
    ? (input.type as LibraryAssetType)
    : null;
  const type = fromBody ?? fromMime ?? fromName;
  if (!type) return { ok: false, error: "Unsupported file type. Upload image, video, audio, or PDF." };
  if (fromMime && fromBody && fromMime !== fromBody) {
    return { ok: false, error: `File MIME does not match type ${fromBody}` };
  }
  return { ok: true, type };
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function resolveAssetDisplayLabel(asset: {
  displayName?: string | null;
  originalFilename?: string | null;
  id: string;
}): string {
  return asset.displayName?.trim() || asset.originalFilename?.trim() || `Asset ${asset.id.slice(0, 8)}`;
}

export const LibraryUploadBodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  type: z.enum(LIBRARY_ASSET_TYPES).optional(),
  fileSizeBytes: z.number().int().positive(),
});

const OrderedAssetIdsSchema = z.array(z.string().uuid()).max(200).refine(
  (ids) => new Set(ids).size === ids.length,
  "Asset references must be unique"
);

export const AssetStoryCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  assetIds: OrderedAssetIdsSchema.default([]),
  coverAssetId: z.string().uuid().nullable().optional(),
  status: z.enum(ASSET_STORY_STATUSES).optional(),
}).superRefine((value, ctx) => {
  if (value.coverAssetId && !value.assetIds.includes(value.coverAssetId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["coverAssetId"], message: "Cover must be one of the Story assets" });
  }
});

export const AssetStoryUpdateBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  assetIds: OrderedAssetIdsSchema.optional(),
  coverAssetId: z.string().uuid().nullable().optional(),
  status: z.enum(ASSET_STORY_STATUSES).optional(),
  expectedVersion: z.number().int().positive(),
}).superRefine((value, ctx) => {
  if (value.assetIds && value.coverAssetId && !value.assetIds.includes(value.coverAssetId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["coverAssetId"], message: "Cover must be one of the Story assets" });
  }
});

export const CampaignAssetAttachBodySchema = z.object({
  assetIds: z.array(z.string().uuid()).max(200).default([]),
  storyIds: z.array(z.string().uuid()).max(50).default([]),
});
