import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RuntimeAuthorizedFactSchema } from "@ceo-agent/shared";
import { authorizeAndExecuteExecutionPlan } from "../packages/agents/src/ai-story/authorize-and-execute-execution-plan";

const PLAN = "10000000-0000-4000-8000-000000000001";
const SCENE = "10000000-0000-4000-8000-000000000002";
const USER = "10000000-0000-4000-8000-000000000003";
const WORKSPACE = "10000000-0000-4000-8000-000000000004";
const OWNERSHIP = {
  orgId: "10000000-0000-4000-8000-000000000005",
  workspaceId: WORKSPACE,
  campaignId: "10000000-0000-4000-8000-000000000006",
  storyId: "10000000-0000-4000-8000-000000000007",
  storyVersionId: "10000000-0000-4000-8000-000000000008",
  animationPackageId: "10000000-0000-4000-8000-000000000009",
  executionPlanId: PLAN,
} as const;
const HASH = "a".repeat(64);

function runtimeFact() {
  return RuntimeAuthorizedFactSchema.parse({
    runtimeAuthorizationId: "10000000-0000-4000-8000-000000000010",
    executionPlanId: PLAN,
    runtimeAuthorizationVersion: 1,
    reviewDecisionId: "10000000-0000-4000-8000-000000000011",
    reviewHash: HASH,
    assemblyDefinitionId: "10000000-0000-4000-8000-000000000012",
    assemblyHash: HASH,
    orderedSceneExecutionIds: [SCENE],
    qcResultIds: ["10000000-0000-4000-8000-000000000013"],
    ownership: OWNERSHIP,
    authorizationContractVersion: "1",
    authorizedBy: USER,
    authorizedAt: "2026-08-22T00:00:00.000Z",
    deterministicIntegrityHash: HASH,
  });
}

function dependencies() {
  const activeTx = { authority: "active-runtime-auth-transaction" };
  const runtimeAuthorizationTransaction = vi.fn(async (operation) => operation(activeTx));
  const persistenceRepository = {
    getByExecutionPlanId: vi.fn().mockResolvedValue({ plan: { storyExecutionId: PLAN } }),
  };
  const reviewRepository = {
    getLogicalProjection: vi.fn().mockResolvedValue({
      status: "APPROVED",
      storyDecision: {
        factId: "10000000-0000-4000-8000-000000000011",
        deterministicFingerprint: HASH,
      },
    }),
  };
  const assemblyRepository = {
    getProjection: vi.fn().mockResolvedValue({
      definition: {
        assemblyDefinitionId: "10000000-0000-4000-8000-000000000012",
        deterministicFingerprint: HASH,
        orderedSceneExecutionIds: [SCENE],
      },
      prerequisites: {
        hasDefinition: true,
        membershipComplete: true,
        orderingDeterministic: true,
      },
    }),
  };
  const authorizationRepository = {
    acceptOrReturn: vi.fn().mockRejectedValue(
      new Error("SEPARATE_GLOBAL_TRANSACTION_CHECKOUT")
    ),
    acceptOrReturnInTransaction: vi.fn(async (fact, tx) => {
      expect(tx).toBe(activeTx);
      return { fact, converged: false };
    }),
  };
  const releaseRepository = {
    initialize: vi.fn().mockResolvedValue([{
      sceneExecutionId: SCENE,
      executionPlanId: PLAN,
      runtimeAuthorizationId: "10000000-0000-4000-8000-000000000010",
      workspaceId: WORKSPACE,
      sceneOrder: 1,
      releaseState: "RELEASED",
    }]),
  };
  const schedulingCoordinator = {
    scheduleAuthorizedScene: vi.fn().mockResolvedValue({ replayed: false }),
  };
  return {
    activeTx,
    runtimeAuthorizationTransaction,
    persistenceRepository,
    reviewRepository,
    assemblyRepository,
    authorizationRepository,
    releaseRepository,
    schedulingCoordinator,
  };
}

