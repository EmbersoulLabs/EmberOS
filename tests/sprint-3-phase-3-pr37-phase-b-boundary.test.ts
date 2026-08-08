/**
 * Sprint 3 PR 3.7 Phase B — boundary verification (always runs).
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

describe("Sprint 3 PR 3.7 Phase B Final Story Result Projector boundaries", () => {
  it("adds FinalStoryResultProjector module and barrel export", () => {
    expect(
      existsSync(join(ROOT, "packages/agents/src/ai-story/final-story-result-projector.ts"))
    ).toBe(true);
    expect(read("packages/agents/src/ai-story/index.ts")).toContain(
      'export * from "./final-story-result-projector"'
    );
  });

  it("does not start Export/Publish (Phase C wiring + Phase D Execute allowed)", () => {
    const forbidden = [
      "packages/agents/src/ai-story/export-runtime.ts",
      "packages/agents/src/ai-story/publish-runtime.ts",
      "packages/agents/src/ai-story/story-delivery-orchestrator.ts",
      "apps/worker/src/processors/ai-story-final-result-handler.ts",
      "apps/worker/src/processors/ai-story-export-handler.ts",
      "apps/worker/src/processors/ai-story-publish-handler.ts",
    ];
    for (const path of forbidden) {
      expect(existsSync(join(ROOT, path))).toBe(false);
    }
    expect(PHASE1_EXECUTION_LOCKED).toBeTruthy();
  });

  it("projector does not import/call Assembly engine, Providers, Finalizer, Export, or Publish", () => {
    const source = read("packages/agents/src/ai-story/final-story-result-projector.ts");
    expect(source).not.toMatch(/runDeterministicAssemblyRuntime/);
    expect(source).not.toMatch(/runDeterministicAssemblyEngine/);
    expect(source).not.toMatch(/SceneProviderWorkerRuntime/);
    expect(source).not.toMatch(/SeedanceCanonicalAdapter/);
    expect(source).not.toMatch(/MinimaxCanonicalAdapter/);
    expect(source).not.toMatch(/SceneFinalizationCoordinator|ProductionFinalizer/);
    expect(source).not.toMatch(/provider-worker-result-finalizer/i);
    expect(source).not.toMatch(/export-runtime|publish-runtime/);
    expect(source).not.toMatch(/fluent-ffmpeg|\bexecFile\b|\bexec\(/);
    expect(source).not.toMatch(/authorizeAndExecute|PHASE1_EXECUTION_UNLOCKED/);
    expect(source).toMatch(/acceptOrConverge/);
    expect(source).toMatch(/assertReadableArtifact/);
    expect(source).toMatch(/orderedSceneResultIds: input\.job\.orderedSceneResultIds/);
    expect(source).not.toMatch(/getBySceneResultId|loadCanonicalSceneResults/);
  });

  it("does not add final-story browser API from Phase B (Phase D Execute owned separately)", () => {
    const webApi = collectSources(join(ROOT, "apps/web/src/app/api/campaigns"))
      .filter((path) => path.includes("final-story"))
      .map((path) => path.replace(/\\/g, "/"));
    expect(webApi.some((path) => path.includes("final-story-result/route.ts"))).toBe(false);
    // Projector module itself must not reference Execute unlock.
    expect(
      read("packages/agents/src/ai-story/final-story-result-projector.ts")
    ).not.toMatch(/authorizeAndExecuteExecutionPlan/);
  });

  it("does not modify Seedance / MiniMax / Production Finalizer modules in Phase B", () => {
    // Presence of provider modules is historical; Phase B must not rewrite them.
    // Boundary is enforced by scoped Phase B file set in release review + no new wiring.
    expect(
      existsSync(join(ROOT, "packages/agents/src/ai-story/seedance-canonical-adapter.ts"))
    ).toBe(true);
    expect(
      existsSync(join(ROOT, "packages/agents/src/ai-story/minimax-canonical-adapter.ts"))
    ).toBe(true);
    const projector = read("packages/agents/src/ai-story/final-story-result-projector.ts");
    expect(projector).not.toMatch(/from ["'].*seedance/i);
    expect(projector).not.toMatch(/from ["'].*minimax/i);
    expect(projector).not.toMatch(/from ["'].*finalizer/i);
  });
});
