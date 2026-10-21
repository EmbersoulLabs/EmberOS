import { describe, expect, it } from "vitest";
import { generationReviewFailureMessage } from "../apps/web/src/lib/ai-story-execution-plan-discovery-client";

describe("Generation Review diagnostics", () => {
  it("surfaces sanitized blocking QC findings when no Execution Plan is created", () => {
    expect(generationReviewFailureMessage({
      qc: { blockingErrors: [{ code: "ASSET_CAMPAIGN_UNAUTHORIZED", message: "Asset is not authorized." }] },
    })).toBe("ASSET_CAMPAIGN_UNAUTHORIZED: Asset is not authorized.");
  });

  it("uses a deterministic fallback without leaking arbitrary payloads", () => {
    expect(generationReviewFailureMessage({ secret: "do-not-render" }))
      .toBe("Generation review did not create an Execution Plan");
  });
});
