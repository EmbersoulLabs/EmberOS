import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  inferAssetTypeFromFilename,
  inferAssetTypeFromMime,
  resolveLibraryAssetType,
  STORAGE_PATHS,
} from "@ceo-agent/shared";
import { isDatabaseSchemaError } from "../apps/web/src/lib/database-errors";

describe("asset library types (PD-036)", () => {
  it("detects missing deployed tables and columns as schema configuration failures", () => {
    expect(isDatabaseSchemaError({ code: "42P01" })).toBe(true);
    expect(isDatabaseSchemaError({ code: "42703" })).toBe(true);
    expect(isDatabaseSchemaError({ code: "23505" })).toBe(false);
    expect(isDatabaseSchemaError(new Error("upload failed"))).toBe(false);
  });
  it("infers image/video/audio/pdf from mime and filename", () => {
    expect(inferAssetTypeFromMime("image/png")).toBe("image");
    expect(inferAssetTypeFromMime("video/mp4")).toBe("video");
    expect(inferAssetTypeFromMime("audio/mpeg")).toBe("audio");
    expect(inferAssetTypeFromMime("application/pdf")).toBe("pdf");
    expect(inferAssetTypeFromFilename("clip.mov")).toBe("video");
    expect(inferAssetTypeFromFilename("deck.pdf")).toBe("pdf");
  });

  it("rejects unsupported types with a clear message", () => {
    const result = resolveLibraryAssetType({
      filename: "malware.exe",
      mimeType: "application/octet-stream",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Unsupported file type/i);
    }
  });

  it("uses workspace library storage paths without campaign ownership", () => {
    expect(STORAGE_PATHS.library("ws-1", "asset-1", "mp4")).toBe("ws-1/library/asset-1.mp4");
    expect(STORAGE_PATHS.library("ws-1", "asset-1", "mp4")).not.toContain("/campaigns/");
  });

  it("does not write the legacy assets.campaign_id field from new upload paths", () => {
    const sources = [
      "apps/web/src/app/api/campaigns/[id]/assets/upload-url/route.ts",
      "apps/web/src/app/api/workspaces/[id]/library/route.ts",
      "apps/worker/src/media/merge-source-videos.ts",
    ].map((path) => readFileSync(path, "utf8"));

    for (const source of sources) {
      expect(source).not.toContain("campaignId: null");
    }
  });
});
