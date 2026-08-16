import { randomUUID } from "node:crypto";
import {
  STORAGE_PATHS,
  configuredBusinessBrandingBucket,
  isBusinessLogoObjectKey,
  publicBrandingObjectUrl,
  resolveLogoStorageReference,
} from "@ceo-agent/shared";

/** Dedicated public branding bucket. Never SUPABASE_STORAGE_BUCKET / campaign-assets. */
export function getBusinessLogoBucket() {
  return configuredBusinessBrandingBucket();
}

/** Request-time branding bucket. Prefer getBusinessLogoBucket() in new code. */
export const BUSINESS_LOGO_BUCKET = getBusinessLogoBucket();

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
  return publicBrandingObjectUrl(baseUrl, bucket, storagePath);
}

/**
 * Resolve a persisted Business Profile logo to a managed object.
 * Accepts branding-bucket public URLs and leftover campaign-assets public URLs
 * for delete/replace cleanup only.
 */
export function storagePathFromBusinessLogoUrl(
  value: string | null | undefined,
  _baseUrl: string,
  _bucket: string,
  workspaceId: string
) {
  const resolved = resolveLogoStorageReference(value);
  if (!resolved) return null;
  if (!isBusinessLogoObjectKey(workspaceId, resolved.objectKey)) return null;
  return resolved.objectKey;
}

export function businessLogoStorageFromPersistedValue(
  value: string | null | undefined,
  workspaceId: string
) {
  const resolved = resolveLogoStorageReference(value);
  if (!resolved) return null;
  if (!isBusinessLogoObjectKey(workspaceId, resolved.objectKey)) return null;
  return resolved;
}
