import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INITIAL_RUNTIME_READ_ATTEMPTS, readInitialRuntimeOnce, readRuntimeAfterUserRetry } from "../apps/web/src/lib/ai-story-runtime-initial-read-policy";
import { StoryRuntimeClientError, parseRuntimeTimeoutTrace } from "../apps/web/src/lib/ai-story-runtime-client";

describe("R3 single initial Runtime read policy", () => {
  it("issues one initial read and never retries a timeout automatically", async () => {
    const timeout = new StoryRuntimeClientError("Runtime data loading timed out.", "AI_STORY_RUNTIME_READ_TIMEOUT", 504, "test-correlation");
    const read = vi.fn().mockRejectedValue(timeout);
    await expect(readInitialRuntimeOnce(read)).rejects.toBe(timeout);
    expect(INITIAL_RUNTIME_READ_ATTEMPTS).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("adds exactly one request only after explicit manual retry", async () => {
    const read = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(readInitialRuntimeOnce(read)).rejects.toThrow("timeout");
    expect(read).toHaveBeenCalledTimes(1);
    await expect(readRuntimeAfterUserRetry(read)).rejects.toThrow("timeout");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("parses every safe structured timeout field", () => {
    const trace = parseRuntimeTimeoutTrace({
      errorCode: "AI_STORY_RUNTIME_READ_TIMEOUT",
      correlationId: "test-correlation",
      elapsedMs: 15000,
      lastCompletedStage: "execution_plan_load",
      timedOutStage: "generated_scene_review_read",
      stageTimings: [{ stage: "execution_plan_load", startedAt: 4, durationMs: 10, status: "COMPLETED" }],
      generatedSceneReviewStageTimings: [{
        stage: "generated_scene_review.provider_attempt_cost_records",
        status: "TIMED_OUT",
        durationMs: 5000,
        queryCount: 1,
        roundTripCount: 1,
        rowCount: null,
      }],
      generatedSceneReviewPathTrace: [{
        marker: "review_load_plan_read_model_entry.v1",
        correlationId: "test-correlation",
        executionPlanId: "test-plan",
        releaseRevision: "test-release",
        elapsedMs: 42,
        sourceModule: "packages/agents/src/ai-story/generated-scene-review-service.ts",
        sourceFunction: "GeneratedSceneReviewService.loadPlanReadModel",
        traceVersion: "review-helper-entry-path.v1",
      }],
    }, "test-correlation");
    expect(trace).toEqual(expect.objectContaining({
      errorCode: "AI_STORY_RUNTIME_READ_TIMEOUT",
      correlationId: "test-correlation",
      elapsedMs: 15000,
      lastCompletedStage: "execution_plan_load",
      timedOutStage: "generated_scene_review_read",
    }));
    expect(trace?.stageTimings).toHaveLength(1);
    expect(trace?.generatedSceneReviewStageTimings).toEqual([
      expect.objectContaining({
        stage: "generated_scene_review.provider_attempt_cost_records",
        status: "TIMED_OUT",
        durationMs: 5000,
      }),
    ]);
    expect(trace?.generatedSceneReviewPathTrace).toEqual([
      expect.objectContaining({
        marker: "review_load_plan_read_model_entry.v1",
        correlationId: "test-correlation",
        releaseRevision: "test-release",
        elapsedMs: 42,
      }),
    ]);
  });

  it("does not fabricate timeout fields for unknown failures", () => {
    expect(parseRuntimeTimeoutTrace({ error: "network failed" }, null)).toBeNull();
  });

  it("keeps manual retry and removes the component retry loop", () => {
    const panel = readFileSync(resolve(process.cwd(), "apps/web/src/components/ai-story/StoryRuntimePanel.tsx"), "utf8");
    expect(panel).toContain("Retry loading review");
    expect(panel).toContain("readRuntimeAfterUserRetry(refresh)");
    expect(panel).toContain("readInitialRuntimeOnce(refresh)");
    expect(panel).not.toContain("INITIAL_SERVER_READ_RETRY_MS");
    expect(panel).not.toContain("for (let attempt");
  });
});
