/**
 * Sprint 3 Phase 2B PR 2B.2 — boundary regression.
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

describe("Sprint 3 Phase 2B PR 2B.2 boundary regression", () => {
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

  it("assembly repository source never imports forbidden runtime modules", () => {
    const source = readFileSync(
      resolve("packages/db/src/queries/ai-story-execution-plan-assembly.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/from ["']@ceo-agent\/queue["']/);
    expect(source).not.toMatch(/provider-outbox|provider_outbox/);
    expect(source).not.toMatch(/CanonicalProviderRouter|ProviderRouter/);
    expect(source).not.toMatch(/from ["'].*seedance|from ["'].*minimax|from ["'].*upscale/i);
    expect(source).not.toMatch(/from ["'].*billing/);
    expect(source).not.toMatch(/from ["'].*ffmpeg/);
    expect(source).not.toContain("assertPhase1ExecutionLocked");
    expect(source).toContain("ExecutionPlanAssemblyRepository");
    expect(source).toContain("ASSEMBLY_INTEGRITY_VIOLATION");
    expect(source).toContain("assertAssemblyReloadIntegrity");
    expect(source.toLowerCase()).toContain("immutable");
    expect(source).not.toMatch(/membershipComplete\s*=\s*false/);
  });

  it("PR 2B.2 does not add API routes, UI, RLS, Queue, Worker, Outbox, or Story Video", () => {
    const sql = readFileSync(
      resolve("packages/db/sql/ai-story-assembly-definition-persistence-v1.sql"),
      "utf8"
    );
    expect(sql.toLowerCase()).not.toContain("enable row level security");
    expect(sql.toLowerCase()).not.toContain("create policy");
    expect(sql).toContain("ai_story_assembly_definitions");
    expect(sql).toContain("ai_story_assembly_scene_memberships");
    expect(sql).not.toMatch(/UPDATE\s+/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);

    const contracts = readFileSync(
      resolve("packages/shared/src/ai-story-assembly.ts"),
      "utf8"
    );
    expect(contracts).toContain("StoryAssemblyDefinition");
    expect(contracts).toContain("AssemblySceneMembership");
    expect(contracts).toContain("AssemblyProjection");
    expect(contracts).toMatch(/READY_FOR_EXECUTION is never persisted/);
    expect(contracts).toMatch(/NOT media assembly/);
    expect(contracts).toMatch(/NOT Story Video/);
  });

  it("Phase 2A and PR 2B.1 persistence remain present and unchanged in role", () => {
    const phase2a = readFileSync(
      resolve("packages/db/src/queries/ai-story-scene-execution-persistence.ts"),
      "utf8"
    );
    expect(phase2a).toContain("AiStorySceneExecutionPersistenceRepository");
    expect(phase2a).toContain("persistCompilation");

    const review = readFileSync(
      resolve("packages/db/src/queries/ai-story-execution-plan-review.ts"),
      "utf8"
    );
    expect(review).toContain("ExecutionPlanReviewRepository");
    expect(review.toLowerCase()).toContain("append-only");

    const reviewSql = readFileSync(
      resolve("packages/db/sql/ai-story-human-review-persistence-v1.sql"),
      "utf8"
    );
    expect(reviewSql).toContain("ai_story_review_opened_facts");
    expect(reviewSql).toContain("ai_story_scene_intent_review_facts");
    expect(reviewSql).toContain("ai_story_story_review_facts");
  });
});