function executeInput(deps: ReturnType<typeof dependencies>) {
  return {
    executionPlanId: PLAN,
    actorUserId: USER,
    ownership: OWNERSHIP,
    router: { route: vi.fn() } as never,
    runtimeAuthorizationTransaction: deps.runtimeAuthorizationTransaction,
    persistenceRepository: deps.persistenceRepository as never,
    reviewRepository: deps.reviewRepository as never,
    assemblyRepository: deps.assemblyRepository as never,
    authorizationRepository: deps.authorizationRepository as never,
    authorizationService: {
      authorize: vi.fn(() => ({
        fact: runtimeFact(),
        converged: false,
        executionAllowed: false,
        executionLockCode: "PHASE1_EXECUTION_LOCKED",
        automaticFallbackEnabled: false,
      })),
    } as never,
    sceneReleaseRepository: deps.releaseRepository as never,
    schedulingCoordinator: deps.schedulingCoordinator as never,
    commercialAuthorizationService: {
      authorizeExecutionPlanExecute: vi.fn(),
    } as never,
    executionAuthorization: {
      allowed: true,
      accessMode: "ops",
      settlementMode: "none",
      authorizedBy: "ACTIVE_PLATFORM_ADMIN",
      policyVersion: "ai-story-exec-03.v1",
      reason: "test",
      providerCostAccounting: "ALLOWED",
    } as const,
    loadLatestQc: vi.fn().mockResolvedValue([{
      qcResultId: "10000000-0000-4000-8000-000000000013",
      sceneExecutionId: SCENE,
      status: "passed",
      resultHash: HASH,
    }]),
  };
}

describe("PROD-VERIFY-CANONICAL-EXECUTE-TIMEOUT-01", () => {
  it("has no global DB helper reachable inside RuntimeAuthorizedFact acceptance", () => {
    const source = readFileSync(join(
      process.cwd(),
      "packages/db/src/queries/ai-story-runtime-authorization.ts"
    ), "utf8");
    const transactionBody = source.slice(
      source.indexOf("export async function acceptRuntimeAuthorizationFactInTransaction"),
      source.indexOf("export class RuntimeAuthorizationPersistenceRepository")
    );
    expect(transactionBody).not.toContain("getDb(");
    expect(transactionBody).not.toContain("getWorkspaceMembership(");
    expect(transactionBody).toContain("assertExecutionPlanOwnershipChain(plan, tx)");
    expect(transactionBody).toContain(".onConflictDoNothing()");
  });

  it("uses one transaction authority through RuntimeAuthorizedFact acceptance", async () => {
    const deps = dependencies();
    const result = await authorizeAndExecuteExecutionPlan(executeInput(deps));

    expect(result.runtimeAuthorizationId).toBe("10000000-0000-4000-8000-000000000010");
    expect(deps.runtimeAuthorizationTransaction).toHaveBeenCalledTimes(1);
    expect(deps.persistenceRepository.getByExecutionPlanId).toHaveBeenCalledWith(
      PLAN,
      deps.activeTx
    );
    expect(deps.reviewRepository.getLogicalProjection).toHaveBeenCalledWith(
      PLAN,
      deps.activeTx
    );
    expect(deps.assemblyRepository.getProjection).toHaveBeenCalledWith(
      PLAN,
      deps.activeTx
    );
    expect(deps.authorizationRepository.acceptOrReturn).not.toHaveBeenCalled();
    expect(deps.authorizationRepository.acceptOrReturnInTransaction).toHaveBeenCalledTimes(1);
  });

  it("fails before release, routing, or outbox when fact persistence fails", async () => {
    const deps = dependencies();
    deps.authorizationRepository.acceptOrReturnInTransaction.mockRejectedValueOnce(
      new Error("RUNTIME_AUTH_WRITE_FAILED")
    );

    await expect(authorizeAndExecuteExecutionPlan(executeInput(deps))).rejects.toThrow(
      "RUNTIME_AUTH_WRITE_FAILED"
    );
    expect(deps.releaseRepository.initialize).not.toHaveBeenCalled();
    expect(deps.schedulingCoordinator.scheduleAuthorizedScene).not.toHaveBeenCalled();
  });
});
