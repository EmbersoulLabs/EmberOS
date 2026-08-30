import { describe, expect, it, vi } from "vitest";
import { releaseNextEligibleScene } from "../packages/agents/src/ai-story/release-next-eligible-scene";
import type { StagedSceneReleaseError } from "../packages/agents/src/ai-story/release-remaining-scenes";

const PLAN = "8831afe0-e22b-561e-ba8a-9087996a9113";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const SCENE_2 = "33333333-3333-4333-8333-333333333333";

const authorization = {
  allowed: true,
  accessMode: "ops",
  settlementMode: "none",
  authorizedBy: "ACTIVE_PLATFORM_ADMIN",
  policyVersion: "ai-story-exec-03.v1",
  reason: "next-scene-release-test",
  providerCostAccounting: "ALLOWED",
} as const;

describe("canonical next eligible Scene release", () => {
  it("schedules only the one server-selected newly released Scene", async () => {
    const scheduleAuthorizedScene = vi.fn().mockResolvedValue({ replayed: false });
    const releaseNextEligible = vi.fn().mockResolvedValue({
      rows: [], selectedSceneExecutionId: SCENE_2, selectedSceneOrder: 2, newlyReleased: true,
    });

    const result = await releaseNextEligibleScene({
      executionPlanId: PLAN,
      workspaceId: WORKSPACE,
      actorUserId: USER,
      executionAuthorization: authorization,
      router: { route: vi.fn() } as never,
      releaseRepository: { releaseNextEligible },
      authorizationRepository: {
        getByExecutionPlanId: vi.fn().mockResolvedValue({
          runtimeAuthorizationId: "44444444-4444-4444-8444-444444444444",
          ownership: { workspaceId: WORKSPACE },
        }),
      } as never,
      schedulingCoordinator: { scheduleAuthorizedScene } as never,
    });

    expect(releaseNextEligible).toHaveBeenCalledWith(expect.objectContaining({
      executionPlanId: PLAN, workspaceId: WORKSPACE, actorUserId: USER,
    }));
    expect(scheduleAuthorizedScene).toHaveBeenCalledTimes(1);
    expect(scheduleAuthorizedScene).toHaveBeenCalledWith(expect.objectContaining({
      sceneExecutionId: SCENE_2,
    }));
    expect(result).toMatchObject({
      selectedSceneExecutionId: SCENE_2,
      selectedSceneOrder: 2,
      newlyReleasedSceneCount: 1,
      scheduledSceneCount: 1,
    });
  });

  it("does not schedule when no released Scene can be reconciled", async () => {
    const scheduleAuthorizedScene = vi.fn();
    await expect(releaseNextEligibleScene({
      executionPlanId: PLAN,
      workspaceId: WORKSPACE,
      actorUserId: USER,
      executionAuthorization: authorization,
      router: { route: vi.fn() } as never,
      releaseRepository: {
        releaseNextEligible: vi.fn().mockResolvedValue({
          rows: [], selectedSceneExecutionId: null, selectedSceneOrder: null, newlyReleased: false,
        }),
      },
      authorizationRepository: {
        getByExecutionPlanId: vi.fn().mockResolvedValue({
          runtimeAuthorizationId: "44444444-4444-4444-8444-444444444444",
          ownership: { workspaceId: WORKSPACE },
        }),
      } as never,
      schedulingCoordinator: { scheduleAuthorizedScene } as never,
    })).rejects.toMatchObject<Partial<StagedSceneReleaseError>>({
      code: "NO_NEXT_ELIGIBLE_SCENE",
      status: 409,
    });
    expect(scheduleAuthorizedScene).not.toHaveBeenCalled();
  });

  it("reconciles a duplicate request without a second release transition", async () => {
    const scheduleAuthorizedScene = vi.fn().mockResolvedValue({ replayed: true });
    const result = await releaseNextEligibleScene({
      executionPlanId: PLAN,
      workspaceId: WORKSPACE,
      actorUserId: USER,
      executionAuthorization: authorization,
      router: { route: vi.fn() } as never,
      releaseRepository: {
        releaseNextEligible: vi.fn().mockResolvedValue({
          rows: [], selectedSceneExecutionId: SCENE_2, selectedSceneOrder: 2, newlyReleased: false,
        }),
      },
      authorizationRepository: {
        getByExecutionPlanId: vi.fn().mockResolvedValue({
          runtimeAuthorizationId: "44444444-4444-4444-8444-444444444444",
          ownership: { workspaceId: WORKSPACE },
        }),
      } as never,
      schedulingCoordinator: { scheduleAuthorizedScene } as never,
    });
    expect(scheduleAuthorizedScene).not.toHaveBeenCalled();
    expect(result).toMatchObject({ newlyReleasedSceneCount: 0, scheduledSceneCount: 0, converged: true });
  });
});
