/**
 * Sprint 3 PR 3.4A — boundary regressions.
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
import { SEEDANCE_CALLBACKS_SUPPORTED, SEEDANCE_NATIVE_IDEMPOTENCY_SUPPORTED } from "../packages/agents/src/ai-story/seedance-capability";

describe("Sprint 3 PR 3.4A boundary", () => {
  it("keeps Phase 1 public execution lock fail-closed", async () => {
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

  it("Seedance Adapter source keeps secrets Adapter-only and fallback disabled", () => {
    const adapter = readFileSync(
      resolve("packages/agents/src/ai-story/seedance-canonical-adapter.ts"),
      "utf8"
    );
    const config = readFileSync(
      resolve("packages/agents/src/ai-story/seedance-config.ts"),
      "utf8"
    );
    expect(adapter).toContain("SeedanceCanonicalAdapter");
    expect(adapter).not.toMatch(/ExecutionFinalizer|recordUsage|recordCost/);
    expect(adapter).not.toMatch(/from ["'].*minimax/i);
    expect(adapter).not.toMatch(/MinimaxCanonicalAdapter/);
    expect(config).toContain("getAiProviderConfig");
    expect(config).toContain("[REDACTED]");
    expect(SEEDANCE_CALLBACKS_SUPPORTED).toBe(false);
    expect(SEEDANCE_NATIVE_IDEMPOTENCY_SUPPORTED).toBe(false);
  });

  it("does not start Finalizer / Scene Result / PR 3.5 modules", () => {
    for (const relative of [
      "packages/agents/src/ai-story/scene-provider-finalizer.ts",
      "packages/agents/src/ai-story/scene-result-persistence.ts",
    ]) {
      expect(() => readFileSync(resolve(relative), "utf8")).toThrow();
    }
  });

  it("does not add public Seedance callback endpoint", () => {
    expect(() =>
      readFileSync(resolve("apps/web/src/app/api/providers/seedance/callback/route.ts"), "utf8")
    ).toThrow();
    expect(() =>
      readFileSync(resolve("apps/web/src/app/api/providers/callback/route.ts"), "utf8")
    ).toThrow();
  });

  it("controlled validation remains opt-in", () => {
    const harness = readFileSync(
      resolve("packages/agents/src/ai-story/seedance-controlled-validation.ts"),
      "utf8"
    );
    expect(harness).toContain("EMBEROS_SEEDANCE_CONTROLLED_VALIDATION");
    expect(harness).toContain("EMBEROS_SEEDANCE_VALIDATION_CONFIRM");
    expect(harness).toContain("maxTestCostUsd");
    expect(harness).not.toMatch(/from ["'].*minimax/i);
    expect(harness).not.toMatch(/MinimaxCanonicalAdapter/);
  });
});
