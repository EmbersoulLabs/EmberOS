/**
 * Sprint 3 Phase 2B PR 2B.3 — RLS coverage + boundary regression.
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

const AI_STORY_RLS_TABLES = [
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

describe("Sprint 3 Phase 2B PR 2B.3 RLS coverage and boundary", () => {
  it("keeps Phase 1 execution lock fail-closed", async () => {
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

  it("enables RLS and SELECT/INSERT policies on every canonical AI Story table", () => {
    const sql = readFileSync(
      resolve("packages/db/sql/ai-story-canonical-rls-v1.sql"),
      "utf8"
    );
    for (const table of AI_STORY_RLS_TABLES) {
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i")
      );
    }
    expect(sql).toContain("ai_story_execution_plans_select");
    expect(sql).toContain("ai_story_execution_plans_insert");
    expect(sql).toContain("ai_story_scene_executions_select");
    expect(sql).toContain("ai_story_assembly_definitions_select");
    expect(sql).toContain("ai_story_assembly_memberships_insert");
    expect(sql).toContain("ai_story_review_opened_select");
    expect(sql).toContain("ai_story_scene_intent_review_insert");
    expect(sql).toContain("ai_story_story_review_select");
    expect(sql).toContain("ai_story_instruction_snapshots_select");
    expect(sql).toContain("ai_story_scene_validation_select");
    // Snapshots: relationship SELECT only — drop any prior INSERT policy; do not recreate it.
    expect(sql).toContain("DROP POLICY IF EXISTS ai_story_instruction_snapshots_insert");
    expect(sql).not.toMatch(
      /CREATE POLICY ai_story_instruction_snapshots_insert[\s\S]*?FOR INSERT/i
    );
  });

  it("does not grant UPDATE or DELETE policies for immutable AI Story entities", () => {
    const sql = readFileSync(
      resolve("packages/db/sql/ai-story-canonical-rls-v1.sql"),
      "utf8"
    );
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*FOR UPDATE/i);
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*FOR DELETE/i);
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*FOR ALL/i);
  });

  it("qualifies outer ownership columns (no EXISTS column-shadowing tautologies)", () => {
    const sql = readFileSync(
      resolve("packages/db/sql/ai-story-canonical-rls-v1.sql"),
      "utf8"
    );
    expect(sql).toContain("plan.org_id = ai_story_scene_executions.org_id");
    expect(sql).toContain("plan.campaign_id = ai_story_scene_executions.campaign_id");
    expect(sql).toContain(
      "scene.instruction_hash = ai_story_scene_instruction_snapshots.content_hash"
    );
    expect(sql).not.toMatch(/\b(\w+)\.(\w+_id)\s*=\s*\1\.\2\b/);
  });

  it("ownership module and repositories stay outside Queue / Provider / Story Video", () => {
    for (const relative of [
      "packages/db/src/queries/ai-story-ownership.ts",
      "packages/db/scripts/apply-ai-story-canonical-rls-v1.ts",
    ]) {
      const source = readFileSync(resolve(relative), "utf8");
      expect(source).not.toMatch(/from ["']@ceo-agent\/queue["']/);
      expect(source).not.toMatch(/provider-outbox|CanonicalProviderRouter/);
      expect(source).not.toMatch(/from ["'].*ffmpeg/);
    }
    const ownership = readFileSync(
      resolve("packages/db/src/queries/ai-story-ownership.ts"),
      "utf8"
    );
    expect(ownership).toContain("OWNERSHIP_INTEGRITY_VIOLATION");
    expect(ownership).toContain("assertExecutionPlanOwnershipChain");
  });

  it("Phase 2A / 2B.1 / 2B.2 persistence foundations remain present", () => {
    expect(
      readFileSync(
        resolve("packages/db/src/queries/ai-story-scene-execution-persistence.ts"),
        "utf8"
      )
    ).toContain("AiStorySceneExecutionPersistenceRepository");
    expect(
      readFileSync(
        resolve("packages/db/src/queries/ai-story-execution-plan-review.ts"),
        "utf8"
      )
    ).toContain("ExecutionPlanReviewRepository");
    expect(
      readFileSync(
        resolve("packages/db/src/queries/ai-story-execution-plan-assembly.ts"),
        "utf8"
      )
    ).toContain("ExecutionPlanAssemblyRepository");
  });
});
