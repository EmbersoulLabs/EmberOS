/**
 * Sprint 3 PR 3.6 — Assembly Runtime boundary verification (always runs).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared";
import { listAssemblyArtifactRepositoryMutators } from "@ceo-agent/db";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function collectSources(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectSources(full));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("Sprint 3 PR 3.6 Assembly Runtime boundaries", () => {
  it("adds runtime modules; Phase A may add Final Story Result persistence", () => {
    expect(
      existsSync(join(ROOT, "packages/agents/src/ai-story/assembly-runtime-orchestrator.ts"))
    ).toBe(true);
    expect(
      existsSync(join(ROOT, "packages/agents/src/ai-story/assembly-runtime-engine.ts"))
    ).toBe(true);
    expect(
      existsSync(join(ROOT, "packages/db/sql/ai-story-assembly-runtime-artifact-v1.sql"))
    ).toBe(true);
    expect(
      existsSync(join(ROOT, "packages/db/scripts/apply-ai-story-assembly-runtime-artifact-v1.ts"))
    ).toBe(true);
    // PR 3.6 runtime itself did not ship FSR projector; PR 3.7 Phase B may add it.
  });

  it("keeps Phase 2/3 forbidden exact module names absent", () => {
    const forbidden = [
      "packages/agents/src/ai-story/story-assembly-engine.ts",
      "packages/agents/src/ai-story/assembly-artifact-store.ts",
      "apps/worker/src/story-assembly-runtime.ts",
    ];
    for (const path of forbidden) {
      expect(existsSync(join(ROOT, path))).toBe(false);
    }
  });

  it("does not unlock public execution", () => {
    expect(PHASE1_EXECUTION_LOCKED).toBeTruthy();
    const runtimeDir = join(ROOT, "packages/agents/src/ai-story");
    const sources = collectSources(runtimeDir)
      .filter((path) => path.includes("assembly-runtime"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(sources).not.toMatch(/executionAllowed:\s*true/);
    expect(sources).not.toMatch(/PHASE1_EXECUTION_UNLOCKED/);
  });

  it("does not invoke Seedance, MiniMax, Finalizer, Usage, or Cost", () => {
    const runtimeDir = join(ROOT, "packages/agents/src/ai-story");
    const sources = collectSources(runtimeDir)
      .filter((path) => path.includes("assembly-runtime"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(sources).not.toMatch(/Seedance|MiniMax/);
    expect(sources).not.toMatch(/Finalizer|UsageLedger|CostLedger|provider-usage|provider-cost/i);
    expect(sources).not.toMatch(/runSeedance|runMiniMax|invokeProvider/i);
    expect(sources).not.toMatch(/WorkerExecutionResult/);
    expect(sources).toMatch(/createWorkspaceScopedStorageMediaAccessPort/);
    expect(sources).toMatch(/assertReadableArtifact/);
    expect(sources).toMatch(/execFile/);
    expect(sources).not.toMatch(/\bexec\(/);
    expect(sources).not.toMatch(/shell:\s*true/);
  });

  it("artifact repository remains append/converge without update/delete", () => {
    const methods = listAssemblyArtifactRepositoryMutators();
    expect(methods).not.toContain("update");
    expect(methods).not.toContain("delete");
    const source = read("packages/db/src/queries/ai-story-assembly-artifact.ts");
    expect(source).not.toMatch(/async update\(/);
    expect(source).not.toMatch(/async delete\(/);
  });

  it("does not start PR 3.7 Phase C+ Export/Publish (Phase A persistence + Phase B projector allowed)", () => {
    expect(existsSync(join(ROOT, "packages/agents/src/ai-story/export-runtime.ts"))).toBe(
      false
    );
    expect(existsSync(join(ROOT, "packages/agents/src/ai-story/publish-runtime.ts"))).toBe(
      false
    );
    // Phase A persistence contract/module is expected once PR 3.7 Phase A lands.
    expect(
      existsSync(
        join(ROOT, "packages/shared/src/ai-story-final-story-result-persistence.ts")
      )
    ).toBe(true);
  });

  it("SQL creates assembly artifacts; Final Story Result table may exist from Phase A", () => {
    const sql = read("packages/db/sql/ai-story-assembly-runtime-artifact-v1.sql");
    expect(sql).toMatch(/ai_story_assembly_artifacts/);
    expect(sql).not.toMatch(/ai_story_final_story_results/);
  });
});
