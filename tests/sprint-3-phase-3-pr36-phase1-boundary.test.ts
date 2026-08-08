/**
 * Sprint 3 PR 3.6 Phase 1 — boundary verification.
 *
 * Confirms Phase 1 is contract/identity only: no runtime, repository, SQL,
 * engine, worker, or public execution unlock.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function listIfExists(relativePath: string): string[] {
  const absolute = join(ROOT, relativePath);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute);
}

describe("Sprint 3 PR 3.6 Phase 1 boundaries", () => {
  it("adds assembly-runtime contracts on the server entrypoint (not client barrel)", () => {
    expect(existsSync(join(ROOT, "packages/shared/src/ai-story-assembly-runtime.ts"))).toBe(
      true
    );
    expect(existsSync(join(ROOT, "packages/shared/src/ai-story-assembly-runtime-execution.ts"))).toBe(
      true
    );
    expect(read("packages/shared/src/server.ts")).toContain(
      'export * from "./ai-story-assembly-runtime"'
    );
    expect(read("packages/shared/src/server.ts")).toContain(
      'export * from "./ai-story-assembly-runtime-execution"'
    );
    // Keep Node-backed Assembly contracts off the Next.js client barrel.
    expect(read("packages/shared/src/index.ts")).not.toContain(
      'export * from "./ai-story-assembly-runtime"'
    );
  });

  it("does not introduce repositories, SQL, drizzle scripts, or engine modules", () => {
    const forbidden = [
      "packages/db/src/queries/ai-story-assembly-runtime.ts",
      "packages/db/sql/ai-story-assembly-runtime-v1.sql",
      "packages/db/scripts/apply-ai-story-assembly-runtime-v1.ts",
      "packages/agents/src/ai-story/story-assembly-engine.ts",
      "packages/agents/src/ai-story/assembly-artifact-store.ts",
      "apps/worker/src/story-assembly-runtime.ts",
    ];
    for (const path of forbidden) {
      expect(existsSync(join(ROOT, path))).toBe(false);
    }
  });

  it("keeps public execution locked and does not unlock runtime", () => {
    const source = read("packages/shared/src/ai-story-assembly-runtime.ts");
    expect(PHASE1_EXECUTION_LOCKED).toBeTruthy();
    expect(source).not.toMatch(/executionAllowed:\s*true/);
    expect(source).not.toMatch(/PHASE1_EXECUTION_UNLOCKED/);
    expect(source).not.toMatch(/export const\s+.*UNLOCK/);
  });

  it("does not invoke Providers, Finalizer, usage, cost, Seedance, or MiniMax", () => {
    const source = read("packages/shared/src/ai-story-assembly-runtime.ts");
    expect(source).not.toMatch(/from ["'][^"']*provider-execution/);
    expect(source).not.toMatch(/import\s+.*Finalizer/);
    expect(source).not.toMatch(/from ["'][^"']*seedance|from ["'][^"']*minimax/i);
    expect(source).not.toMatch(/UsageLedger|CostLedger/);
    expect(source).not.toMatch(/beginTransaction|withTransaction/);
    expect(source).not.toMatch(/export class\s+\w*Repository/);
  });

  it("preserves Aggregate Root language — Execution Plan only", () => {
    const source = read("packages/shared/src/ai-story-assembly-runtime.ts");
    expect(source).toMatch(/Execution Plan remains the sole Aggregate Root/);
    expect(source).toMatch(/subordinate/);
  });

  it("keeps historically forbidden agent module names absent (Runtime uses assembly-runtime-* names)", () => {
    const agents = listIfExists("packages/agents/src/ai-story");
    expect(agents).not.toContain("story-assembly-engine.ts");
    expect(agents).not.toContain("assembly-artifact-store.ts");
    expect(agents.some((name) => name.startsWith("assembly-runtime-"))).toBe(true);
  });
});
