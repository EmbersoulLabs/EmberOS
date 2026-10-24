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
};

/**
 * SVG is deliberately excluded. It's served from a public, unauthenticated
 * URL, and an SVG document can carry `<script>`/event-handler payloads that
 * execute when the URL is opened directly (stored XSS) — there's no safe way
 * to "allow but sanitize" it here, so raster-only is the fix.
 */
const ALLOWED_BUSINESS_LOGO_MIME_TYPES = new Set(Object.keys(EXT_BY_MIME_TYPE));

export function isBusinessLogoMimeType(mimeType: string) {
  return ALLOWED_BUSINESS_LOGO_MIME_TYPES.has(mimeType.toLowerCase());
}

const IMAGE_SIGNATURES: Array<{ mimeType: string; matches: (bytes: Uint8Array) => boolean }> = [
  {
    mimeType: "image/png",
    matches: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mimeType: "image/jpeg",
    matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimeType: "image/gif",
    matches: (b) => b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  },
  {
    mimeType: "image/webp",
    matches: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

/**
 * The client-supplied `File.type` is trivially spoofable (it's just a form
 * field), so it can't be trusted on its own to keep SVG/HTML bytes out of a
 * public bucket. Confirm the actual bytes match one of the raster signatures
 * we accept before ever uploading them.
 */
export function detectAllowedBusinessLogoImageType(bytes: Uint8Array): string | null {
  return IMAGE_SIGNATURES.find((sig) => sig.matches(bytes))?.mimeType ?? null;
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
