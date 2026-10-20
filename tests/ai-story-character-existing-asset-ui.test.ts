import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("apps/web/src/components/ai-story/CharacterPanel.tsx", "utf8");

describe("Character existing Asset binding UI", () => {
  it("reuses authorized ready Campaign images without uploading duplicates", () => {
    expect(source).toContain("Choose from Campaign Assets");
    expect(source).toContain("asset.type === \"image\" && asset.status === \"ready\"");
    expect(source).toContain("chooseExistingPhoto(asset.id)");
    expect(source).toContain("visualAssetIds");
  });
});
