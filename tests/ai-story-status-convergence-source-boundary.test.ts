import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const projector = readFileSync("packages/shared/src/ai-story-status-convergence.ts", "utf8");
const persist = readFileSync("packages/db/src/queries/ai-story-status-convergence.ts", "utf8");
const storyGet = readFileSync(
  "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/route.ts",
  "utf8"
);
const runtimeGet = readFileSync(
  "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/runtime/route.ts",
  "utf8"
);
const page = readFileSync(
  "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx",
  "utf8"
);
const projection = readFileSync(
  "packages/db/src/queries/ai-story-scene-projection.ts",
  "utf8"
);
const playback = readFileSync("apps/web/src/lib/ai-story-scene-media-playback.ts", "utf8");
const workspace = readFileSync(
  "apps/web/src/components/ai-story/SceneReviewWorkspacePanel.tsx",
  "utf8"
);

describe("AI Story status convergence source boundary", () => {
  it("keeps Story status projection in one persist helper", () => {
    expect(persist).toContain("export async function convergeAiStoryStatusFromRuntimeAuthority");
    expect(persist).toContain("projectAiStoryStatusFromRuntimeAuthority");
    expect(projector).toContain("export function projectAiStoryStatusFromRuntimeAuthority");
  });

  it("converges on Story GET revisit and Scene Result / review write", () => {
    expect(storyGet).toContain("convergeAiStoryStatusFromRuntimeAuthority");
    expect(projection).toContain("convergeAiStoryStatusFromRuntimeAuthority");
    expect(projection).toContain("insertPendingGeneratedSceneReviewInTransaction");
  });

  it("does not rely on a React-only status override or planning_review whitelist", () => {
    const whitelistStart = page.indexOf("const executionActive");
    const whitelist = page.slice(whitelistStart, whitelistStart + 220);
    expect(whitelist).toContain('"execution_review"');
    expect(whitelist).not.toContain("planning_review");
  });

  it("keeps runtime GET read-only and preserves private playback signing", () => {
    expect(runtimeGet).toContain("Read-only. Zero execution side effects.");
    expect(runtimeGet).not.toContain("convergeAiStoryStatusFromRuntimeAuthority");
    expect(runtimeGet).toContain("mintSceneResultPlayback");
    expect(playback).toContain("never schedules, retries");
    expect(playback).toContain("or persists signed URLs");
    expect(workspace).toContain("<video");
    expect(workspace).toContain("scene.generatedMedia.deliveryUrl");
    expect(workspace.match(/<video/g)?.length).toBe(1);
  });

  it("does not mutate Provider Attempt or commercial authority", () => {
    expect(persist).not.toContain("providerAttempts");
    expect(persist).not.toContain("certificationCommercial");
    expect(persist).not.toContain("settleProvider");
    expect(persist).not.toContain("releaseRemaining");
    expect(persist).not.toContain("update(schema.aiStoryGeneratedSceneReviews");
    expect(persist).not.toContain("update(schema.providerAttempts");
    expect(persist).toContain("eq(schema.aiStories.status, projection.from)");
  });
});
