import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Episode revision continuity boundary", () => {
  it("does not treat Story Version numbers as Episode order without a Final Story Result", () => {
    const source = readFileSync("packages/db/src/queries/ai-story-episode-continuity-runtime.ts", "utf8");
    const missingResult = source.slice(
      source.indexOf("if (!resultRow)"),
      source.indexOf("await this.materializeAfterFinalStoryResult")
    );
    expect(missingResult).toContain("version_number is a revision sequence");
    expect(missingResult).toContain("return null");
    expect(missingResult).not.toContain("STALE_PREVIOUS_EPISODE_AUTHORITY");
  });
});
