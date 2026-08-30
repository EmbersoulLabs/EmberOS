import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("R3 execution-plan review story fact compact projection", () => {
  const source = readFileSync(
    "packages/db/src/queries/ai-story-execution-plan-review.ts",
    "utf8"
  );
  const storyFactRead = source.slice(
    source.indexOf("const storyRows = await timingRecorder.run("),
    source.indexOf("const requiredSceneRows = await timingRecorder.run(")
  );

  it("reads only the latest story-review fact in one indexed round trip", () => {
    expect(storyFactRead).toContain(".select({");
    expect(storyFactRead).toContain(
      "orgId: schema.aiStoryStoryReviewFacts.orgId"
    );
    expect(storyFactRead).toContain(
      "fact: schema.aiStoryStoryReviewFacts.fact"
    );
    expect(storyFactRead).toContain(
      ".orderBy(desc(schema.aiStoryStoryReviewFacts.acceptedAt))"
    );
    expect(storyFactRead).toContain(".limit(1)");
    expect(storyFactRead).toContain("StoryReviewDecisionSchema.parse(storyRows[0].fact)");
  });

  it("does not consolidate the distinct opened and scene-review fact sources", () => {
    expect(source).toContain(".from(schema.aiStoryReviewOpenedFacts)");
    expect(source).toContain(".from(schema.aiStorySceneIntentReviewFacts)");
    expect(source).toContain(".from(schema.aiStoryStoryReviewFacts)");
  });
});
