import { describe, expect, it } from "vitest";
import {
  AI_STORY_OUTLINE_PROFILE_REGISTRY,
} from "@ceo-agent/shared";
import {
  requiresProductStoryCanonicalOutline,
} from "../apps/web/src/lib/ai-story-planning-runner";

describe("AI Story Scene Planning profile routing P0", () => {
  it("routes PRODUCT_STORY through its dedicated canonical Outline producer", () => {
    expect(
      requiresProductStoryCanonicalOutline(
        AI_STORY_OUTLINE_PROFILE_REGISTRY.PRODUCT_STORY
      )
    ).toBe(true);
  });

  it.each(["CORE", "COMMERCIAL_STORY"] as const)(
    "does not reject the certified %s planning path with PRODUCT_STORY-only authority",
    (profileId) => {
      expect(
        requiresProductStoryCanonicalOutline(
          AI_STORY_OUTLINE_PROFILE_REGISTRY[profileId]
        )
      ).toBe(false);
    }
  );

  it("fails closed when the Story has no selected Outline profile authority", () => {
    expect(() => requiresProductStoryCanonicalOutline(null)).toThrow(
      "AI Story Outline profile authority is required"
    );
  });
});
