import { describe, expect, it } from "vitest";
import {
  AiStorySceneCastDirectionSchema,
  sceneCastIdentityConditioningCount,
} from "../packages/shared/src/ai-story-cast";

const id = (tail: string) => `10000000-0000-4000-8000-${tail.padStart(12, "0")}`;
const hash = `sha256:${"a".repeat(64)}`;

const mother = {
  scope: "CAMPAIGN_CHARACTER" as const,
  id: id("1"),
  campaignId: id("9"),
  authorityVersionId: id("11"),
  authorityFingerprint: hash,
  visualIdentityRequirement: "REQUIRED" as const,
};
const daughter = {
  scope: "STORY_SUPPORTING_CHARACTER" as const,
  id: id("2"),
  storyId: id("8"),
  authorityVersionId: id("12"),
  authorityFingerprint: hash,
  visualIdentityRequirement: "REQUIRED" as const,
};
const passerBy = {
  scope: "EPHEMERAL_ACTOR" as const,
  id: id("3"),
  storyId: id("8"),
  scriptSceneId: id("7"),
  displayName: "Customer",
  semanticRole: "A customer passing the stall",
  appearance: "Everyday clothing; no persistent identity",
  visualIdentityRequirement: "NONE" as const,
};

describe("AI Story Scene Cast direction", () => {
  it("supports multiple identified people plus anonymous extras without charging extras as identity conditioning", () => {
    const direction = AiStorySceneCastDirectionSchema.parse({
      mode: "MULTI_CHARACTER",
      participants: [
        { cast: mother, presence: "ON_SCREEN", visualRole: "PRIMARY_VISUAL" },
        { cast: daughter, presence: "ON_SCREEN", visualRole: "SUPPORTING_VISUAL" },
        { cast: passerBy, presence: "ON_SCREEN", visualRole: "BACKGROUND_VISUAL" },
      ],
      genericExtras: [{ description: "Customers queueing naturally", count: 3, facesReadable: false }],
    });
    expect(sceneCastIdentityConditioningCount(direction)).toBe(2);
  });

  it("allows one identified person with anonymous passers-by as a multi-person Scene", () => {
    const direction = AiStorySceneCastDirectionSchema.parse({
      mode: "MULTI_CHARACTER",
      participants: [{ cast: mother, presence: "ON_SCREEN", visualRole: "PRIMARY_VISUAL" }],
      genericExtras: [{ description: "Unidentified passers-by", count: 2, facesReadable: false }],
    });
    expect(sceneCastIdentityConditioningCount(direction)).toBe(1);
  });

  it("keeps an off-screen speaker out of visual identity conditioning", () => {
    const direction = AiStorySceneCastDirectionSchema.parse({
      mode: "SINGLE_CHARACTER",
      participants: [
        { cast: mother, presence: "ON_SCREEN", visualRole: "PRIMARY_VISUAL" },
        { cast: daughter, presence: "OFF_SCREEN_DIALOGUE", visualRole: "BACKGROUND_VISUAL" },
      ],
      genericExtras: [],
    });
    expect(sceneCastIdentityConditioningCount(direction)).toBe(1);
  });

  it("rejects a multi-person choice that has fewer than two visible people", () => {
    expect(() => AiStorySceneCastDirectionSchema.parse({
      mode: "MULTI_CHARACTER",
      participants: [{ cast: daughter, presence: "VOICE_ONLY", visualRole: "BACKGROUND_VISUAL" }],
      genericExtras: [],
    })).toThrow("Multi-character Scene must contain at least two visible people");
  });
});
