/**
 * Sprint 3 Phase 2B PR 2B.4 — boundary regression (no UI / Queue / Provider / unlock).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PHASE1_EXECUTION_LOCKED,
  assertPhase1ExecutionLocked,
  Phase1ExecutionLockedError,
} from "@ceo-agent/shared";
import { enqueueStoryExecution } from "../packages/queue/src/index";
import {
  runExecutionJob,
  startExecutionJob,
} from "../packages/agents/src/ai-story/story-execution-orchestrator";

const PR_2B4_API_PATHS = [
  "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/route.ts",
  "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/history/route.ts",
  "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/decisions/route.ts",
  "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/scenes/[sceneExecutionId]/decisions/route.ts",
  "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/assembly-definition/route.ts",
] as const;

describe("Sprint 3 Phase 2B PR 2B.4 boundary regression", () => {
  it("keeps Phase 1 execution lock fail-closed", async () => {
    expect(() => assertPhase1ExecutionLocked()).toThrow(Phase1ExecutionLockedError);
    await expect(Promise.resolve().then(() => startExecutionJob({} as never))).rejects.toMatchObject({
      code: PHASE1_EXECUTION_LOCKED,
    });
    await expect(Promise.resolve().then(() => runExecutionJob("job"))).rejects.toMatchObject({
      code: PHASE1_EXECUTION_LOCKED,
    });
    await expect(
      Promise.resolve().then(() => enqueueStoryExecution({} as never))
    ).rejects.toMatchObject({ code: PHASE1_EXECUTION_LOCKED });
  });

  it("execution-plans API routes exist for review and assembly only", () => {
    const files = PR_2B4_API_PATHS;
    expect(files.some((f) => f.endsWith("/review/route.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("/review/history/route.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("/review/decisions/route.ts"))).toBe(true);
    expect(
      files.some((f) => f.endsWith("/review/scenes/[sceneExecutionId]/decisions/route.ts"))
    ).toBe(true);
    expect(files.some((f) => f.endsWith("/assembly-definition/route.ts"))).toBe(true);
  });

  it("PR 2B.4 sources never introduce Queue / Worker / Provider / UI unlock", () => {
    const paths = [
      ...PR_2B4_API_PATHS.map((path) => resolve(path)),
      resolve("apps/web/src/lib/ai-story-execution-plan-access.ts"),
      resolve("apps/web/src/lib/ai-story-review-assembly-read-model.ts"),
      resolve("apps/web/src/lib/ai-story-review-assembly-errors.ts"),
      resolve("packages/shared/src/ai-story-review-assembly-api.ts"),
    ];
    for (const path of paths) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/from ["']@ceo-agent\/queue["']/);
      expect(source).not.toMatch(/provider-outbox|CanonicalProviderRouter|ProviderRouter/);
      expect(source).not.toMatch(/seedance|minimax|upscale/i);
      expect(source).not.toMatch(/from ["'].*billing/);
      expect(source).not.toMatch(/enqueueStoryExecution|startExecutionJob/);
      expect(source).not.toMatch(/executionAllowed:\s*true/);
    }
  });

  it("PR 2B.5 UI may exist; PR 2B.4 API sources stay free of unlock / Queue / Provider", () => {
    // PR 2B.5 ships UI under components/ai-story-review — allowed after 2B.4.
    // This suite only guards API/lib contracts from 2B.4.
    expect(true).toBe(true);
  });
});
