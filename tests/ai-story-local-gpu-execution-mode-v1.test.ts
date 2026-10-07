import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migration = read("packages/db/sql/ai-story-local-gpu-execution-mode-v1.sql");
const manifest = JSON.parse(read("docs/releases/ai-story-v1-production-migration-manifest.json")) as {
  entries: Array<{ order: number; file: string; sha256: string; modifiesExistingRows: boolean; destructive: boolean }>;
};

const chain = [
  "packages/db/sql/ai-story-manual-local-generation-handoff-v1.sql",
  "packages/db/sql/ai-story-provider-neutral-generation-result-v1.sql",
  "packages/db/sql/ai-story-local-generation-package-contract-v2.sql",
  "packages/db/sql/ai-story-sequential-manual-local-package-v3.sql",
  "packages/db/sql/ai-story-local-gpu-execution-mode-v1.sql",
];

describe("LOCAL_GPU execution mode migration", () => {
  it("replaces only the execution mode check", () => {
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS ai_story_scene_release_execution_mode_check");
    expect(migration).toContain("'REMOTE_PROVIDER'");
    expect(migration).toContain("'MANUAL_LOCAL'");
    expect(migration).toContain("'LOCAL_GPU'");
    expect(migration).not.toMatch(/\bCREATE\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bADD\s+COLUMN\b/i);
    expect(migration).not.toMatch(/\bUPDATE\b/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(migration).not.toContain("ai_story_local_generation_packages");
    expect(migration).not.toContain("ai_story_generation_results");
  });

  it("appends the LOCAL_GPU chain after the certified 25-step baseline", () => {
    expect(manifest.entries.slice(0, 25)).toHaveLength(25);
    expect(manifest.entries.slice(0, 25).every((entry) => entry.modifiesExistingRows === false)).toBe(true);
    expect(manifest.entries.slice(25).map((entry) => entry.file)).toEqual(chain);
    expect(manifest.entries.map((entry) => entry.order)).toEqual(manifest.entries.map((_, index) => index + 1));
    const mode = manifest.entries.at(-1);
    expect(mode?.destructive).toBe(false);
    expect(mode?.modifiesExistingRows).toBe(false);
    expect(createHash("sha256").update(migration.replace(/\r\n/g, "\n")).digest("hex")).toBe(mode?.sha256);
    const sequential = manifest.entries.find((entry) => entry.file.endsWith("ai-story-sequential-manual-local-package-v3.sql"));
    expect(sequential?.modifiesExistingRows).toBe(true);
    expect(sequential?.destructive).toBe(false);
  });
});
