import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const overview = readFileSync("apps/web/src/components/campaign/CampaignWorkspace.tsx", "utf8");
describe("Campaign Overview repair", () => {
  it("uses the approved hierarchy and existing routes", () => {
    let last = -1;
    for (const heading of ["Marketing Analysis", "Create Content", "Media Assets", "Recent Content", "Recent Tasks", "Activity", "Campaign Settings"]) {
      const index = overview.indexOf(heading, last + 1); expect(index).toBeGreaterThan(last); last = index;
    }
    expect(overview).toContain("/ai-stories/new");
    expect(overview).toContain("/task?taskId=");
  });
  it("has permission, loading, error, empty, and mobile states", () => {
    expect(overview).toContain("Operator permission is required");
    expect(overview).toContain('["admin", "operator"].includes(workspaceRole ?? "")');
    expect(overview).not.toContain('["owner", "admin", "editor", "operator"]');
    expect(overview).toContain('aria-label="Loading campaign"');
    expect(overview).toContain("setStoriesError");
    expect(overview).toContain("No videos yet");
    expect(overview).toContain("No AI Stories yet");
    expect(overview).toContain("grid gap-3 sm:grid-cols-2");
    expect(overview).not.toContain("sticky bottom");
  });
  it("builds meaningful post-vision naming intelligence and protects manual names", () => {
    const worker = readFileSync("apps/worker/src/asset-auto-name.ts", "utf8");
    expect(worker).toContain("contentIntelligenceFromVision");
    expect(worker).toContain("vision.products");
    expect(worker).toContain("vision.scenes");
    expect(worker).toContain('executeSkill("asset-display-name"');
    expect(worker).toContain('displayNameSource === "manual"');
    expect(worker).toContain("<> 'manual'");
  });
});
