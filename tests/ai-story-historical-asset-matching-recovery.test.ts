import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("historical frozen Story Asset matching recovery", () => {
  it("recovers only from cached semantic authority before queueing Planning", () => {
    const helper = readFileSync("apps/web/src/lib/ai-story-asset-semantic-grounding.ts", "utf8");
    const route = readFileSync("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/generate/route.ts", "utf8");

    expect(helper).toContain("prepareStoryAssetGroundingFromCache");
    expect(helper).toContain("loadEligibleAnalyzedAssets");
    expect(helper).toContain("semanticAnalyzerCalls: 0");
    expect(helper).not.toMatch(/prepareStoryAssetGroundingFromCache[\s\S]*analyzeVisualSemanticAsset\(/);
    expect(route).toContain('error.code !== "SCENE_GROUNDING_AUTHORITY_REQUIRED"');
    expect(route).toContain("prepareStoryAssetGroundingFromCache");
    expect(route.lastIndexOf("persistStoryAssetMatching")).toBeLessThan(route.lastIndexOf("enqueueStoryPlanningStage"));
  });
});
