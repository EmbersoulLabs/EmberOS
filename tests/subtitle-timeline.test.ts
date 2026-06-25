import { describe, it, expect } from "vitest";
import { subtitlesFromTimeline } from "../packages/shared/src/subtitle-timeline";

describe("subtitlesFromTimeline", () => {
  it("maps source timeline into clip output subtitles", () => {
    const timeline = [
      { startSec: 0, endSec: 5, text: "Hook line", role: "hook" },
      { startSec: 5, endSec: 15, text: "Body copy", role: "body" },
      { startSec: 15, endSec: 20, text: "Call now", role: "cta" },
    ];

    const subs = subtitlesFromTimeline(timeline, 5, 20, 15, "en");
    expect(subs.length).toBeGreaterThan(0);
    expect(subs[0]!.text).toBe("Body copy");
    expect(subs[0]!.startSec).toBeGreaterThanOrEqual(0);
    expect(subs.at(-1)!.endSec).toBe(15);
  });

  it("returns empty when no overlap", () => {
    const timeline = [{ startSec: 0, endSec: 5, text: "Early", role: "hook" }];
    expect(subtitlesFromTimeline(timeline, 30, 60, 15, "en")).toEqual([]);
  });
});
