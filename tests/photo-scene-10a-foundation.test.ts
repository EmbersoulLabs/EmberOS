import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  STORAGE_PATHS,
  assertLineageSourceOwnership,
  assertPhotoSceneProductSource,
  assertSameWorkspaceCampaignBind,
  isCanonicalPhotoSceneLibraryPath,
  isPhotoSceneTenantStoragePath,
  isPublicUrlStorageIdentity,
  planPhotoSceneDerivedAsset,
  photoSceneMetadata,
  rejectClientPhotoSceneIdentityOverrides,
  sourceMutationChanged,
  PhotoSceneAssetAuthorityError,
  PHOTO_SCENE_ASSET_ROLES,
  PHOTO_SCENE_SERVER_CONTROLLED_FIELDS,
} from "@ceo-agent/shared";
import { hashSourceAssetFile } from "../apps/worker/src/source-asset-content-hash";
import { canSafelyFinalizeLegacySourceAsset } from "../apps/web/src/lib/source-asset-content-hash";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const ORG_A = "11111111-1111-4111-8111-111111111111";
const WS_A = "22222222-2222-4222-8222-222222222222";
const WS_B = "33333333-3333-4333-8333-333333333333";
const CAMP_A = "44444444-4444-4444-8444-444444444444";
const CAMP_B = "55555555-5555-4555-8555-555555555555";
const ASSET_A = "66666666-6666-4666-8666-666666666666";
const ASSET_B = "77777777-7777-4777-8777-777777777777";
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function productAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET_A,
    orgId: ORG_A,
    workspaceId: WS_A,
    campaignId: CAMP_A,
    type: "image",
    mimeType: "image/png",
    storagePath: STORAGE_PATHS.library(WS_A, ASSET_A, "png"),
    contentHash: HASH_A,
    metadata: { photoScene: photoSceneMetadata("product_source") },
    ...overrides,
  };
}

