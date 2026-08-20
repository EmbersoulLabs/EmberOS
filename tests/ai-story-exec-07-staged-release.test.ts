import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("EXEC-07 durable staged Scene release", () => {
  it("persists an explicit release authority for every authorized Scene", () => {
    const schema = read("packages/db/src/schema/index.ts");
    expect(schema).toContain("aiStorySceneReleaseStates");
    expect(read("packages/db/src/queries/ai-story-scene-release.ts")).toContain("AUTHORIZED_NOT_RELEASED");
    expect(existsSync(join(root, "packages/db/sql/ai-story-staged-release-v1.sql"))).toBe(true);
  });

  it("initial Execute schedules only the canonical first Scene", () => {
    const source = read("packages/agents/src/ai-story/authorize-and-execute-execution-plan.ts");
    expect(source).toContain("releases.initialize");
    expect(source).toContain("row.sceneOrder === 1");
    expect(source).toContain("[initialScene.sceneExecutionId]");
    expect(source).not.toContain("for (const sceneExecutionId of orderedSceneExecutionIds)");
  });

  it("remaining release is server-derived and exact-approval gated", () => {
    const repo = read("packages/db/src/queries/ai-story-scene-release.ts");
    expect(repo).toContain("pg_advisory_xact_lock");
    expect(repo).toContain('decision, "APPROVED"');
    expect(repo).toContain('status, "SUCCEEDED"');
    expect(repo).toContain("gateProviderAttemptId");
    expect(repo).toContain("FIRST_SCENE_EXACT_ATTEMPT_REQUIRED");
    expect(repo).toContain("FIRST_SCENE_RETRY_OR_EXECUTION_IN_FLIGHT");
    expect(repo).toContain("providerAttempts.attemptId");
    expect(repo).toContain("result.providerExecutionId");
    const route = read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/release-remaining-scenes/route.ts");
    expect(route).toContain("resolveAuthorizedExecutionPlan");
    expect(route).toContain("authorizeAiStoryExecution");
    expect(route).not.toMatch(/sceneExecutionId|providerId|accessMode|settlementMode/);
  });

  it("keeps provider routing and unrelated frozen products outside the change", () => {
    const service = read("packages/agents/src/ai-story/release-remaining-scenes.ts");
    expect(service).not.toMatch(/seedance|minimax|photoroom|stripe|quota|publishing/i);
  });
});
