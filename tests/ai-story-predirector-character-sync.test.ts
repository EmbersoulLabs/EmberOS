import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("pre-Director Character successor synchronization", () => {
  it("uses the shared authenticated Character route with zero Provider calls", () => {
    const route = read(
      "apps/web/src/app/api/campaigns/[id]/characters/[characterId]/route.ts",
    );
    expect(route).toContain("authorizeAiStoryAccess");
    expect(route).toContain("synchronizePreDirectorCharacterAuthority");
    expect(route).toContain("providerCalls: synchronized.providerCalls");
  });

  it("updates Creative Context and Planning Draft atomically and fails closed after Director", () => {
    const service = read("apps/web/src/lib/ai-story-planning-service.ts");
    expect(service).toContain("db.transaction");
    expect(service).toContain("refreshBoundCharacterAuthority");
    expect(service).toContain('stage !== "creative_context"');
    expect(service).toContain("PLANNING_CHARACTER_SUCCESSOR_REQUIRED");
    expect(service).toContain("PLANNING_CHARACTER_NOT_BOUND");
    expect(service).toContain("providerCalls: 0 as const");
  });

  it("exposes automatic edit synchronization and historical recovery in the Story UI", () => {
    const panel = read("apps/web/src/components/ai-story/CharacterPanel.tsx");
    const page = read(
      "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx",
    );
    expect(panel).toContain("Sync current Story");
    expect(panel).toContain("No AI call was made");
    expect(panel).toContain("synchronizeCurrentStory");
    expect(panel).toContain("Character successor saved. The current frozen Story was not changed; create and approve a Planning successor to use it.");
    expect(page).toContain("storyId={storyId}");
  });
});
