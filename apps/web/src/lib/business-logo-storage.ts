import { randomUUID } from "node:crypto";
import { STORAGE_PATHS } from "@ceo-agent/shared";

export const BUSINESS_LOGO_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";

const EXT_BY_MIME_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export function isBusinessLogoMimeType(mimeType: string) {
  return mimeType.startsWith("image/");
}

export function businessLogoExtension(filename: string, mimeType: string) {
  const normalizedMime = mimeType.toLowerCase();
  const byMime = EXT_BY_MIME_TYPE[normalizedMime];
  if (byMime) return byMime;

  const ext = filename.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext || "png";
}

export function createBusinessLogoStoragePath(
  workspaceId: string,
  filename: string,
  mimeType: string,
  logoId = randomUUID()
) {
  return STORAGE_PATHS.businessLogo(workspaceId, logoId, businessLogoExtension(filename, mimeType));
}

export function publicBusinessLogoUrl(baseUrl: string, bucket: string, storagePath: string) {
  return `${baseUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${storagePath}`;
}

export function storagePathFromBusinessLogoUrl(
  value: string | null | undefined,
  baseUrl: string,
  bucket: string,
  workspaceId: string
) {
  if (!value) return null;
  const publicPrefix = `${baseUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/`;
  const storagePath = value.startsWith(publicPrefix) ? value.slice(publicPrefix.length) : value;
  const workspaceBrandPrefix = `${workspaceId}/brand/business-logo-`;
  return storagePath.startsWith(workspaceBrandPrefix) ? storagePath : null;
}
