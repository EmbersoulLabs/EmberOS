/**
 * Sprint 3 PR 3.5 (remediated) — boundary regressions.
 */
import { readFileSync, existsSync } from "node:fs";
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

describe("Sprint 3 PR 3.5 remediated boundary", () => {
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

  it("removed AI Story duplicate terminal ledger modules", () => {
    for (const relative of [
      "packages/agents/src/ai-story/scene-usage-ledger.ts",
      "packages/agents/src/ai-story/scene-cost-ledger.ts",
      "packages/agents/src/ai-story/scene-provider-finalizer.ts",
      "packages/agents/src/ai-story/scene-result-persistence.ts",
      "packages/shared/src/ai-story-finalizer.ts",
      "packages/db/src/queries/ai-story-finalizer.ts",
      "packages/db/sql/ai-story-finalizer-v1.sql",
    ]) {
      expect(existsSync(resolve(relative))).toBe(false);
    }
  });

  it("bridge and projector never own Provider terminal writes", () => {
    const bridge = readFileSync(
      resolve("packages/agents/src/ai-story/provider-worker-result-finalizer-bridge.ts"),
      "utf8"
    );
    const projector = readFileSync(
      resolve("packages/agents/src/ai-story/scene-result-projector.ts"),
      "utf8"
    );
    const projectionRepo = readFileSync(
      resolve("packages/db/src/queries/ai-story-scene-projection.ts"),
      "utf8"
    );
    for (const source of [bridge, projector, projectionRepo]) {
      expect(source).not.toMatch(/providerAttemptUsage|provider_attempt_usage/);
      expect(source).not.toMatch(/providerAttemptCosts|provider_attempt_costs/);
      expect(source).not.toMatch(/status:\s*["']COMPLETED["']/);
      expect(source).not.toMatch(/\.update\(schema\.providerExecutions\)/);
      expect(source).not.toMatch(/\.update\(schema\.providerOutboxJobs\)/);
    }
    expect(bridge).toContain("Does NOT write Provider terminal");
    expect(projector).toContain("Never writes Provider terminal");
  });

  it("Production Finalizer remains the Provider terminal authority", () => {
    const finalizer = readFileSync(
      resolve("packages/db/src/queries/provider-execution-finalizer.ts"),
      "utf8"
    );
    expect(finalizer).toContain("providerAttemptUsage");
    expect(finalizer).toContain("providerAttemptCosts");
    expect(finalizer).toContain('status: "SUCCEEDED"');
    expect(finalizer).toContain('status: "COMPLETED"');
    expect(finalizer).toContain("finalizeTerminalFailure");
    expect(finalizer).toContain('status: "TERMINAL_FAILURE"');
    expect(finalizer).toContain('status: "DEAD_LETTER"');
    // Failure path must not invent usage/cost writes inside finalizeTerminalFailure.
    const failureFn = finalizer.slice(
      finalizer.indexOf("async finalizeTerminalFailure")
    );
    expect(failureFn).not.toContain("providerAttemptUsage");
    expect(failureFn).not.toContain("providerAttemptCosts");
  });

  it("projection SQL has no scene usage/cost ledgers", () => {
    const sql = readFileSync(
      resolve("packages/db/sql/ai-story-scene-projection-v1.sql"),
      "utf8"
    );
    expect(sql).toContain("ai_story_scene_projection_correlations");
    expect(sql).toContain("ai_story_scene_results");
    expect(sql).not.toMatch(/ai_story_scene_usage_facts|ai_story_scene_cost_facts/);
    expect(sql).toContain("provider_finalization_reference");
  });

  it("Worker / Adapters do not import Scene Finalizer coordinator as terminal owner", () => {
    const worker = readFileSync(
      resolve("packages/agents/src/ai-story/scene-provider-worker-runtime.ts"),
      "utf8"
    );
    const seedance = readFileSync(
      resolve("packages/agents/src/ai-story/seedance-canonical-adapter.ts"),
      "utf8"
    );
    const minimax = readFileSync(
      resolve("packages/agents/src/ai-story/minimax-canonical-adapter.ts"),
      "utf8"
    );
    for (const source of [worker, seedance, minimax]) {
      expect(source).not.toMatch(/SceneFinalizationCoordinator/);
      expect(source).not.toMatch(/scene-finalization-coordinator/);
      expect(source).not.toMatch(/SceneProviderFinalizer/);
    }
    expect(worker).toContain("finalizerInvoked: false");
  });
});
