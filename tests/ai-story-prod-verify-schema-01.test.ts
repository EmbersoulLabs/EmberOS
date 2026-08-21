import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ProductionVerificationStepTimeoutError,
  runProductionVerificationStep,
} from "../apps/web/src/lib/ai-story-production-verification-fixture";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const fixturePath = "apps/web/src/lib/ai-story-production-verification-fixture.ts";
const fixtureRoutePath =
  "apps/web/src/app/api/admin/ai-story/campaigns/[id]/production-verification-fixture/route.ts";
const productExecutePath =
  "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts";
const verifyExecutePath =
  "apps/web/src/app/api/admin/ai-story/campaigns/[id]/stories/[storyId]/execution-plans/[executionPlanId]/verify-execute/route.ts";

describe("PROD-VERIFY-SCHEMA-01 production verification fail-closed repair", () => {
  it("A/B applies the one authoritative additive migration idempotently", () => {
    const schema = read("packages/db/sql/ai-story-production-verification-v1.sql");
    const rls = read("packages/db/sql/ai-story-production-verification-rls-v1.sql");
    const apply = read("packages/db/scripts/apply-ai-story-production-verification-v1.ts");
    expect(schema).toContain("create table if not exists ai_story_execute_verifications");
    expect(schema).toContain("execution_plan_id uuid primary key");
    expect(schema).toContain("runtime_authorization_id uuid not null unique");
    expect(schema).toContain("outbox_job_id text not null unique");
    expect(schema).toContain("check (verification_mode = true)");
    expect(schema).toContain("check (authorized_by = 'ACTIVE_PLATFORM_ADMIN')");
    expect(rls).toContain("enable row level security");
    expect(rls).toContain("workspace_id in (select user_workspace_ids())");
    expect(apply).toContain('"ai-story-production-verification-v1.sql"');
    expect(apply).toContain('"ai-story-production-verification-rls-v1.sql"');
  });

  it("E-I keeps incomplete fixtures non-ready and classifies bounded failures", () => {
    const source = read(fixturePath);
    const executeIndex = source.indexOf('step("canonical_verification_execute"');
    const completedIndex = source.indexOf('step("fixture_state_completed"');
    expect(source).toContain('verificationFixtureState: "CREATING"');
    expect(source).not.toContain(
      'setAiStoryStatus(db, story.id, "planning_review", "ready_for_execution");\n\n    const generated'
    );
    expect(executeIndex).toBeGreaterThan(-1);
    expect(completedIndex).toBeGreaterThan(executeIndex);
    expect(source).toContain('"fixture_state_failed_incomplete"');
    expect(source).toContain('status: "failed", archivedAt: new Date()');
    expect(source).toContain("Story remains planning_review");
  });

  it("I-K denies every product Execute for verification fixture lineage", () => {
    const access = read("apps/web/src/lib/ai-story-execution-plan-access.ts");
    const productExecute = read(productExecutePath);
    const verifyExecute = read(verifyExecutePath);
    expect(access).toContain("verificationFixture:");
    expect(access).toContain("sourceContextSnapshot?.verificationFixture === true");
    expect(productExecute).toContain("AI_STORY_PRODUCTION_VERIFICATION_REQUIRED");
    expect(verifyExecute).toContain("AI_STORY_PRODUCTION_VERIFICATION_INCOMPLETE");
    expect(verifyExecute).toContain('ctx.storyStatus !== "ready_for_execution"');
  });

  it("projects preserved legacy partial evidence as non-ready without mutating it", () => {
    const service = read("apps/web/src/lib/ai-story-service.ts");
    const storyRoute = read(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/route.ts"
    );
    expect(service).toContain("LEGACY_PARTIAL_VERIFICATION_FIXTURE");
    expect(service).toContain("schema.aiStoryExecuteVerifications");
    expect(storyRoute).toContain(
      'loaded.verificationFixtureState === "LEGACY_PARTIAL_VERIFICATION_FIXTURE"'
    );
    expect(storyRoute).toContain('story: { ...loaded.story, status: "failed" }');
    expect(storyRoute).toContain("persistedStoryStatus: loaded.story.status");
    expect(storyRoute).not.toContain("update(schema.aiStories)");
  });

  it("P adds bounded per-step and whole-fixture timing evidence", () => {
    const source = read(fixturePath);
    const route = read(fixtureRoutePath);
    expect(source).toContain("AI_STORY_PROD_VERIFY_STEP_TIMEOUT_MS = 15_000");
    expect(source).toContain("AI_STORY_PROD_VERIFY_TOTAL_TIMEOUT_MS = 120_000");
    expect(source).toContain("fixtureDeadline");
    expect(source).toContain("Promise.race");
    expect(source).toContain("AI_STORY_PROD_VERIFY_STEP_STARTED");
    expect(source).toContain("AI_STORY_PROD_VERIFY_STEP_COMPLETED");
    expect(source).toContain("AI_STORY_PROD_VERIFY_STEP_FAILED");
    expect(source).toContain('step("review_open"');
    expect(source).toContain('step("assembly_definition"');
    expect(source).toContain('step("canonical_verification_execute"');
    expect(route).toContain('"platform_admin_authority"');
  });

  it("P fails a stalled production step closed within its explicit bound", async () => {
    const timings: Array<{ step: string; status: "PASS" | "FAIL" | "TIMEOUT"; durationMs: number }> = [];
    await expect(
      runProductionVerificationStep(
        "stalled_test_step",
        () => new Promise<never>(() => undefined),
        { timeoutMs: 5, timings }
      )
    ).rejects.toBeInstanceOf(ProductionVerificationStepTimeoutError);
    expect(timings).toHaveLength(1);
    expect(timings[0]).toMatchObject({ step: "stalled_test_step", status: "TIMEOUT" });
  });

  it("L-O retains canonical verification and zero-provider safety authority", () => {
    const fixture = read(fixturePath);
    const scheduling = read("packages/db/src/queries/ai-story-scene-scheduling.ts");
    expect(fixture).toContain("authorizeAndExecuteExecutionPlan");
    expect(fixture).toContain("productionVerification:");
    expect(fixture).toContain("externalAiCalls: 0");
    expect(scheduling).toContain('status: productionVerification ? "CANCELLED" : "PENDING"');
    expect(scheduling).toContain(".insert(schema.aiStoryExecuteVerifications)");
  });
});
