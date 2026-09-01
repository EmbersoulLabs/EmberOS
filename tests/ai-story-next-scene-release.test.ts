import { describe, expect, it, vi } from "vitest";
import { releaseNextEligibleScene } from "../packages/agents/src/ai-story/release-next-eligible-scene";
import type { StagedSceneReleaseError } from "../packages/agents/src/ai-story/release-remaining-scenes";
import { CommercialAuthorizationError } from "@ceo-agent/db";

const PLAN = "8831afe0-e22b-561e-ba8a-9087996a9113";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const SCENE_2 = "33333333-3333-4333-8333-333333333333";
const ORG = "55555555-5555-4555-8555-555555555555";
const COMMERCIAL_AUTH = "66666666-6666-4666-8666-666666666666";

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
          ownership: { orgId: ORG, workspaceId: WORKSPACE },
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
          ownership: { orgId: ORG, workspaceId: WORKSPACE },
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
          ownership: { orgId: ORG, workspaceId: WORKSPACE },
        }),
      } as never,
      schedulingCoordinator: { scheduleAuthorizedScene } as never,
    });
    expect(scheduleAuthorizedScene).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ newlyReleasedSceneCount: 0, scheduledSceneCount: 1, converged: true });
  });

  it("resolves canonical billable authorization before release and propagates its identity", async () => {
    const callOrder: string[] = [];
    const authorizeExecutionPlanExecute = vi.fn().mockImplementation(async () => {
      callOrder.push("commercial");
      return { authorization: {
        commercialAuthorizationId: COMMERCIAL_AUTH,
        orgId: ORG,
        workspaceId: WORKSPACE,
        capabilityKey: "ai_story.execute",
        executionIdentity: `execution-plan:${PLAN}`,
      }, replayed: true };
    });
    const releaseNextEligible = vi.fn().mockImplementation(async () => {
      callOrder.push("release");
      return { rows: [], selectedSceneExecutionId: SCENE_2, selectedSceneOrder: 2, newlyReleased: true };
    });
    const scheduleAuthorizedScene = vi.fn().mockImplementation(async () => {
      callOrder.push("schedule");
      return { replayed: false };
    });

    await releaseNextEligibleScene({
      executionPlanId: PLAN,
      workspaceId: WORKSPACE,
      actorUserId: USER,
      executionAuthorization: {
        ...authorization,
        accessMode: "commercial",
        settlementMode: "credits",
      },
      router: { route: vi.fn() } as never,
      releaseRepository: { releaseNextEligible },
      authorizationRepository: { getByExecutionPlanId: vi.fn().mockResolvedValue({
        runtimeAuthorizationId: "44444444-4444-4444-8444-444444444444",
        ownership: { orgId: ORG, workspaceId: WORKSPACE },
      }) } as never,
      commercialAuthorizationService: { authorizeExecutionPlanExecute } as never,
      schedulingCoordinator: { scheduleAuthorizedScene } as never,
      now: () => new Date("2026-09-01T06:40:40.407Z"),
    });

    expect(callOrder).toEqual(["commercial", "release", "schedule"]);
    expect(authorizeExecutionPlanExecute).toHaveBeenCalledWith({
      orgId: ORG,
      workspaceId: WORKSPACE,
      executionPlanId: PLAN,
      authorizedAt: "2026-09-01T06:40:40.407Z",
    });
    expect(scheduleAuthorizedScene).toHaveBeenCalledWith(expect.objectContaining({
      commercialAuthorizationId: COMMERCIAL_AUTH,
      sceneExecutionId: SCENE_2,
    }));
  });

  it("fails before committing release when canonical commercial authorization is missing", async () => {
    const releaseNextEligible = vi.fn();
    const scheduleAuthorizedScene = vi.fn();
    await expect(releaseNextEligibleScene({
      executionPlanId: PLAN,
      workspaceId: WORKSPACE,
      actorUserId: USER,
      executionAuthorization: {
        ...authorization,
        accessMode: "commercial",
        settlementMode: "credits",
      },
      router: { route: vi.fn() } as never,
      releaseRepository: { releaseNextEligible },
      authorizationRepository: { getByExecutionPlanId: vi.fn().mockResolvedValue({
        runtimeAuthorizationId: "44444444-4444-4444-8444-444444444444",
        ownership: { orgId: ORG, workspaceId: WORKSPACE },
      }) } as never,
      commercialAuthorizationService: {
        authorizeExecutionPlanExecute: vi.fn().mockRejectedValue(
          new CommercialAuthorizationError(
            "COMMERCIAL_AUTH_NOT_FOUND",
            "Commercial authorization is missing"
          )
        ),
      } as never,
      schedulingCoordinator: { scheduleAuthorizedScene } as never,
    })).rejects.toMatchObject<Partial<StagedSceneReleaseError>>({
      code: "COMMERCIAL_AUTH_NOT_FOUND",
    });
    expect(releaseNextEligible).not.toHaveBeenCalled();
    expect(scheduleAuthorizedScene).not.toHaveBeenCalled();
  });

  it("fails before release when resolved commercial authorization has mismatched ownership", async () => {
    const releaseNextEligible = vi.fn();
    await expect(releaseNextEligibleScene({
      executionPlanId: PLAN,
      workspaceId: WORKSPACE,
      actorUserId: USER,
      executionAuthorization: { ...authorization, accessMode: "commercial", settlementMode: "credits" },
      router: { route: vi.fn() } as never,
      releaseRepository: { releaseNextEligible },
      authorizationRepository: { getByExecutionPlanId: vi.fn().mockResolvedValue({
        runtimeAuthorizationId: "44444444-4444-4444-8444-444444444444",
        ownership: { orgId: ORG, workspaceId: WORKSPACE },
      }) } as never,
      commercialAuthorizationService: { authorizeExecutionPlanExecute: vi.fn().mockResolvedValue({
        authorization: {
          commercialAuthorizationId: COMMERCIAL_AUTH,
          orgId: ORG,
          workspaceId: "77777777-7777-4777-8777-777777777777",
          capabilityKey: "ai_story.execute",
          executionIdentity: `execution-plan:${PLAN}`,
        },
        replayed: true,
      }) } as never,
    })).rejects.toMatchObject<Partial<StagedSceneReleaseError>>({ code: "COMMERCIAL_AUTH_DENIED" });
    expect(releaseNextEligible).not.toHaveBeenCalled();
  });

  it("converges a durable released Scene after a scheduling interruption", async () => {
    const releaseRepository = {
      releaseNextEligible: vi.fn()
        .mockResolvedValueOnce({ rows: [], selectedSceneExecutionId: SCENE_2, selectedSceneOrder: 2, newlyReleased: true })
        .mockResolvedValueOnce({ rows: [], selectedSceneExecutionId: SCENE_2, selectedSceneOrder: 2, newlyReleased: false }),
    };
    const schedulingCoordinator = {
      scheduleAuthorizedScene: vi.fn()
        .mockRejectedValueOnce(new Error("SIMULATED_SCHEDULING_INTERRUPTION"))
        .mockResolvedValueOnce({ replayed: false }),
    };
    const common = {
      executionPlanId: PLAN,
      workspaceId: WORKSPACE,
      actorUserId: USER,
      executionAuthorization: authorization,
      router: { route: vi.fn() } as never,
      releaseRepository,
      authorizationRepository: { getByExecutionPlanId: vi.fn().mockResolvedValue({
        runtimeAuthorizationId: "44444444-4444-4444-8444-444444444444",
        ownership: { orgId: ORG, workspaceId: WORKSPACE },
      }) } as never,
      schedulingCoordinator: schedulingCoordinator as never,
    };
    await expect(releaseNextEligibleScene(common)).rejects.toThrow("SIMULATED_SCHEDULING_INTERRUPTION");
    const replay = await releaseNextEligibleScene(common);
    expect(replay).toMatchObject({
      selectedSceneExecutionId: SCENE_2,
      newlyReleasedSceneCount: 0,
      scheduledSceneCount: 1,
      converged: false,
    });
    expect(schedulingCoordinator.scheduleAuthorizedScene).toHaveBeenCalledTimes(2);
  });

  it("concurrent continuation attempts converge scheduling without selecting a later Scene", async () => {
    let releaseCall = 0;
    const releaseNextEligible = vi.fn().mockImplementation(async () => ({
      rows: [],
      selectedSceneExecutionId: SCENE_2,
      selectedSceneOrder: 2,
      newlyReleased: releaseCall++ === 0,
    }));
    const scheduleAuthorizedScene = vi.fn()
      .mockResolvedValueOnce({ replayed: false })
      .mockResolvedValueOnce({ replayed: true });
    const common = {
      executionPlanId: PLAN,
      workspaceId: WORKSPACE,
      actorUserId: USER,
      executionAuthorization: authorization,
      router: { route: vi.fn() } as never,
      releaseRepository: { releaseNextEligible },
      authorizationRepository: { getByExecutionPlanId: vi.fn().mockResolvedValue({
        runtimeAuthorizationId: "44444444-4444-4444-8444-444444444444",
        ownership: { orgId: ORG, workspaceId: WORKSPACE },
      }) } as never,
      schedulingCoordinator: { scheduleAuthorizedScene } as never,
    };
    const outcomes = await Promise.all([releaseNextEligibleScene(common), releaseNextEligibleScene(common)]);
    expect(outcomes.every((outcome) => outcome.selectedSceneExecutionId === SCENE_2)).toBe(true);
    expect(scheduleAuthorizedScene).toHaveBeenCalledTimes(2);
    expect(outcomes.filter((outcome) => outcome.newlyReleasedSceneCount === 1)).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.converged)).toHaveLength(1);
  });
});
