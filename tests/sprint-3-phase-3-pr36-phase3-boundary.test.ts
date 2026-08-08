/**
 * Sprint 3 PR 3.6 Phase 3 — boundary verification (always runs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listAssemblyJobRepositoryMutators } from "@ceo-agent/db";
import { PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("Sprint 3 PR 3.6 Phase 3 boundaries", () => {
  it("adds Assembly Job persistence modules only", () => {
    expect(
      existsSync(join(ROOT, "packages/db/sql/ai-story-assembly-job-persistence-v1.sql"))
    ).toBe(true);
    expect(
      existsSync(join(ROOT, "packages/db/src/queries/ai-story-assembly-job.ts"))
    ).toBe(true);
    expect(
      existsSync(
        join(ROOT, "packages/db/scripts/apply-ai-story-assembly-job-persistence-v1.ts")
      )
    ).toBe(true);
  });

  it("does not add Phase B projector/engine modules (Phase A FSR persistence allowed)", () => {
    const forbidden = [
      "packages/agents/src/ai-story/story-assembly-engine.ts",
      "packages/agents/src/ai-story/assembly-artifact-store.ts",
      "apps/worker/src/story-assembly-runtime.ts",
      "packages/agents/src/ai-story/final-story-result-projector.ts",
      "packages/agents/src/ai-story/export-runtime.ts",
      "packages/agents/src/ai-story/publish-runtime.ts",
    ];
    for (const path of forbidden) {
      expect(existsSync(join(ROOT, path))).toBe(false);
    }
    // Phase A may introduce Final Story Result persistence.
    expect(
      existsSync(join(ROOT, "packages/db/src/queries/ai-story-final-story-result.ts"))
    ).toBe(true);
  });

  it("keeps repository append-only without update/delete", () => {
    const source = read("packages/db/src/queries/ai-story-assembly-job.ts");
    const methods = listAssemblyJobRepositoryMutators();
    expect(methods).not.toContain("update");
    expect(methods).not.toContain("delete");
    expect(source).not.toMatch(/async update\(/);
    expect(source).not.toMatch(/async delete\(/);
    expect(source).toMatch(/acceptOrConverge/);
    expect(source).toMatch(/appendAssemblyJobFact/);
    expect(source).toMatch(/acquireTerminalAcceptanceLock/);
  });

  it("does not unlock public execution or invoke providers/ffmpeg", () => {
    expect(PHASE1_EXECUTION_LOCKED).toBeTruthy();
    const source = read("packages/db/src/queries/ai-story-assembly-job.ts");
    expect(source).not.toMatch(/executionAllowed:\s*true/);
    expect(source).not.toMatch(/PHASE1_EXECUTION_UNLOCKED/);
    expect(source).not.toMatch(/from ["'][^"']*fluent-ffmpeg|from ["']ffmpeg/);
    expect(source).not.toMatch(/Seedance|MiniMax/);
    expect(source).not.toMatch(/Finalizer|UsageLedger|CostLedger/);
  });

  it("does not persist Final Story Result rows", () => {
    const sql = read("packages/db/sql/ai-story-assembly-job-persistence-v1.sql");
    expect(sql).toMatch(/ai_story_assembly_jobs/);
    expect(sql).toMatch(/ai_story_assembly_job_facts/);
    expect(sql).not.toMatch(/ai_story_final_story_results/);
    expect(sql).not.toMatch(/CREATE TABLE.*final_story/i);
  });
});
