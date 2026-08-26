import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rewrite = readFileSync(
  "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/rewrite/route.ts",
  "utf8"
);
const planning = readFileSync(
  "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/route.ts",
  "utf8"
);
const executionReview = readFileSync(
  "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/route.ts",
  "utf8"
);
const guard = readFileSync("config/hybrid-migration-guards.json", "utf8");

describe("Wave 5 visibility and source boundaries", () => {
  it("returns AI Polish preview without persistence until explicit acceptance", () => {
    expect(rewrite).toContain("previewOnly");
    expect(rewrite).toContain("structuredContent");
    const previewBranch = rewrite.indexOf("if (body.data.previewOnly)");
    const persistedVersion = rewrite.indexOf("const version = await createAiStoryVersion");
    expect(previewBranch).toBeGreaterThan(0);
    expect(previewBranch).toBeLessThan(persistedVersion);
    expect(rewrite.slice(previewBranch, persistedVersion)).toContain("previewOnly: true");
  });

  it("server-authorizes raw planning and execution diagnostics", () => {
    expect(planning).toContain('minRole: "operator"');
    expect(executionReview).toContain('minRole: "operator"');
  });

  it("keeps the pre-Wave-6 creative architecture freeze machine-checked", () => {
    expect(guard).toContain("preWave6SkillTokens");
    expect(guard).toContain('"5"');
    expect(guard).toContain("apps/web/src/app/w/**/ai-stories/**");
  });
});
