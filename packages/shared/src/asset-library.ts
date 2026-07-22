import { z } from "zod";
import type { AssetType } from "./types/index";

export const LIBRARY_ASSET_TYPES = ["image", "video", "audio", "pdf"] as const;

const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const VIDEO_MIMES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
  "video/x-matroska",
]);

const AUDIO_MIMES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
]);

const PDF_MIMES = new Set(["application/pdf"]);

export function inferAssetTypeFromMime(mimeType: string): AssetType | null {
  const mime = mimeType.toLowerCase().trim();
  if (IMAGE_MIMES.has(mime) || mime.startsWith("image/")) return "image";
  if (VIDEO_MIMES.has(mime) || mime.startsWith("video/")) return "video";
  if (AUDIO_MIMES.has(mime) || mime.startsWith("audio/")) return "audio";
  if (PDF_MIMES.has(mime)) return "pdf";
  return null;
}

export function inferAssetTypeFromFilename(filename: string): AssetType | null {
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
}): { ok: true; type: AssetType } | { ok: false; error: string } {
  const fromMime = input.mimeType ? inferAssetTypeFromMime(input.mimeType) : null;
  const fromName = input.filename ? inferAssetTypeFromFilename(input.filename) : null;
  const fromBody =
    input.type && LIBRARY_ASSET_TYPES.includes(input.type as AssetType)
      ? (input.type as AssetType)
      : null;

  const type = fromBody ?? fromMime ?? fromName;
  if (!type) {
    return {
      ok: false,
      error: "Unsupported file type. Upload image, video, audio, or PDF.",
    };
  }
  if (fromMime && fromBody && fromMime !== fromBody) {
    return { ok: false, error: `File MIME does not match type ${fromBody}` };
  }
  return { ok: true, type };
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const LibraryUploadBodySchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  type: z.enum(["image", "video", "audio", "pdf"]).optional(),
  fileSizeBytes: z.number().positive().optional(),
});

export const StoryCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  assetIds: z.array(z.string().uuid()).default([]),
  status: z.enum(["draft", "ready", "archived"]).optional(),
});

export const StoryUpdateBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["draft", "ready", "archived"]).optional(),
  assetIds: z.array(z.string().uuid()).optional(),
});

export const CampaignMediaAttachBodySchema = z.object({
  assetIds: z.array(z.string().uuid()).optional(),
  storyIds: z.array(z.string().uuid()).optional(),
  mediaAnalysisMode: z.enum(["separate", "story"]).optional(),
  createStoryName: z.string().trim().min(1).max(200).optional(),
});
