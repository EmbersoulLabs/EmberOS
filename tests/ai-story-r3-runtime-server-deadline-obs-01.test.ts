import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RUNTIME_READ_STAGES,
  RuntimeReadStageRecorder,
  SERVER_RUNTIME_DEADLINE_MS,
} from "../apps/web/src/lib/ai-story-runtime-read-observability";

const root = process.cwd();
const route = readFileSync(resolve(root, "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/runtime/route.ts"), "utf8");
const client = readFileSync(resolve(root, "apps/web/src/lib/ai-story-runtime-client.ts"), "utf8");
const observability = readFileSync(resolve(root, "apps/web/src/lib/ai-story-runtime-read-observability.ts"), "utf8");

describe("R3 Runtime server deadline observability", () => {
  it("keeps the server deadline ahead of the browser abort", () => {
    expect(SERVER_RUNTIME_DEADLINE_MS).toBe(15_000);
    expect(client).toContain("RUNTIME_READ_TIMEOUT_MS = 20_000");
    expect(SERVER_RUNTIME_DEADLINE_MS).toBeLessThan(20_000);
  });

  it("records a completed fast projection stage", async () => {
    const recorder = new RuntimeReadStageRecorder(new AbortController().signal);
    await expect(recorder.run("runtime_projection_build", async () => "ok")).resolves.toBe("ok");
    expect(recorder.snapshot().find((row) => row.stage === "runtime_projection_build")?.status).toBe("COMPLETED");
  });

  it("identifies story load as the active timed-out stage", async () => {
    const controller = new AbortController();
    const recorder = new RuntimeReadStageRecorder(controller.signal);
    const pending = recorder.run("story_load", () => new Promise<never>(() => {}));
    controller.abort();
    expect(recorder.markTimedOut()).toBe("story_load");
    expect(recorder.snapshot().find((row) => row.stage === "story_load")?.status).toBe("TIMED_OUT");
    void pending;
  });

  it("identifies review projection after the prior completed stage", async () => {
    const controller = new AbortController();
    const recorder = new RuntimeReadStageRecorder(controller.signal);
    await recorder.run("scene_result_read", async () => undefined);
    const pending = recorder.run("generated_scene_review_read", () => new Promise<never>(() => {}));
    controller.abort();
    expect(recorder.markTimedOut()).toBe("generated_scene_review_read");
    expect(recorder.lastCompletedStage()).toBe("scene_result_read");
    void pending;
  });

  it("exposes every required safe stage and no secret-bearing timing fields", () => {
    expect(RUNTIME_READ_STAGES).toEqual(expect.arrayContaining([
      "auth", "story_load", "execution_plan_load", "runtime_authorization_read",
      "release_state_read", "provider_attempt_read", "scene_result_read",
      "generated_scene_review_read", "durable_attestation_read",
      "media_playback_resolution", "cost_usage_projection",
      "response_schema_validation", "response_serialization",
    ]));
    expect(route).toContain('"x-emberos-request-correlation-id"');
    expect(observability).toContain("AI_STORY_RUNTIME_READ_TIMEOUT");
    expect(route).toContain('deliveryStatus: "UNAVAILABLE"');
    expect(route).not.toContain("DATABASE_URL");
    expect(route).not.toContain("authToken");
  });
});
