import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PHASE1_EXECUTION_LOCKED,
  PHASE1_EXECUTION_LOCK_MESSAGE,
  Phase1ExecutionLockedError,
  assertPhase1ExecutionLocked,
} from "@ceo-agent/shared";
import {
  regenerateSingleExecutionOutput,
  retryExecutionJob,
  runExecutionJob,
  startExecutionJob,
} from "../packages/agents/src/ai-story/story-execution-orchestrator";
import { enqueueStoryExecution } from "../packages/queue/src/index";

function expectPhase1Lock(error: unknown) {
  expect(error).toBeInstanceOf(Phase1ExecutionLockedError);
  expect(error).toMatchObject({
    code: PHASE1_EXECUTION_LOCKED,
    status: 409,
    message: PHASE1_EXECUTION_LOCK_MESSAGE,
  });
}

async function expectLocked(call: () => unknown | Promise<unknown>) {
  try {
    await call();
    throw new Error("Expected Phase 1 execution lock");
  } catch (error) {
    expectPhase1Lock(error);
  }
}

describe("Sprint 3 Phase 1 execution lockdown", () => {
  it("exposes one authoritative structured lock", () => {
    expect(() => assertPhase1ExecutionLocked()).toThrow(Phase1ExecutionLockedError);
  });

  it("blocks every exported execution helper before dependencies are used", async () => {
    await expectLocked(() => startExecutionJob({} as never));
    await expectLocked(() => retryExecutionJob(null as never, "job", "workspace"));
    await expectLocked(() => runExecutionJob("job"));
    await expectLocked(() => regenerateSingleExecutionOutput({} as never));
  });

  it("blocks the canonical Story execution queue producer before queue creation", async () => {
    await expectLocked(() => enqueueStoryExecution({} as never));
  });

  it("guards the worker consumer before importing or invoking runExecutionJob", () => {
    const source = readFileSync(
      resolve("apps/worker/src/processors/index.ts"),
      "utf8"
    );
    const handler = source.slice(source.indexOf('job.name === "agent.story_execution"'));
    expect(handler.indexOf("assertPhase1ExecutionLocked()"))
      .toBeGreaterThanOrEqual(0);
    expect(handler.indexOf("assertPhase1ExecutionLocked()"))
      .toBeLessThan(handler.indexOf("runExecutionJob(executionJobId)"));
  });

  it("guards every mutating AI Story execution endpoint", () => {
    const routes = [
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/route.ts",
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/regenerate-all/route.ts",
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/export/route.ts",
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/[jobId]/retry/route.ts",
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/[jobId]/regenerate/route.ts",
    ];

    for (const route of routes) {
      expect(readFileSync(resolve(route), "utf8")).toContain(
        "assertPhase1ExecutionLocked()"
      );
    }
  });
});
