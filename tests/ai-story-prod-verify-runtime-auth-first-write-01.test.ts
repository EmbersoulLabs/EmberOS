import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RuntimeAuthorizationService } from "../packages/agents/src/ai-story/runtime-authorization-service";
import { authorizeAndExecuteExecutionPlan } from "../packages/agents/src/ai-story/authorize-and-execute-execution-plan";

const PLAN = "20000000-0000-4000-8000-000000000001";
const SCENE = "20000000-0000-4000-8000-000000000002";
const USER = "20000000-0000-4000-8000-000000000003";
const WORKSPACE = "20000000-0000-4000-8000-000000000004";
const REVIEW = "20000000-0000-4000-8000-000000000005";
const ASSEMBLY = "20000000-0000-4000-8000-000000000006";
const QC = "20000000-0000-4000-8000-000000000007";
const HASH = "b".repeat(64);
const ownership = {
  orgId: "20000000-0000-4000-8000-000000000008",
  workspaceId: WORKSPACE,
  campaignId: "20000000-0000-4000-8000-000000000009",
  storyId: "20000000-0000-4000-8000-000000000010",
  storyVersionId: "20000000-0000-4000-8000-000000000011",
  animationPackageId: "20000000-0000-4000-8000-000000000012",
  executionPlanId: PLAN,
} as const;

function harness() {
  const activeTx = { authority: "max-one-active-transaction" };
  let acceptedFact: any = null;
  let factCount = 0;
  let boundaryTimings: Record<string, number> | null = null;
  const transaction = vi.fn(async (operation) => operation(activeTx));
  const snapshotRepository = {
    loadCanonicalSnapshotInTransaction: vi.fn(async (_planId, tx) => {
      expect(tx).toBe(activeTx);
      return {
        executionPlanId: PLAN,
        ownership,
        reviewStatus: "APPROVED",
        storyDecision: {
          factId: REVIEW,
          deterministicFingerprint: HASH,
        },
        assemblyDefinition: {
          assemblyDefinitionId: ASSEMBLY,
          deterministicFingerprint: HASH,
          orderedSceneExecutionIds: [SCENE],
        },
        assemblyMemberships: [],
        orderedSceneExecutionIds: [SCENE],
        membershipComplete: true,
        orderingDeterministic: true,
        qcResults: [{
          qcResultId: QC,
          sceneExecutionId: SCENE,
          status: "passed",
          resultHash: HASH,
        }],
        existingFact: acceptedFact,
        transactionAuthority: tx,
        authority: Symbol.for("test-snapshot"),
      };
    }),
    acceptOrReturnCanonicalSnapshotInTransaction: vi.fn(async (fact, _snapshot, tx) => {
      expect(tx).toBe(activeTx);
      if (acceptedFact) return { fact: acceptedFact, converged: true };
      acceptedFact = fact;
      factCount += 1;
      return { fact, converged: false };
    }),
  };
  const release = {
    initialize: vi.fn(async ({ runtimeAuthorizationId }) => [{
      sceneExecutionId: SCENE,
      executionPlanId: PLAN,
      runtimeAuthorizationId,
      workspaceId: WORKSPACE,
      sceneOrder: 1,
      releaseState: "RELEASED",
    }]),
  };
  const scheduling = {
    scheduleAuthorizedScene: vi.fn().mockResolvedValue({ replayed: true }),
  };
  const commercial = { authorizeExecutionPlanExecute: vi.fn() };
  const unusedRepository = {} as never;
  const input = {
    executionPlanId: PLAN,
    actorUserId: USER,
    ownership,
    router: { route: vi.fn() } as never,
    runtimeAuthorizationTransaction: transaction,
    runtimeAuthorizationSnapshotRepository: snapshotRepository as never,
    persistenceRepository: unusedRepository,
    reviewRepository: unusedRepository,
    assemblyRepository: unusedRepository,
    authorizationRepository: unusedRepository,
    authorizationService: new RuntimeAuthorizationService(),
    sceneReleaseRepository: release as never,
    schedulingCoordinator: scheduling as never,
    commercialAuthorizationService: commercial as never,
    now: () => new Date("2026-08-22T00:00:00.000Z"),
    executionAuthorization: {
      allowed: true,
      accessMode: "ops",
      settlementMode: "none",
      authorizedBy: "ACTIVE_PLATFORM_ADMIN",
      policyVersion: "ai-story-exec-03.v1",
      reason: "first-write-regression",
      providerCostAccounting: "ALLOWED",
    } as const,
    observeRuntimeAuthorizationBoundary: (value) => {
      boundaryTimings = value;
    },
  };
  return {
    input,
    transaction,
    snapshotRepository,
    release,
    scheduling,
    commercial,
    getFactCount: () => factCount,
    getBoundaryTimings: () => boundaryTimings,
  };
}

