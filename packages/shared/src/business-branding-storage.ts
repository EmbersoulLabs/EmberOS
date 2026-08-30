/**
 * Bounded branding-storage authority (VS-RC-STORAGE-01).
 *
 * Video Studio artifacts remain in campaign-assets.
 * Intentionally public business logos live in a dedicated branding bucket.
 */

export const DEFAULT_VIDEO_STUDIO_STORAGE_BUCKET = "campaign-assets";
export const DEFAULT_BUSINESS_BRANDING_BUCKET = "business-branding";

/** Frozen identity prefix for logos that are not in the Video Studio bucket. */
export const BRANDING_LOGO_OBJECT_PREFIX = "branding-object:";

export function configuredVideoStudioStorageBucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET?.trim() || DEFAULT_VIDEO_STUDIO_STORAGE_BUCKET;
}

export function configuredBusinessBrandingBucket(): string {
  return process.env.SUPABASE_BRANDING_BUCKET?.trim() || DEFAULT_BUSINESS_BRANDING_BUCKET;
}

export type LogoStorageReference = {
  readonly bucket: string;
  readonly objectKey: string;
};

function parsePublicObjectUrl(value: string): LogoStorageReference | null {
  try {
    const url = new URL(value);
    const marker = "/storage/v1/object/public/";
    const index = url.pathname.indexOf(marker);
    if (index < 0) return null;
    const bucketAndPath = decodeURIComponent(url.pathname.slice(index + marker.length));
    const slash = bucketAndPath.indexOf("/");
    if (slash <= 0) return null;
    const bucket = bucketAndPath.slice(0, slash);
    const objectKey = bucketAndPath.slice(slash + 1);
    if (!bucket || !objectKey) return null;
    return { bucket, objectKey };
  } catch {
    return null;
  }
}

function parseBrandingObjectRef(value: string): LogoStorageReference | null {
  if (!value.startsWith(BRANDING_LOGO_OBJECT_PREFIX)) return null;
  const rest = value.slice(BRANDING_LOGO_OBJECT_PREFIX.length);
  const colon = rest.indexOf(":");
  if (colon <= 0) return null;
  const bucket = rest.slice(0, colon);
  const objectKey = rest.slice(colon + 1);
  if (!bucket || !objectKey) return null;
  return { bucket, objectKey };
}

/** Resolve a persisted logo value to bucket + object key for worker/service-role reads. */
export function resolveLogoStorageReference(
  value: string | null | undefined
): LogoStorageReference | null {
  const raw = value?.trim();
  if (!raw) return null;

  const branded = parseBrandingObjectRef(raw);
  if (branded) return branded;

  const fromUrl = parsePublicObjectUrl(raw);
  if (fromUrl) return fromUrl;

  return {
    bucket: configuredVideoStudioStorageBucket(),
    objectKey: raw,
  };
}

/**
 * Freeze a logo value into the campaign-run identity string.
 * campaign-assets paths stay bare so existing workspace brandProfile.logoUrl
 * fingerprints do not change. Branding-bucket logos carry explicit bucket identity.
 */
export function freezeLogoObjectReference(
  value: string | null | undefined
): string | null {
  const resolved = resolveLogoStorageReference(value);
  if (!resolved) return null;
  if (resolved.bucket === configuredVideoStudioStorageBucket()) {
    return resolved.objectKey;
  }
  return `${BRANDING_LOGO_OBJECT_PREFIX}${resolved.bucket}:${resolved.objectKey}`;
}

export function publicBrandingObjectUrl(
  baseUrl: string,
  bucket: string,
  objectKey: string
): string {
  return `${baseUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${objectKey}`;
}

export function isBusinessLogoObjectKey(workspaceId: string, objectKey: string): boolean {
  return objectKey.startsWith(`${workspaceId}/brand/business-logo-`);
}
