/**
 * Sprint 3 PR 3.7 Phase A — boundary verification (always runs).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFinalStoryResultRepositoryMutators } from "@ceo-agent/db";
import {
  PHASE1_EXECUTION_LOCKED,
  PR31_FINAL_STORY_RESULT_SCHEMA_AUTHORITATIVE_FOR_PERSISTENCE,
} from "@ceo-agent/shared/server";

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

describe("Sprint 3 PR 3.7 Phase A boundaries", () => {
  it("adds Final Story Result persistence modules only", () => {
    expect(
      existsSync(join(ROOT, "packages/shared/src/ai-story-final-story-result-persistence.ts"))
    ).toBe(true);
    expect(
      existsSync(join(ROOT, "packages/db/sql/ai-story-final-story-result-v1.sql"))
    ).toBe(true);
    expect(
      existsSync(join(ROOT, "packages/db/sql/ai-story-final-story-result-rls-v1.sql"))
    ).toBe(true);
    expect(
      existsSync(join(ROOT, "packages/db/src/queries/ai-story-final-story-result.ts"))
    ).toBe(true);
    expect(
      existsSync(
        join(ROOT, "packages/db/scripts/apply-ai-story-final-story-result-v1.ts")
      )
    ).toBe(true);
    expect(read("packages/shared/src/server.ts")).toContain(
      'export * from "./ai-story-final-story-result-persistence"'
    );
    expect(read("packages/shared/src/index.ts")).not.toContain(
      'export * from "./ai-story-final-story-result-persistence"'
    );
  });

  it("keeps PR 3.1 failed-capable schema non-authoritative for persistence", () => {
    expect(PR31_FINAL_STORY_RESULT_SCHEMA_AUTHORITATIVE_FOR_PERSISTENCE).toBe(false);
    const runtimeContracts = read("packages/shared/src/ai-story-runtime-contracts.ts");
    expect(runtimeContracts).toMatch(/NON-AUTHORITATIVE for Sprint 3 PR 3\.7 persistence/);
    const persistence = read(
      "packages/db/src/queries/ai-story-final-story-result.ts"
    );
    expect(persistence).not.toMatch(/FinalStoryResultSchema/);
    expect(persistence).toMatch(/FinalStoryResultPersistenceRecord/);
  });

  it("repository is accept-or-converge without update/delete", () => {
    const methods = listFinalStoryResultRepositoryMutators();
    expect(methods).toContain("acceptOrConverge");
    expect(methods).not.toContain("update");
    expect(methods).not.toContain("delete");
    const source = read("packages/db/src/queries/ai-story-final-story-result.ts");
    expect(source).not.toMatch(/async update\(/);
    expect(source).not.toMatch(/async delete\(/);
    expect(source).toMatch(/fresh transaction/);
  });

  it("does not start Phase C+ / Execute / Export / Publish / Provider modules (Phase B projector allowed)", () => {
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

  it("Phase A sources do not unlock Execute or invoke providers", () => {
    const phaseASources = [
      "packages/shared/src/ai-story-final-story-result-persistence.ts",
      "packages/db/src/queries/ai-story-final-story-result.ts",
    ]
      .map((path) => read(path))
      .join("\n");
    expect(phaseASources).not.toMatch(/executionAllowed:\s*true/);
    expect(phaseASources).not.toMatch(/PHASE1_EXECUTION_UNLOCKED/);
    expect(phaseASources).not.toMatch(/Seedance|MiniMax/);
    expect(phaseASources).not.toMatch(/authorizeAndExecute|FinalStoryResultProjector/);
    expect(phaseASources).not.toMatch(/runDeterministicAssemblyRuntime/);
    expect(phaseASources).not.toMatch(/export-runtime|publish-runtime/);
  });

  it("SQL creates only Final Story Result table (no Export/Publish)", () => {
    const sql = read("packages/db/sql/ai-story-final-story-result-v1.sql");
    expect(sql).toMatch(/ai_story_final_story_results/);
    expect(sql).not.toMatch(/ai_story_export_/);
    expect(sql).not.toMatch(/ai_story_publish_/);
    expect(sql).toMatch(/UNIQUE \(assembly_job_id\)/);
  });

  it("does not add Execute UI or worker handlers in this phase", () => {
    const webApi = collectSources(
      join(ROOT, "apps/web/src/app/api/campaigns")
    )
      .filter((path) => path.includes("final-story") || path.includes("execute"))
      .map((path) => path.replace(/\\/g, "/"));
    expect(
      webApi.some((path) => path.includes("execution-plans") && path.endsWith("/execute/route.ts"))
    ).toBe(false);
    expect(
      webApi.some((path) => path.includes("final-story-result/route.ts"))
    ).toBe(false);
  });
});
