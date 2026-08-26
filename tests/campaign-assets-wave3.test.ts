import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Wave 3 Campaign asset execution binding", () => {
  it("resolves both historical Campaign-owned assets and Wave 1 references", () => {
    const source = readFileSync("apps/web/src/lib/campaign-assets.ts", "utf8");
    expect(source).toContain("eq(schema.assets.campaignId, campaignId)");
    expect(source).toContain("eq(schema.campaignAssetRefs.campaignId, campaignId)");
    expect(source).toContain("eq(schema.assets.workspaceId, workspaceId)");
  });

  it("binds typed Campaign Target Audience into the frozen main generation capsule", () => {
    const source = readFileSync("apps/web/src/lib/campaign-run.ts", "utf8");
    expect(source).toContain("effectiveTargetAudience");
    expect(source).toContain("lockedCampaign.targetAudience.summary");
    expect(source).toContain("campaignTargetAudience ?? brand.targetAudience");
  });
});
