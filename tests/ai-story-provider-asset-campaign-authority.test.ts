import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createWorkerProviderAssetAccessResolver } from "../apps/worker/src/ai-story-provider-asset-access";

const valid = {
  assetId: "70000000-0000-4000-8000-000000000001",
  orgId: "70000000-0000-4000-8000-000000000002",
  workspaceId: "70000000-0000-4000-8000-000000000003",
  campaignId: "70000000-0000-4000-8000-000000000004",
  storagePath: "workspace/private/first-frame.png",
};

describe("Worker Provider Asset canonical Campaign authority", () => {
  it("uses campaign_asset_refs and never legacy assets.campaign_id", async () => {
    const source = await readFile(
      "apps/worker/src/ai-story-provider-asset-access.ts",
      "utf8"
    );
    expect(source).toContain("schema.campaignAssetRefs");
    expect(source).toContain("schema.campaigns.orgId");
    expect(source).toContain("schema.campaigns.workspaceId");
    expect(source).not.toContain("schema.assets.campaignId");
  });

  it("preserves MIME, storage identity, scope, and private URL safety checks", async () => {
    const mintSignedUrl = vi.fn(async () => "https://storage.invalid/temporary.png");
    const resolver = createWorkerProviderAssetAccessResolver({
      loadAuthorizedAsset: vi.fn(async (input) =>
        input.assetId === valid.assetId &&
        input.orgId === valid.orgId &&
        input.workspaceId === valid.workspaceId &&
        input.campaignId === valid.campaignId
          ? { storagePath: valid.storagePath, mimeType: "image/png" }
          : null
      ),
      mintSignedUrl,
    });

    await expect(resolver.resolveProviderAccessibleUri(valid)).resolves.toBe(
      "https://storage.invalid/temporary.png"
    );
    for (const input of [
      { ...valid, assetId: crypto.randomUUID() },
      { ...valid, orgId: crypto.randomUUID() },
      { ...valid, workspaceId: crypto.randomUUID() },
      { ...valid, campaignId: crypto.randomUUID() },
    ]) {
      await expect(resolver.resolveProviderAccessibleUri(input)).rejects.toThrow(
        /not authorized/i
      );
    }
    await expect(
      resolver.resolveProviderAccessibleUri({
        ...valid,
        storagePath: "workspace/private/tampered.png",
      })
    ).rejects.toThrow(/storage identity mismatch/i);
    expect(mintSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("fails closed for a non-image first-frame authority", async () => {
    const resolver = createWorkerProviderAssetAccessResolver({
      loadAuthorizedAsset: vi.fn(async () => ({
        storagePath: "workspace/private/not-an-image.mp4",
        mimeType: "video/mp4",
      })),
      mintSignedUrl: vi.fn(),
    });
    await expect(resolver.resolveProviderAccessibleUri(valid)).rejects.toThrow(
      /supported visual reference/i
    );
  });
});
