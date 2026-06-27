import { describe, expect, it } from "vitest";
import {
  isInternalVideoAnalysisPrompt,
  isInternalPromptLeak,
  substantiveCampaignBrief,
} from "../src/campaign-brief";

describe("campaign-brief internal prompt guards", () => {
  it("detects auto-generated VIDEO ANALYSIS blocks", () => {
    const internal = "VIDEO ANALYSIS\n\nUser Brief:\n(not provided — use automatic analysis)\n\nBackground Music:\nAuto Select";
    expect(isInternalVideoAnalysisPrompt(internal)).toBe(true);
    expect(isInternalPromptLeak(internal)).toBe(true);
    expect(substantiveCampaignBrief(undefined, internal)).toBeUndefined();
  });

  it("keeps real user brief text", () => {
    expect(substantiveCampaignBrief("Handmade rose bouquets for weddings", null)).toBe(
      "Handmade rose bouquets for weddings"
    );
    expect(isInternalPromptLeak("rose bouquet")).toBe(false);
  });
});
