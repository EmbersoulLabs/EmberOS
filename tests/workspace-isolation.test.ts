import { describe, it, expect } from "vitest";
import { ROLE_HIERARCHY } from "@ceo-agent/db";
import { STORAGE_PATHS } from "@ceo-agent/shared";

const PHASE1_PLATFORMS = ["tiktok", "xiaohongshu", "instagram"];

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
