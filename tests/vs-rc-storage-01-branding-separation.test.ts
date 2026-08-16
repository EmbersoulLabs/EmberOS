import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BRANDING_LOGO_OBJECT_PREFIX,
  DEFAULT_BUSINESS_BRANDING_BUCKET,
  DEFAULT_VIDEO_STUDIO_STORAGE_BUCKET,
  configuredBusinessBrandingBucket,
  configuredVideoStudioStorageBucket,
  freezeLogoObjectReference,
  publicBrandingObjectUrl,
  resolveLogoStorageReference,
} from "../packages/shared/src/business-branding-storage";
import {
  BUSINESS_LOGO_BUCKET,
  getBusinessLogoBucket,
  publicBusinessLogoUrl,
} from "../apps/web/src/lib/business-logo-storage";

const ROOT = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const WS = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LOGO_KEY = `${WS}/brand/business-logo-11111111-1111-4111-8111-111111111111.png`;
const LEGACY_WATERMARK = `${WS}/brand/logo-horizontal.png`;

describe("VS-RC-STORAGE-01 branding bucket separation", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_BRANDING_BUCKET;
    delete process.env.SUPABASE_STORAGE_BUCKET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  });

  it("keeps Video Studio and branding bucket authorities distinct", () => {
    expect(DEFAULT_BUSINESS_BRANDING_BUCKET).toBe("business-branding");
    expect(DEFAULT_VIDEO_STUDIO_STORAGE_BUCKET).toBe("campaign-assets");
    expect(configuredBusinessBrandingBucket()).not.toBe(configuredVideoStudioStorageBucket());
    expect(getBusinessLogoBucket()).toBe("business-branding");
    expect(BUSINESS_LOGO_BUCKET).not.toBe("campaign-assets");
    expect(getBusinessLogoBucket()).not.toBe(configuredVideoStudioStorageBucket());
  });

  it("uploads construct a public branding URL, not campaign-assets", () => {
    const url = publicBusinessLogoUrl(
      "https://example.supabase.co",
      getBusinessLogoBucket(),
      LOGO_KEY
    );
    expect(url).toBe(
      `https://example.supabase.co/storage/v1/object/public/business-branding/${LOGO_KEY}`
    );
    expect(url).not.toContain("/object/public/campaign-assets/");
    expect(publicBrandingObjectUrl("https://example.supabase.co/", "business-branding", LOGO_KEY)).toBe(
      url
    );
  });

  it("freezes a branding public URL with explicit bucket identity for the worker", () => {
    const publicUrl = publicBrandingObjectUrl(
      "https://example.supabase.co",
      "business-branding",
      LOGO_KEY
    );
    const frozen = freezeLogoObjectReference(publicUrl);
    expect(frozen).toBe(`${BRANDING_LOGO_OBJECT_PREFIX}business-branding:${LOGO_KEY}`);
    expect(frozen).not.toBe(LOGO_KEY);
    const resolved = resolveLogoStorageReference(frozen);
    expect(resolved).toEqual({ bucket: "business-branding", objectKey: LOGO_KEY });
  });

  it("keeps legacy workspace brandProfile storage paths on campaign-assets", () => {
    const frozen = freezeLogoObjectReference(LEGACY_WATERMARK);
    expect(frozen).toBe(LEGACY_WATERMARK);
    expect(resolveLogoStorageReference(frozen)).toEqual({
      bucket: "campaign-assets",
      objectKey: LEGACY_WATERMARK,
    });
  });

  it("maps leftover campaign-assets business-logo public URLs without rewriting Video Studio artifacts", () => {
    const legacyPublic = `https://example.supabase.co/storage/v1/object/public/campaign-assets/${LOGO_KEY}`;
    const frozen = freezeLogoObjectReference(legacyPublic);
    expect(frozen).toBe(LOGO_KEY);
    expect(resolveLogoStorageReference(legacyPublic)).toEqual({
      bucket: "campaign-assets",
      objectKey: LOGO_KEY,
    });
  });

  it("does not treat Video Studio campaign-assets as the business-logo upload bucket in source", () => {
    const upload = read("apps/web/src/lib/business-logo-storage.ts");
    const route = read("apps/web/src/app/api/workspaces/[id]/business-profile/logo/route.ts");
    expect(upload).toContain("configuredBusinessBrandingBucket");
    expect(upload).not.toMatch(/SUPABASE_STORAGE_BUCKET \?\? ["']campaign-assets["']/);
    expect(route).toContain("getBusinessLogoBucket");
    expect(read("apps/web/src/lib/campaign-run.ts")).toContain("freezeLogoObjectReference");
    expect(read("apps/worker/src/processors/render-handler.ts")).toContain("resolveLogoStorageReference");
    expect(read("apps/web/src/lib/video-artifact-delivery.ts")).toContain(
      'process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets"'
    );
  });

  it("preserves FIX-01 historical public URL normalization source", () => {
    const delivery = read("apps/web/src/lib/video-artifact-delivery.ts");
    expect(delivery).toContain("/storage/v1/object/public/${bucket}/${expectedObjectKey}");
    expect(delivery).toContain("VIDEO_ARTIFACT_SIGNED_URL_TTL_SECONDS = 10 * 60");
    expect(delivery).toContain("createSignedUrl");
  });
});
