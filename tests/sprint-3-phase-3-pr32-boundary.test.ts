/**
 * Sprint 3 PR 3.2 — identity / lock / boundary regressions.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PHASE1_EXECUTION_LOCKED,
  RuntimeAuthorizedFactSchema,
  assertPhase1ExecutionLocked,
  Phase1ExecutionLockedError,
} from "@ceo-agent/shared";
import { enqueueStoryExecution } from "../packages/queue/src/index";
import {
  runExecutionJob,
  startExecutionJob,
} from "../packages/agents/src/ai-story/story-execution-orchestrator";

describe("Sprint 3 PR 3.2 boundary + lock", () => {
  it("keeps Phase 1 execution lock fail-closed on startExecutionJob / enqueueStoryExecution", async () => {
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

  it("scene-scheduling-coordinator source stays free of adapter/provider/finalize/usage paths", () => {
    const coordinator = readFileSync(
      resolve("packages/agents/src/ai-story/scene-scheduling-coordinator.ts"),
      "utf8"
    );
    expect(coordinator).toContain("SceneSchedulingCoordinator");
    expect(coordinator).toContain("PHASE1_EXECUTION_LOCKED");
    expect(coordinator).toContain("automaticFallbackEnabled: false");
    expect(coordinator).not.toMatch(
      /adapter\.execute|seedance|minimax|finalize|recordUsage|recordCost|\/api\/.*execution/i
    );
    expect(coordinator).not.toMatch(/from ["']@ceo-agent\/queue["']/);
  });

  it("SQL files ai-story-scene-scheduling-v1.sql and rls exist", () => {
    const sql = readFileSync(
      resolve("packages/db/sql/ai-story-scene-scheduling-v1.sql"),
      "utf8"
    );
    const rls = readFileSync(
      resolve("packages/db/sql/ai-story-scene-scheduling-rls-v1.sql"),
      "utf8"
    );
    expect(sql).toContain("ai_story_runtime_authorized_facts");
    expect(sql).toContain("ai_story_scene_routing_decisions");
    expect(sql).toContain("ai_story_scene_scheduling_correlations");
    expect(sql).toMatch(/automatic_fallback_enabled[\s\S]*FALSE/i);
    expect(rls).toContain("ai_story_runtime_authorized_facts");
    expect(rls).toContain("ai_story_scene_routing_decisions");
    expect(rls).toContain("ai_story_scene_scheduling_correlations");
    expect(rls).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("contracts keep automaticFallbackEnabled false", () => {
    const contracts = readFileSync(
      resolve("packages/shared/src/ai-story-scene-scheduling.ts"),
      "utf8"
    );
    expect(contracts).toContain("automaticFallbackEnabled: z.literal(false)");
    expect(contracts).toContain("executionAllowed: z.literal(false)");
    expect(contracts).toContain("PHASE1_EXECUTION_LOCKED");
  });

  it("PR 3.1 tests remain importable and RuntimeAuthorizedFact keeps runtimeAuthorizationVersion", () => {
    const pr31Source = readFileSync(
      resolve("tests/sprint-3-phase-3-pr31-contracts.test.ts"),
      "utf8"
    );
    expect(pr31Source).toContain('from "@ceo-agent/shared"');
    expect(pr31Source).toContain("RuntimeAuthorizedFactSchema");
    expect(pr31Source).toContain("runtimeAuthorizationVersion");

    const fact = RuntimeAuthorizedFactSchema.parse({
      runtimeAuthorizationId: "10000000-0000-5000-8000-000000000401",
      executionPlanId: "10000000-0000-4000-8000-000000000101",
      runtimeAuthorizationVersion: 1,
      reviewDecisionId: "10000000-0000-4000-8000-000000000301",
      reviewHash:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      assemblyDefinitionId: "10000000-0000-4000-8000-000000000302",
      assemblyHash:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      orderedSceneExecutionIds: ["10000000-0000-4000-8000-000000000201"],
      qcResultIds: ["10000000-0000-4000-8000-000000000311"],
      ownership: {
        orgId: "10000000-0000-4000-8000-000000000001",
        workspaceId: "10000000-0000-4000-8000-000000000002",
        campaignId: "10000000-0000-4000-8000-000000000003",
        storyId: "10000000-0000-4000-8000-000000000004",
        storyVersionId: "10000000-0000-4000-8000-000000000005",
        animationPackageId: "10000000-0000-4000-8000-000000000006",
        executionPlanId: "10000000-0000-4000-8000-000000000101",
      },
      authorizationContractVersion: "1",
      authorizedBy: "10000000-0000-4000-8000-000000000501",
      authorizedAt: "2026-08-04T12:00:00.000Z",
      deterministicIntegrityHash:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    });
    expect(fact.runtimeAuthorizationVersion).toBe(1);
    expect(fact).toHaveProperty("runtimeAuthorizationVersion");
  });
});
