/**
 * Sprint 3 Phase 2B PR 2B.1 — boundary regression.
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

describe("Sprint 3 Phase 2B PR 2B.1 boundary regression", () => {
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

  it("review repository source never imports forbidden runtime modules", () => {
    const source = readFileSync(
      resolve("packages/db/src/queries/ai-story-execution-plan-review.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/from ["']@ceo-agent\/queue["']/);
    expect(source).not.toMatch(/provider-outbox|provider_outbox/);
    expect(source).not.toMatch(/CanonicalProviderRouter|ProviderRouter/);
    expect(source).not.toMatch(/seedance|minimax|upscale/i);
    expect(source).not.toMatch(/from ["'].*billing/);
    expect(source).not.toContain("assertPhase1ExecutionLocked");
    expect(source).toContain("ExecutionPlanReviewRepository");
    expect(source.toLowerCase()).toContain("append-only");
  });

  it("PR 2B.1 does not add Assembly Definition, API routes, UI, or RLS policies", () => {
    const sql = readFileSync(
      resolve("packages/db/sql/ai-story-human-review-persistence-v1.sql"),
      "utf8"
    );
    expect(sql).not.toMatch(/CREATE TABLE[\s\S]*assembly/i);
    expect(sql.toLowerCase()).not.toContain("enable row level security");
    expect(sql.toLowerCase()).not.toContain("create policy");
    expect(sql).toContain("ai_story_review_opened_facts");
    expect(sql).toContain("ai_story_scene_intent_review_facts");
    expect(sql).toContain("ai_story_story_review_facts");

    const contracts = readFileSync(
      resolve("packages/shared/src/ai-story-human-review.ts"),
      "utf8"
    );
    expect(contracts).toContain("LOGICAL AGGREGATE");
    expect(contracts).toContain("UNDER_REVIEW");
    expect(contracts).toContain("APPROVED");
    expect(contracts).toContain("REJECTED");
    expect(contracts).toContain("LOGICAL_REVIEW_STATUSES");
    expect(contracts).toMatch(/READY_FOR_EXECUTION is not a review state/);
    expect(contracts).toMatch(/does not authorize API, UI, RLS/);
  });

  it("Phase 2A persistence foundation files remain present and authoritative for plans", () => {
    const phase2a = readFileSync(
      resolve("packages/db/src/queries/ai-story-scene-execution-persistence.ts"),
      "utf8"
    );
    expect(phase2a).toContain("AiStorySceneExecutionPersistenceRepository");
    expect(phase2a).toContain("persistCompilation");
  });
});
