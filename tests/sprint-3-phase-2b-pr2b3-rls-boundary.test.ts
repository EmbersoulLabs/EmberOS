/**
 * Sprint 3 / Phase 2B / PR 2B.3 — RLS SQL boundary static contract (no DB).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const CANONICAL_TABLES = [
  "ai_story_scene_instruction_snapshots",
  "ai_story_execution_plans",
  "ai_story_scene_executions",
  "ai_story_scene_intent_validation_results",
  "ai_story_review_opened_facts",
  "ai_story_scene_intent_review_facts",
  "ai_story_story_review_facts",
  "ai_story_assembly_definitions",
  "ai_story_assembly_scene_memberships",
] as const;

describe("Sprint 3 / Phase 2B / PR 2B.3 — RLS SQL boundary", () => {
  const sql = read("packages/db/sql/ai-story-canonical-rls-v1.sql");
  const doc = read("docs/architecture/ai-story-canonical-rls.md");

  it("enables RLS on all canonical AI Story tables", () => {
    for (const t of CANONICAL_TABLES) {
      expect(sql).toContain(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
    }
  });

  it("uses DROP POLICY IF EXISTS before CREATE for idempotent replacement", () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS ai_story_scene_executions_insert/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS ai_story_instruction_snapshots_select/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS ai_story_instruction_snapshots_insert/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS ai_story_scene_instruction_snapshots_insert/);
  });

  it("qualifies outer ownership columns on scene INSERT (no tautology pattern)", () => {
    expect(sql).toContain("plan.org_id = ai_story_scene_executions.org_id");
    expect(sql).toContain("plan.workspace_id = ai_story_scene_executions.workspace_id");
    expect(sql).toContain("plan.campaign_id = ai_story_scene_executions.campaign_id");
    expect(sql).toContain("campaign.workspace_id = ai_story_scene_executions.workspace_id");
    expect(sql).not.toMatch(/\b(\w+)\.(org_id|workspace_id|campaign_id)\s*=\s*\1\.\2\b/);
  });

  it("qualifies outer columns on review and assembly INSERT policies", () => {
    expect(sql).toContain("plan.org_id = ai_story_scene_intent_review_facts.org_id");
    expect(sql).toContain("plan.org_id = ai_story_assembly_definitions.org_id");
    expect(sql).toContain(
      "definition.org_id = ai_story_assembly_scene_memberships.org_id"
    );
    expect(sql).toContain(
      "scene.execution_plan_id = ai_story_assembly_scene_memberships.execution_plan_id"
    );
  });

  it("Snapshot SELECT is relationship-scoped via scene → plan chain", () => {
    expect(sql).toContain("ai_story_instruction_snapshots_select");
    expect(sql).toContain(
      "scene.instruction_hash = ai_story_scene_instruction_snapshots.content_hash"
    );
    expect(sql).toContain("plan.id = scene.execution_plan_id");
    expect(doc).toMatch(/relationship-scoped/i);
  });

  it("Snapshot has no authenticated INSERT/UPDATE/DELETE CREATE POLICY", () => {
    expect(sql).not.toMatch(
      /CREATE POLICY ai_story_instruction_snapshots_insert[\s\S]*?FOR INSERT/
    );
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*snapshots[\s\S]*FOR UPDATE/i);
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*snapshots[\s\S]*FOR DELETE/i);
    expect(sql).toContain("DROP POLICY IF EXISTS ai_story_instruction_snapshots_insert");
  });

  it("has no FOR UPDATE / FOR DELETE / FOR ALL CREATE POLICY", () => {
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*?\bFOR UPDATE\b/i);
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*?\bFOR DELETE\b/i);
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*?\bFOR ALL\b/i);
  });

  it("documents service-role bypass as infrastructure, not authorization", () => {
    expect(doc).toMatch(/infrastructure/i);
    expect(doc).toMatch(/not.*authorization/i);
    expect(doc).toMatch(/Repository validation/i);
  });
});