describe("Photo Scene 10A creative asset foundation", () => {
  it("classifies Photo Scene roles without a new assets.type enum", () => {
    expect(PHOTO_SCENE_ASSET_ROLES).toEqual([
      "product_source",
      "extracted_product",
      "marketing_image",
    ]);
    const types = read("packages/shared/src/types/index.ts");
    expect(types).toMatch(/AssetTypeSchema = z\.enum\(\["video", "image"\]\)/);
    expect(read("packages/db/src/schema/index.ts")).not.toMatch(
      /pgTable\(\s*"creative_assets"|pgTable\(\s*"creative_studio_jobs"/
    );
    expect(read("packages/db/sql/photo-scene-campaign-asset-refs-v1.sql")).toMatch(
      /CREATE TABLE IF NOT EXISTS campaign_asset_refs/
    );
    expect(read("packages/db/sql/photo-scene-campaign-asset-refs-v1.sql")).not.toMatch(
      /CREATE TABLE IF NOT EXISTS (creative_assets|creative_studio_jobs|photo_scene_generations|official_scenes)/
    );
  });

  it("accepts a workspace image with canonical hash as a product source", () => {
    expect(
      assertPhotoSceneProductSource({
        asset: productAsset(),
        expectedOrgId: ORG_A,
        expectedWorkspaceId: WS_A,
      })
    ).toBe(HASH_A);
  });

  it("rejects video, foreign workspace, public URL, and missing hash sources", () => {
    expect(() =>
      assertPhotoSceneProductSource({
        asset: productAsset({ type: "video", mimeType: "video/mp4" }),
        expectedOrgId: ORG_A,
        expectedWorkspaceId: WS_A,
      })
    ).toThrow(PhotoSceneAssetAuthorityError);

    expect(() =>
      assertPhotoSceneProductSource({
        asset: productAsset({ workspaceId: WS_B, storagePath: STORAGE_PATHS.library(WS_B, ASSET_A, "png") }),
        expectedOrgId: ORG_A,
        expectedWorkspaceId: WS_A,
      })
    ).toThrow(/authorized workspace/);

    expect(() =>
      assertPhotoSceneProductSource({
        asset: productAsset({
          storagePath: `https://example.supabase.co/storage/v1/object/public/campaign-assets/${WS_A}/library/${ASSET_A}.png`,
        }),
        expectedOrgId: ORG_A,
        expectedWorkspaceId: WS_A,
      })
    ).toThrow(/public URL/);

    expect(() =>
      assertPhotoSceneProductSource({
        asset: productAsset({ contentHash: null }),
        expectedOrgId: ORG_A,
        expectedWorkspaceId: WS_A,
      })
    ).toThrow(/contentHash/);
  });

  it("hashes image bytes with the existing server SHA-256 primitive", async () => {
    const directory = await mkdtemp(join(tmpdir(), "photo-scene-hash-"));
    try {
      const first = join(directory, "a.png");
      const second = join(directory, "b.png");
      await writeFile(first, "abc");
      await writeFile(second, "abd");
      const hashA = await hashSourceAssetFile(first);
      const hashB = await hashSourceAssetFile(second);
      expect(hashA).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
      expect(hashB).not.toBe(hashA);
      expect(canSafelyFinalizeLegacySourceAsset({ type: "image", durationSec: null, metadata: {} })).toBe(
        true
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects client identity, hash, storage, and lineage overrides", () => {
    expect(() => rejectClientPhotoSceneIdentityOverrides({})).not.toThrow();
    expect(() => rejectClientPhotoSceneIdentityOverrides({ contentHash: HASH_A })).toThrow(
      /server-controlled/
    );
    expect(() =>
      rejectClientPhotoSceneIdentityOverrides({
        metadata: { photoScene: photoSceneMetadata("marketing_image") },
      })
    ).toThrow(/server-controlled/);
    expect(PHOTO_SCENE_SERVER_CONTROLLED_FIELDS).toContain("contentHash");
  });

  it("stores extraction lineage on metadata.photoScene and rejects foreign sources", () => {
    const plan = planPhotoSceneDerivedAsset({
      assetId: ASSET_B,
      orgId: ORG_A,
      workspaceId: WS_A,
      campaignId: CAMP_A,
      ext: "png",
      mimeType: "image/png",
      contentHash: HASH_B,
      role: "extracted_product",
      lineage: {
        sourceAssetId: ASSET_A,
        sourceContentHash: HASH_A,
        operation: "product_extraction",
      },
    });
    expect(plan.metadata.photoScene.lineage?.sourceAssetId).toBe(ASSET_A);
    expect(plan.metadata.photoScene.lineage?.sourceContentHash).toBe(HASH_A);
    expect(plan.storagePath).toBe(STORAGE_PATHS.library(WS_A, ASSET_B, "png"));
    expect(() =>
      assertLineageSourceOwnership({
        derivedOrgId: ORG_A,
        derivedWorkspaceId: WS_A,
        source: productAsset({ workspaceId: WS_B, orgId: ORG_A }),
      })
    ).toThrow(/foreign workspace/);
  });

  it("binds same-workspace campaign refs and denies cross-workspace binds", () => {
    expect(() =>
      assertSameWorkspaceCampaignBind({
        asset: productAsset(),
        campaign: { id: CAMP_A, orgId: ORG_A, workspaceId: WS_A },
      })
    ).not.toThrow();
    expect(() =>
      assertSameWorkspaceCampaignBind({
        asset: productAsset(),
        campaign: { id: CAMP_B, orgId: ORG_A, workspaceId: WS_B },
      })
    ).toThrow(/workspace/);
    const sql = read("packages/db/sql/photo-scene-campaign-asset-refs-v1.sql");
    expect(sql).toMatch(/UNIQUE \(campaign_id, asset_id\)/);
    expect(sql).toMatch(/ON CONFLICT \(campaign_id, asset_id\) DO NOTHING/);
  });

  it("uses workspace library storage identity rather than public URLs", () => {
    expect(STORAGE_PATHS.library(WS_A, ASSET_A, "png")).toBe(`${WS_A}/library/${ASSET_A}.png`);
    expect(isCanonicalPhotoSceneLibraryPath(WS_A, ASSET_A, STORAGE_PATHS.library(WS_A, ASSET_A, "png"))).toBe(
      true
    );
    expect(isPhotoSceneTenantStoragePath(WS_A, STORAGE_PATHS.library(WS_B, ASSET_A, "png"))).toBe(false);
    expect(isPublicUrlStorageIdentity("https://cdn.example/file.png")).toBe(true);
    expect(STORAGE_PATHS.library(WS_A, ASSET_A, "png")).not.toEqual(
      STORAGE_PATHS.library(WS_B, ASSET_A, "png")
    );
  });

  it("treats same asset id with a new contentHash as a different source version", () => {
    expect(sourceMutationChanged(HASH_A, HASH_A)).toBe(false);
    expect(sourceMutationChanged(HASH_A, HASH_B)).toBe(true);
    expect(sourceMutationChanged(null, HASH_A)).toBe(true);
  });

  it("does not import Video Studio renderer, AI Story, AUTH-01, or Publishing", () => {
    const foundation = read("packages/shared/src/photo-scene-asset.ts");
    expect(foundation).not.toMatch(/editing-director|source-rhythm|ai-story|AUTH-01|publishJobs|ffmpeg/);
    expect(foundation).not.toMatch(/campaign-video-generation-identity|video-artifact-delivery/);
  });

  it("keeps business-branding separate from Photo Scene tenant storage", () => {
    const branding = read("packages/shared/src/business-branding-storage.ts");
    expect(branding).toContain('DEFAULT_BUSINESS_BRANDING_BUCKET = "business-branding"');
    expect(branding).toContain('DEFAULT_VIDEO_STUDIO_STORAGE_BUCKET = "campaign-assets"');
    expect(STORAGE_PATHS.library(WS_A, ASSET_A, "png")).not.toContain("/brand/");
  });
});
