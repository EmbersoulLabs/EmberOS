import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StoryLoadTimingRecorder } from "../apps/web/src/lib/ai-story-execution-plan-access";

describe("R3 Runtime compact Story authority load", () => {
  it("uses one compact Story/current-version query without rich hydration", () => {
    const source = readFileSync("apps/web/src/lib/ai-story-execution-plan-access.ts", "utf8");
    const start = source.indexOf("const [story] = await observe");
    const end = source.indexOf("const planTiming", start);
    const compactLoad = source.slice(start, end);
    expect(source).toContain("story_load.story_authority_current_version_read");
    expect(compactLoad).toContain("currentVersionId: schema.aiStories.currentVersionId");
    expect(compactLoad).toContain("verificationFixture: sql<boolean>");
    expect(compactLoad).toContain(".leftJoin(");
    expect(compactLoad).not.toContain("loadCampaignAiStory");
    expect(compactLoad).not.toContain("structuredContent");
    expect(compactLoad).not.toContain("aiMetadata");
    expect(compactLoad).not.toContain("aiStoryAssetLinks");
    expect(compactLoad).not.toContain("aiStoryExecuteVerifications");
  });

  it("publishes one completed query and round trip", async () => {
    const recorder = new StoryLoadTimingRecorder();
    await recorder.run(async () => [{ id: "story" }], (rows) => rows.length);
    expect(recorder.snapshot()[0]).toMatchObject({
      status: "COMPLETED",
      queryCount: 1,
      roundTripCount: 1,
      rowCount: 1,
    });
  });

  it("retains a partial timing when the parent deadline fires", async () => {
    let release!: () => void;
    const blocked = new Promise<never>((resolve) => { release = resolve as () => void; });
    const recorder = new StoryLoadTimingRecorder();
    const operation = recorder.run(() => blocked, () => 0);
    recorder.markTimedOut();
    expect(recorder.snapshot()[0]?.status).toBe("TIMED_OUT");
    release();
    await operation;
  });
});
