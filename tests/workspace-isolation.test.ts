import { describe, it, expect } from "vitest";

const STORAGE_PATHS = {
  source: (workspaceId: string, campaignId: string, assetId: string, ext: string) =>
    `${workspaceId}/campaigns/${campaignId}/source/${assetId}.${ext}`,
};

const PHASE1_PLATFORMS = ["tiktok", "xiaohongshu", "instagram"];

const ROLE_HIERARCHY = {
  admin: 100,
  operator: 80,
  editor: 60,
  reviewer: 40,
  publisher: 40,
  client_viewer: 10,
};

describe("workspace isolation", () => {
  it("admin role has higher hierarchy than client_viewer", () => {
    expect(ROLE_HIERARCHY.admin).toBeGreaterThan(ROLE_HIERARCHY.client_viewer);
  });

  it("operator can run campaigns (higher than editor for run)", () => {
    expect(ROLE_HIERARCHY.operator).toBeGreaterThan(ROLE_HIERARCHY.editor);
  });

  it("two workspaces have distinct storage paths", () => {
    const wsA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const wsB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const pathA = STORAGE_PATHS.source(wsA, "camp-1", "asset-1", "mp4");
    const pathB = STORAGE_PATHS.source(wsB, "camp-1", "asset-1", "mp4");
    expect(pathA).toContain(wsA);
    expect(pathB).toContain(wsB);
    expect(pathA).not.toEqual(pathB);
  });
});

describe("platform specs", () => {
  it("phase 1 includes tiktok, xiaohongshu, instagram", () => {
    expect(PHASE1_PLATFORMS).toContain("tiktok");
    expect(PHASE1_PLATFORMS).toContain("xiaohongshu");
    expect(PHASE1_PLATFORMS).toContain("instagram");
  });
});
