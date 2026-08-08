/**
 * Sprint 3 PR 3.7 Phase C — boundary verification (always runs).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function collectSources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectSources(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
  }
  return files;
}

describe("Sprint 3 PR 3.7 Phase C production runtime wiring boundaries", () => {
  it("adds continuation coordinator and worker cycle modules", () => {
    expect(
      existsSync(
        join(ROOT, "packages/agents/src/ai-story/ai-story-runtime-continuation-coordinator.ts")
      )
    ).toBe(true);
    expect(
      existsSync(join(ROOT, "apps/worker/src/ai-story-provider-worker-cycle.ts"))
    ).toBe(true);
    expect(
      existsSync(join(ROOT, "apps/worker/src/ai-story-canonical-adapter-registry.ts"))
    ).toBe(true);
    expect(read("packages/agents/src/ai-story/index.ts")).toContain(
      'export * from "./ai-story-runtime-continuation-coordinator"'
    );
    expect(read("apps/worker/src/processors/index.ts")).toContain(
      "runAiStoryProviderWorkerCycle"
    );
  });

  it("does not unlock Execute / Browser UI / Export / Publish / Retry", () => {
    const forbidden = [
      "packages/agents/src/ai-story/export-runtime.ts",
      "packages/agents/src/ai-story/publish-runtime.ts",
      "packages/agents/src/ai-story/canonical-execute-entrypoint.ts",
      "apps/worker/src/processors/ai-story-export-handler.ts",
      "apps/worker/src/processors/ai-story-publish-handler.ts",
    ];
    for (const path of forbidden) {
      expect(existsSync(join(ROOT, path))).toBe(false);
    }
    expect(PHASE1_EXECUTION_LOCKED).toBeTruthy();
    expect(read("apps/worker/src/processors/index.ts")).toContain(
      "assertPhase1ExecutionLocked"
    );
  });

  it("continuation does not own persistence authorities or duplicate runtimes", () => {
    const source = read(
      "packages/agents/src/ai-story/ai-story-runtime-continuation-coordinator.ts"
    );
    expect(source).toMatch(/FinalStoryResultProjector/);
    expect(source).toMatch(/runDeterministicAssemblyRuntime/);
    expect(source).toMatch(/SceneFinalizationCoordinator/);
    expect(source).toMatch(/SceneProviderWorkerRuntime/);
    expect(source).not.toMatch(/export-runtime|publish-runtime/);
    expect(source).not.toMatch(/PHASE1_EXECUTION_UNLOCKED|executionAllowed:\s*true/);
    expect(source).not.toMatch(/authorizeAndExecute/);
  });

  it("worker cycle reuses Dispatch authority without second Outbox consumer", () => {
    const cycle = read("apps/worker/src/ai-story-provider-worker-cycle.ts");
    expect(cycle).toMatch(/dispatchNextProviderExecution/);
    expect(cycle).toMatch(/ownership:\s*"AI_STORY_SCENE"/);
    expect(cycle).toMatch(/AiStoryRuntimeContinuationCoordinator/);
    expect(cycle).not.toMatch(/OutboxDispatchWorker|legacy-outbox/);
    expect(cycle).not.toMatch(/agent\.story_execution/);
  });

  it("removes WorkerExecutionResult DELETE/replace supersession (MODEL A)", () => {
    const repo = read("packages/db/src/queries/ai-story-worker-runtime.ts");
    expect(repo).not.toMatch(/\.delete\(schema\.aiStoryWorkerExecutionResults\)/);
    expect(repo).not.toMatch(/canSupersedeWorkerResult/);
    expect(repo).toMatch(/appendWorkerAttemptObservation/);
    expect(repo).toMatch(/aiStoryWorkerAttemptObservations/);
    expect(
      existsSync(
        join(ROOT, "packages/db/sql/ai-story-worker-attempt-observation-v1.sql")
      )
    ).toBe(true);
  });

  it("does not add public Execute or final-story GET APIs", () => {
    const webApi = collectSources(join(ROOT, "apps/web/src/app/api/campaigns"))
      .filter((path) => path.includes("final-story") || path.includes("execute"))
      .map((path) => path.replace(/\\/g, "/"));
    expect(
      webApi.some(
        (path) => path.includes("execution-plans") && path.endsWith("/execute/route.ts")
      )
    ).toBe(false);
    expect(webApi.some((path) => path.includes("final-story-result/route.ts"))).toBe(false);
  });
});
