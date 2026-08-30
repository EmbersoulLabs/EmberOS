import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProductRuntimeProjection } from "../packages/shared/src";
import {
  HUMAN_REVIEW_WAIT_STATE,
  isWaitingForHumanReview,
  shouldPollRuntimeProjection,
  stabilizeRuntimeMediaSources,
} from "../apps/web/src/lib/ai-story-runtime-ui";

const ids = {
  plan: "8831afe0-e22b-561e-ba8a-9087996a9113",
  execution: "0209531f-1385-55b5-bf52-a4439c2ceb1e",
  result: "a652f317-69f5-5bb3-b4c1-7835df0eb28a",
  media: "a652f317-69f5-5bb3-b4c1-7835df0eb28a",
};

function projection(input: { running?: boolean; pending?: number; mediaId?: string; url?: string; expiresAt?: string }): ProductRuntimeProjection {
  return {
    contractVersion: "1",
    executionPlanId: ids.plan,
    runtimeAuthorizationId: null,
    status: "SCENES_RUNNING",
    runtimeProjectionVersion: "1",
    requiredSceneCount: 3,
    succeededSceneCount: 2,
    failedSceneCount: 0,
    reconciliationCount: 0,
    assemblyState: "NONE",
    hasFinalStoryResult: false,
    canExecute: false,
    safeFailureSummary: null,
    pendingReviewSceneCount: input.pending ?? 1,
    approvedSceneCount: 1,
    heldSceneCount: 1,
    sceneReleaseStates: [],
    remainingReleasePermitted: false,
    nextEligibleSceneOrder: null,
    generatedSceneReviews: [{
      sceneExecutionId: ids.execution,
      sceneId: "scene-2",
      sceneOrder: 1,
      reviewState: "PENDING_REVIEW",
      approvedAttemptId: null,
      approvedSceneResultId: null,
      latestAttemptId: "attempt-1",
      latestAttemptNumber: 1,
      latestAttemptStatus: input.running ? "RUNNING" : "SUCCEEDED",
      attemptCount: 1,
      retryRemaining: 1,
      maxAttempts: 2,
      latestAttemptKnownCost: 0.35,
      sceneKnownCost: 0.35,
      currency: "USD",
      running: input.running ?? false,
      attempts: [],
      generatedMedia: input.url ? {
        mediaId: input.mediaId ?? ids.media,
        sceneResultId: input.mediaId ?? ids.result,
        sceneExecutionId: ids.execution,
        providerAttemptId: "attempt-1",
        mediaType: "video/mp4",
        contentType: "video/mp4",
        deliveryUrl: input.url,
        expiresAt: input.expiresAt ?? "2026-08-24T12:10:00.000Z",
        deliveryStatus: "READY",
        safeError: null,
      } : null,
    }],
    derivedAt: "2026-08-24T12:00:00.000Z",
  };
}

describe("AI Story Runtime UI stability", () => {
  it("derives a non-persisted human-review wait and ignores held later Scenes", () => {
    const value = projection({});
    expect(HUMAN_REVIEW_WAIT_STATE).toBe("WAITING_FOR_HUMAN_REVIEW");
    expect(isWaitingForHumanReview(value)).toBe(true);
    expect(shouldPollRuntimeProjection(value)).toBe(false);
  });

  it("keeps polling during genuinely active provider execution", () => {
    const value = projection({ running: true });
    expect(isWaitingForHumanReview(value)).toBe(false);
    expect(shouldPollRuntimeProjection(value)).toBe(true);
  });

  it("keeps the current video source when only the signed URL rotates", () => {
    const previous = projection({ url: "https://media.test/a", expiresAt: "2026-08-24T12:10:00.000Z" });
    const next = projection({ url: "https://media.test/b", expiresAt: "2026-08-24T12:14:00.000Z" });
    const stable = stabilizeRuntimeMediaSources(previous, next, Date.parse("2026-08-24T12:01:00.000Z"));
    expect(stable.generatedSceneReviews?.[0]?.generatedMedia?.deliveryUrl).toBe("https://media.test/a");
  });

  it("updates playback for a genuinely new durable result", () => {
    const previous = projection({ url: "https://media.test/a" });
    const next = projection({ mediaId: "b652f317-69f5-5bb3-b4c1-7835df0eb28a", url: "https://media.test/b" });
    const stable = stabilizeRuntimeMediaSources(previous, next, Date.parse("2026-08-24T12:01:00.000Z"));
    expect(stable.generatedSceneReviews?.[0]?.generatedMedia?.deliveryUrl).toBe("https://media.test/b");
  });

  it("accepts a renewed URL only when the retained source is near expiry", () => {
    const previous = projection({ url: "https://media.test/a", expiresAt: "2026-08-24T12:01:30.000Z" });
    const next = projection({ url: "https://media.test/b", expiresAt: "2026-08-24T12:11:00.000Z" });
    const stable = stabilizeRuntimeMediaSources(previous, next, Date.parse("2026-08-24T12:01:00.000Z"));
    expect(stable.generatedSceneReviews?.[0]?.generatedMedia?.deliveryUrl).toBe("https://media.test/b");
  });

  it("wires one-flight coalescing, stale abort, hidden-tab suppression, and manual refresh", () => {
    const panel = readFileSync(
      resolve(process.cwd(), "apps/web/src/components/ai-story/StoryRuntimePanel.tsx"),
      "utf8"
    );
    expect(panel).toContain("if (runtimeReadInFlight.current) return runtimeReadInFlight.current");
    expect(panel).toContain("runtimeReadAbort.current?.abort()");
    expect(panel).toContain('document.visibilityState === "hidden"');
    expect(panel).toContain('data-testid="story-runtime-manual-refresh"');
    expect(panel).toContain("stabilizeRuntimeMediaSources(current, next)");
  });
});
