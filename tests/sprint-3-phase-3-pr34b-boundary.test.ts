/**
 * Sprint 3 PR 3.4B — boundary regressions.
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
import {
  MINIMAX_CALLBACKS_SUPPORTED,
  MINIMAX_NATIVE_IDEMPOTENCY_SUPPORTED,
} from "../packages/agents/src/ai-story/minimax-capability";

describe("Sprint 3 PR 3.4B boundary", () => {
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

  it("MiniMax Adapter source keeps secrets Adapter-only and fallback disabled", () => {
    const adapter = readFileSync(
      resolve("packages/agents/src/ai-story/minimax-canonical-adapter.ts"),
      "utf8"
    );
    const config = readFileSync(
      resolve("packages/agents/src/ai-story/minimax-config.ts"),
      "utf8"
    );
    const errors = readFileSync(
      resolve("packages/agents/src/ai-story/minimax-error-classification.ts"),
      "utf8"
    );
    expect(adapter).toContain("MinimaxCanonicalAdapter");
    expect(adapter).not.toMatch(/ExecutionFinalizer|recordUsage|recordCost/);
    expect(adapter).not.toMatch(/from ["'].*seedance/i);
    expect(adapter).not.toMatch(/SeedanceCanonicalAdapter/);
    expect(config).toContain("getAiProviderConfig");
    expect(config).toContain("[REDACTED]");
    expect(errors).toContain("fallbackAllowed: false");
    expect(MINIMAX_CALLBACKS_SUPPORTED).toBe(false);
    expect(MINIMAX_NATIVE_IDEMPOTENCY_SUPPORTED).toBe(false);
  });

  it("does not invoke Finalizer / Scene projection from MiniMax Adapter", () => {
    const adapter = readFileSync(
      resolve("packages/agents/src/ai-story/minimax-canonical-adapter.ts"),
      "utf8"
    );
    expect(adapter).not.toMatch(/SceneProviderFinalizer|SceneFinalizationCoordinator/);
    expect(adapter).not.toMatch(/from ["'].*scene-provider-finalizer/);
    expect(adapter).not.toMatch(/from ["'].*scene-finalization-coordinator/);
    expect(adapter).not.toMatch(/from ["'].*scene-result-projector/);
    expect(adapter).not.toMatch(/from ["'].*scene-usage-ledger/);
    expect(adapter).not.toMatch(/from ["'].*scene-cost-ledger/);
    expect(() =>
      readFileSync(resolve("packages/agents/src/ai-story/story-assembly-export.ts"), "utf8")
    ).toThrow();
  });

  it("does not add public MiniMax callback endpoint", () => {
    expect(() =>
      readFileSync(resolve("apps/web/src/app/api/providers/minimax/callback/route.ts"), "utf8")
    ).toThrow();
    expect(() =>
      readFileSync(resolve("apps/web/src/app/api/providers/callback/route.ts"), "utf8")
    ).toThrow();
  });

  it("controlled validation remains opt-in and Seedance Adapter is untouched by MiniMax harness", () => {
    const harness = readFileSync(
      resolve("packages/agents/src/ai-story/minimax-controlled-validation.ts"),
      "utf8"
    );
    expect(harness).toContain("EMBEROS_MINIMAX_CONTROLLED_VALIDATION");
    expect(harness).toContain("EMBEROS_MINIMAX_VALIDATION_CONFIRM");
    expect(harness).toContain("maxTestCostUsd");
    expect(harness).not.toMatch(/from ["'].*seedance/i);
    expect(harness).not.toMatch(/SeedanceCanonicalAdapter/);
    expect(harness).not.toMatch(/ExecutionFinalizer|recordUsage|recordCost/);

    const seedanceAdapter = readFileSync(
      resolve("packages/agents/src/ai-story/seedance-canonical-adapter.ts"),
      "utf8"
    );
    expect(seedanceAdapter).not.toMatch(/from ["'].*minimax/i);
    expect(seedanceAdapter).not.toMatch(/MinimaxCanonicalAdapter/);
  });
});
