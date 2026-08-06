/**
 * Sprint 3 PR 3.3 — boundary regressions.
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

describe("Sprint 3 PR 3.3 boundary", () => {
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

  it("Worker runtime source never reroutes or enables fallback", () => {
    const worker = readFileSync(
      resolve("packages/agents/src/ai-story/scene-provider-worker-runtime.ts"),
      "utf8"
    );
    expect(worker).toContain("SceneProviderWorkerRuntime");
    expect(worker).toContain("PHASE1_EXECUTION_LOCKED");
    expect(worker).toContain("automaticFallbackEnabled: false");
    expect(worker).not.toMatch(/router\.route\(/);
    expect(worker).not.toMatch(/CanonicalProviderRouter/);
    expect(worker).toContain("automaticFallbackEnabled: false");
    expect(worker).not.toMatch(/fallbackProvider\s*=/);
    expect(worker).not.toMatch(/ExecutionFinalizer/);
    expect(worker).not.toMatch(/recordUsage|recordCost/);
  });

  it("test adapters forbid real Seedance/MiniMax HTTP and production payloads", () => {
    const adapters = readFileSync(
      resolve("packages/agents/src/ai-story/canonical-provider-test-adapters.ts"),
      "utf8"
    );
    expect(adapters).toContain("DeterministicCanonicalTestAdapter");
    expect(adapters).toContain("PR33_TEST_ADAPTER_HTTP_FORBIDDEN");
    expect(adapters).not.toMatch(/https?:\/\//);
    expect(adapters).not.toMatch(/fetch\(/);
    expect(adapters).not.toMatch(/SEEDANCE_API_KEY|MINIMAX_API_KEY/);
    expect(adapters).not.toMatch(/api\.seedance|api\.minimax/i);
  });

  it("does not start PR 3.4A/3.4B concrete Provider production modules", () => {
    const files = [
      "packages/agents/src/ai-story/seedance-production-adapter.ts",
      "packages/agents/src/ai-story/minimax-production-adapter.ts",
    ];
    for (const relative of files) {
      expect(() => readFileSync(resolve(relative), "utf8")).toThrow();
    }
  });

  it("Worker never imports Finalizer or Scene projection modules", () => {
    const worker = readFileSync(
      resolve("packages/agents/src/ai-story/scene-provider-worker-runtime.ts"),
      "utf8"
    );
    expect(worker).not.toMatch(/SceneProviderFinalizer|SceneFinalizationCoordinator/);
    expect(worker).not.toMatch(/from ["'].*scene-provider-finalizer/);
    expect(worker).not.toMatch(/from ["'].*scene-finalization-coordinator/);
    expect(worker).not.toMatch(/from ["'].*scene-result-projector/);
    expect(worker).not.toMatch(/from ["'].*scene-usage-ledger/);
    expect(worker).not.toMatch(/from ["'].*scene-cost-ledger/);
    expect(worker).toContain("finalizerInvoked: false");
  });

  it("does not add public Provider callback endpoint in PR 3.3", () => {
    const webApi = readFileSync(
      resolve("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/route.ts"),
      "utf8"
    );
    expect(webApi).toContain("assertPhase1ExecutionLocked");
    expect(() =>
      readFileSync(
        resolve("apps/web/src/app/api/providers/callback/route.ts"),
        "utf8"
      )
    ).toThrow();
  });

  it("SQL freezes router_version=1 and Worker result table without Finalizer writes", () => {
    const routerSql = readFileSync(
      resolve("packages/db/sql/ai-story-scene-routing-router-version-v1.sql"),
      "utf8"
    );
    const workerSql = readFileSync(
      resolve("packages/db/sql/ai-story-worker-runtime-v1.sql"),
      "utf8"
    );
    expect(routerSql).toContain("router_version");
    expect(routerSql).toMatch(/router_version\s*=\s*1/);
    expect(workerSql).toContain("ai_story_worker_execution_results");
    expect(workerSql).not.toMatch(/CREATE TABLE.*usage/i);
    expect(workerSql).not.toMatch(/provider_attempt_usage|provider_attempt_costs|scene_results/i);
  });
});