describe("PROD-VERIFY-RUNTIME-AUTH-FIRST-WRITE-01", () => {
  it("first-writes one fact with one max-one transaction authority", async () => {
    const test = harness();
    const result = await authorizeAndExecuteExecutionPlan(test.input);
    expect(result.runtimeAuthorizationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(test.getFactCount()).toBe(1);
    expect(test.transaction).toHaveBeenCalledTimes(1);
    expect(test.snapshotRepository.loadCanonicalSnapshotInTransaction).toHaveBeenCalledTimes(1);
    expect(test.snapshotRepository.acceptOrReturnCanonicalSnapshotInTransaction).toHaveBeenCalledTimes(1);
    expect(test.commercial.authorizeExecutionPlanExecute).not.toHaveBeenCalled();
    expect(test.getBoundaryTimings()).toMatchObject({
      connectionAcquireCount: 1,
      transactionCount: 1,
      secondCheckoutAttempts: 0,
    });
  });

  it("returns the existing fact on replay without creating a duplicate", async () => {
    const test = harness();
    const first = await authorizeAndExecuteExecutionPlan(test.input);
    const replay = await authorizeAndExecuteExecutionPlan(test.input);
    expect(replay.runtimeAuthorizationId).toBe(first.runtimeAuthorizationId);
    expect(test.getFactCount()).toBe(1);
    expect(test.transaction).toHaveBeenCalledTimes(2);
  });

  it("fails before release and scheduling when the first insert fails", async () => {
    const test = harness();
    test.snapshotRepository.acceptOrReturnCanonicalSnapshotInTransaction.mockRejectedValueOnce(
      new Error("FIRST_RUNTIME_FACT_INSERT_FAILED")
    );
    await expect(authorizeAndExecuteExecutionPlan(test.input)).rejects.toThrow(
      "FIRST_RUNTIME_FACT_INSERT_FAILED"
    );
    expect(test.release.initialize).not.toHaveBeenCalled();
    expect(test.scheduling.scheduleAuthorizedScene).not.toHaveBeenCalled();
  });

  it("denies a forged non-ops settlement-none decision before DB work", async () => {
    const test = harness();
    await expect(authorizeAndExecuteExecutionPlan({
      ...test.input,
      executionAuthorization: {
        ...test.input.executionAuthorization,
        accessMode: "commercial",
      },
    })).rejects.toMatchObject({ code: "AI_STORY_EXECUTION_DENIED" });
    expect(test.transaction).not.toHaveBeenCalled();
  });

  it("uses the compact snapshot path instead of rich repeated projections", () => {
    const source = readFileSync(join(
      process.cwd(),
      "packages/agents/src/ai-story/authorize-and-execute-execution-plan.ts"
    ), "utf8");
    expect(source).toContain("loadCanonicalSnapshotInTransaction");
    expect(source).toContain("acceptOrReturnCanonicalSnapshotInTransaction");
    const optimizedBranch = source.slice(
      source.indexOf("if (useCanonicalSnapshot && dbAuthority)"),
      source.indexOf("    } else {", source.indexOf("if (useCanonicalSnapshot && dbAuthority)"))
    );
    expect(optimizedBranch).not.toContain("getLogicalProjection");
    expect(optimizedBranch).not.toContain("getProjection(");
    expect(optimizedBranch).not.toContain("getByExecutionPlanId");
  });
});
