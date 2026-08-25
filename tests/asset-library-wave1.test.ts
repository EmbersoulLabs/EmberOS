import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AssetStoryCreateBodySchema,
  AssetStoryUpdateBodySchema,
  STORAGE_PATHS,
  inferAssetTypeFromFilename,
  resolveLibraryAssetType,
} from "@ceo-agent/shared";

describe("Wave 1 Workspace Asset Library contracts", () => {
  it("accepts supported private media and rejects MIME/type mismatch", () => {
    expect(inferAssetTypeFromFilename("product.pdf")).toBe("pdf");
    expect(resolveLibraryAssetType({ filename: "product.png", mimeType: "image/png", type: "image" })).toEqual({ ok: true, type: "image" });
    expect(resolveLibraryAssetType({ filename: "product.png", mimeType: "image/png", type: "video" })).toMatchObject({ ok: false });
    expect(STORAGE_PATHS.library("workspace", "asset", "png")).toBe("workspace/library/asset.png");
  });

  it("requires unique ordered Story assets and a cover from that order", () => {
    const assetA = "00000000-0000-4000-8000-000000000001";
    const assetB = "00000000-0000-4000-8000-000000000002";
    expect(AssetStoryCreateBodySchema.safeParse({ name: "Launch", assetIds: [assetA], coverAssetId: assetA }).success).toBe(true);
    expect(AssetStoryCreateBodySchema.safeParse({ name: "Launch", assetIds: [assetA], coverAssetId: assetB }).success).toBe(false);
    expect(AssetStoryCreateBodySchema.safeParse({ name: "Launch", assetIds: [assetA, assetA] }).success).toBe(false);
    expect(AssetStoryUpdateBodySchema.safeParse({ expectedVersion: 2, assetIds: [assetA] }).success).toBe(true);
  });

  it("uses certified private signing and never persists a signed URL", () => {
    const download = readFileSync("apps/web/src/app/api/workspaces/[id]/library/[assetId]/download-url/route.ts", "utf8");
    const schema = readFileSync("packages/db/src/schema/index.ts", "utf8");
    expect(download).toContain("signPrivateCampaignAsset");
    expect(download).not.toMatch(/console\.(log|info).*downloadUrl/);
    expect(schema).not.toMatch(/signedUrl|signed_url/);
  });

  it("preserves Campaign, AI Story, Photo Scene, and Video Studio identities", () => {
    const campaignAssets = readFileSync("apps/web/src/lib/campaign-assets.ts", "utf8");
    const campaignRefs = readFileSync("packages/db/src/queries/campaign-asset-refs.ts", "utf8");
    const aiStoryPersistence = readFileSync("packages/db/src/queries/ai-story-scene-execution-persistence.ts", "utf8");
    const migration = readFileSync("packages/db/sql/asset-library-wave1-v1.sql", "utf8");
    expect(campaignAssets).toContain("asc(schema.assets.createdAt), asc(schema.assets.id)");
    expect(campaignAssets).not.toMatch(/campaignAssetRefs|campaignStoryRefs/);
    expect(campaignRefs).toContain("persistSameWorkspaceCampaignAssetRef");
    expect(aiStoryPersistence).toContain("campaignAssetRefs");
    expect(migration).toContain("Historical rows retain their IDs");
    expect(migration).not.toMatch(/UPDATE assets SET id|DELETE FROM assets/);
  });

  it("defers Asset auto-name and does not add provider execution", () => {
    const confirm = readFileSync("apps/web/src/app/api/workspaces/[id]/library/[assetId]/confirm/route.ts", "utf8");
    expect(confirm).not.toContain("suggestReadableAssetName");
    expect(confirm).not.toContain("executeSkill");
  });
});
