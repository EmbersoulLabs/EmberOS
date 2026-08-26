import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Wave 4 Campaign Workspace API projection", () => {
  const source = readFileSync("apps/web/src/app/api/campaigns/[id]/route.ts", "utf8");

  it("retains main auth and workspace-role authority", () => {
    expect(source).toContain("requireAuth()");
    expect(source).toContain("requireWorkspaceRole(campaign.workspaceId, user.id");
  });

  it("projects Wave 1 references without rewriting asset identity", () => {
    expect(source).toContain("schema.campaignAssetRefs");
    expect(source).toContain("schema.campaignStoryRefs");
    expect(source).toContain("eq(schema.assets.workspaceId, campaign.workspaceId)");
    expect(source).toContain("eq(schema.stories.workspaceId, campaign.workspaceId)");
    expect(source).not.toContain("update(schema.assets)");
  });

  it("continues using main private delivery projection", () => {
    expect(source).toContain("withSignedCreativeArtifacts");
    expect(source).toContain("withSignedTaskExportProgress");
  });
});
