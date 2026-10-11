import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("no-asset confirmation production workflow", () => {
  const repository = source("packages/db/src/queries/ai-story-asset-matching.ts");
  const route = source(
    "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/asset-matching/no-asset-confirmation/route.ts"
  );
  const page = source("apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx");

  it("persists confirmation through the existing matcher and matching-result table", () => {
    expect(repository).toContain("matchAnalyzedAssetsToStory");
    expect(repository).toContain("aiStoryAssetMatchingResults");
    expect(repository).toContain("CONFIRMED_NO_ASSETS");
    expect(repository).not.toContain("callVisionJsonModel");
    expect(repository).not.toContain("openai");
    expect(repository).not.toContain("loadRawBytes");
  });

  it("requires an explicit confirmation and the current frozen version", () => {
    expect(route).toContain("body.confirmed !== true");
    expect(route).toContain("Explicit no-asset confirmation is required");
    expect(route).toContain("NO_ASSET_CONFIRMATION_STALE_VERSION");
    expect(route).toContain("minRole: \"operator\"");
    expect(route).not.toContain("callVisionJsonModel");
    expect(route).not.toContain("OPENAI");
  });

  it("does not save the preparation action until the operator confirms", () => {
    expect(page).toContain("Continue without reference assets");
    expect(page).toContain("Confirm this episode has no reference assets");
    expect(page).toContain("if (!acknowledged || disabled || submitting) return;");
    expect(page).toContain("confirmed: true");
    expect(page).not.toContain("setAcknowledged(true)");
  });
});
