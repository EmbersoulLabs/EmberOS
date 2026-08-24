import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const pagePath =
  "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx";
const runtimePath = "apps/web/src/components/ai-story/StoryRuntimePanel.tsx";

describe("R3 Scene result fresh-visit recovery", () => {
  it("always terminates top-level Story loading after server success or failure", async () => {
    const source = await readFile(pagePath, "utf8");
    expect(source).toContain("setLoading(true)");
    expect(source).toContain("} catch (err) {");
    expect(source).toContain("} finally {");
    expect(source).toContain("setLoading(false)");
  });

  it("recognizes persisted runtime Story statuses on revisit", async () => {
    const source = await readFile(pagePath, "utf8");
    for (const status of [
      "generate_review",
      "executing",
      "execution_review",
      "execution_failed",
    ]) {
      expect(source).toContain(`\"${status}\"`);
    }
  });

  it("reads the server runtime projection once during initial hydration", async () => {
    const source = await readFile(runtimePath, "utf8");
    expect(source).toContain("next = await readInitialRuntimeOnce(refresh)");
    expect(source).toContain("readRuntimeAfterUserRetry(refresh)");
    expect(source).not.toContain("INITIAL_SERVER_READ_ATTEMPTS = 3");
    expect(source).not.toContain("postCanonicalExecute({ campaignId, storyId, executionPlanId });\n        next = await refresh()");
  });

  it("keeps persisted server projection as result and review authority", async () => {
    const source = await readFile(runtimePath, "utf8");
    expect(source).toContain("setProjection((current)");
    expect(source).toContain("stabilizeRuntimeMediaSources(current, next)");
    expect(source).toContain("projection?.generatedSceneReviews ?? []");
    expect(source).not.toContain("sessionStorage");
  });
});
