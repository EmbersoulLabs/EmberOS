/**
 * Sprint 3 PR 3.6 Phase 2 — boundary verification.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("Sprint 3 PR 3.6 Phase 2 boundaries", () => {
  it("adds only validation contracts and read-only validator modules", () => {
    expect(existsSync(join(ROOT, "packages/shared/src/ai-story-assembly-validation.ts"))).toBe(
      true
    );
    expect(
      existsSync(join(ROOT, "packages/agents/src/ai-story/assembly-validation-repository.ts"))
    ).toBe(true);
    expect(existsSync(join(ROOT, "packages/agents/src/ai-story/assembly-validator.ts"))).toBe(
      true
    );
  });

  it("does not add persistence, SQL, engine, artifact, or job-writer modules", () => {
    const forbidden = [
      "packages/db/src/queries/ai-story-assembly-runtime.ts",
      "packages/db/sql/ai-story-assembly-runtime-v1.sql",
      "packages/db/scripts/apply-ai-story-assembly-runtime-v1.ts",
      "packages/agents/src/ai-story/story-assembly-engine.ts",
      "packages/agents/src/ai-story/assembly-artifact-store.ts",
      "packages/agents/src/ai-story/assembly-job-writer.ts",
      "packages/agents/src/ai-story/assembly-final-story-result-writer.ts",
    ];
    for (const path of forbidden) {
      expect(existsSync(join(ROOT, path))).toBe(false);
    }
  });

  it("keeps the repository and validator read-only", () => {
    const repository = read("packages/agents/src/ai-story/assembly-validation-repository.ts");
    const validator = read("packages/agents/src/ai-story/assembly-validator.ts");
    expect(repository).toMatch(/Never writes/);
    expect(repository).not.toMatch(/async (insert|update|delete|create|save|write)/i);
    expect(validator).toMatch(/Never creates Assembly Jobs/);
    expect(validator).not.toMatch(/buildAssemblyJobIdentity|AssemblyJobSchema\.parse/);
    expect(validator).not.toMatch(/AssemblyFinalStoryResultSchema\.parse|parseAssemblyFinalStoryResult/);
    expect(validator).not.toMatch(/\bspawn\(|\bexecFile\(/);
    expect(validator).not.toMatch(/from ["'][^"']*fluent-ffmpeg|from ["']ffmpeg/);
    expect(validator).not.toMatch(/beginTransaction|withTransaction/);
  });

  it("does not unlock public execution", () => {
    expect(PHASE1_EXECUTION_LOCKED).toBeTruthy();
    const validator = read("packages/agents/src/ai-story/assembly-validator.ts");
    expect(validator).not.toMatch(/executionAllowed:\s*true/);
    expect(validator).not.toMatch(/PHASE1_EXECUTION_UNLOCKED/);
  });
});
