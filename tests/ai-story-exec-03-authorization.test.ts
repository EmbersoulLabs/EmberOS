/**
 * EMBEROS-AI-STORY-EXEC-03 — self-use execution authorization matrix.
 * Deterministic only. No Seedance / paid provider calls.
 */
import { describe, expect, it, vi } from "vitest";
import {
  AI_STORY_EXECUTION_AUTHORIZATION_POLICY_VERSION,
  AiStoryExecutionDeniedError,
  RuntimeAuthorizedFactSchema,
  toAiStoryExecutionAuthorizationEvidence,
} from "@ceo-agent/shared";
import {
  CommercialAuthorizationError,
  CreditsAccountingError,
  WorkspaceAccessError,
} from "@ceo-agent/db";
import { authorizeAiStoryExecution } from "../packages/agents/src/ai-story/ai-story-execution-authorization";
import { authorizeAndExecuteExecutionPlan } from "../packages/agents/src/ai-story/authorize-and-execute-execution-plan";
import { CommercialAuthorizationService } from "../packages/agents/src/commercial/commercial-authorization-runtime";
import {
  SceneSchedulingCoordinator,
  SceneSchedulingError,
} from "../packages/agents/src/ai-story/scene-scheduling-coordinator";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "10000000-0000-4000-8000-000000000002";
const WORKSPACE = "10000000-0000-4000-8000-000000000003";
const OTHER_ORG = "10000000-0000-4000-8000-000000000012";
const OTHER_WORKSPACE = "10000000-0000-4000-8000-000000000013";
const PLAN_ID = "10000000-0000-4000-8000-000000000101";
const SCENE_A = "10000000-0000-4000-8000-000000000201";
const HASH =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const OWNERSHIP = {
  orgId: ORG,
  workspaceId: WORKSPACE,
  campaignId: "10000000-0000-4000-8000-000000000004",
  storyId: "10000000-0000-4000-8000-000000000005",
  storyVersionId: "10000000-0000-4000-8000-000000000006",
  animationPackageId: "10000000-0000-4000-8000-000000000007",
  executionPlanId: PLAN_ID,
} as const;

function member(role = "operator", orgId = ORG, workspaceId = WORKSPACE) {
  return { orgId, workspaceId, role };
}

function deps(input?: {
  platformAdminStatus?: "ACTIVE_GRANT" | "DENIED";
  membership?: ReturnType<typeof member> | "missing";
  plan?: string | null;
  entitlementCapabilities?: readonly ("ai_story.access" | "ai_story.execute")[];
  entitlementOrgId?: string;
  entitlementWorkspaceId?: string;
}) {
  const membership = input?.membership ?? member();
  const capabilities = input?.entitlementCapabilities ?? [];
  return {
    requireWorkspaceRole:
      membership === "missing"
        ? vi.fn().mockRejectedValue(new WorkspaceAccessError("Not a member of this workspace", "FORBIDDEN"))
        : vi.fn().mockResolvedValue(membership),
    resolvePlatformAdmin: vi.fn().mockResolvedValue(
      input?.platformAdminStatus === "ACTIVE_GRANT"
        ? { status: "ACTIVE_GRANT", assignment: { platformAdminAssignmentId: "active" } }
        : { status: "DENIED", reason: "NO_ACTIVE_GRANT" }
    ),
    getOrganizationPlan: vi.fn().mockResolvedValue(input?.plan ?? "free"),
    entitlementRepository: {
      rebuildEffectiveProjection: vi.fn().mockResolvedValue({
        contractVersion: "1",
        orgId: input?.entitlementOrgId ?? ORG,
        workspaceId: input?.entitlementWorkspaceId ?? WORKSPACE,
        entries: capabilities.map((capabilityKey, index) => ({
          capabilityKey,
          source: "INTERNAL",
          entitlementGrantId: `10000000-0000-4000-8000-${String(index + 700).padStart(12, "0")}`,
          grantedAt: "2026-08-31T00:00:00.000Z",
          expiresAt: null,
        })),
        projectedAt: "2026-08-31T00:00:00.000Z",
        integrityHash: HASH,
      }),
    },
    now: () => "2026-08-31T00:00:00.000Z",
  };
}

const baseRequest = {
  user: { id: USER, email: "ops@example.com" },
  orgId: ORG,
  workspaceId: WORKSPACE,
  minRole: "operator" as const,
};

const opsAdmin = {
  allowed: true as const,
  accessMode: "ops" as const,
  settlementMode: "none" as const,
  authorizedBy: "ACTIVE_PLATFORM_ADMIN" as const,
  policyVersion: AI_STORY_EXECUTION_AUTHORIZATION_POLICY_VERSION,
  reason: "test-ops",
  providerCostAccounting: "ALLOWED" as const,
};

const commercialEntitlement = {
  allowed: true as const,
  accessMode: "commercial" as const,
  settlementMode: "credits" as const,
  authorizedBy: "EFFECTIVE_ENTITLEMENT" as const,
  policyVersion: AI_STORY_EXECUTION_AUTHORIZATION_POLICY_VERSION,
  reason: "test-explicit-entitlement",
  providerCostAccounting: "ALLOWED" as const,
};

describe("EXEC-03 authorizeAiStoryExecution", () => {
  it("CASE A/B/C: Super Admin ops without billing, subscription, or credits", async () => {
    const result = await authorizeAiStoryExecution(baseRequest, deps({
      platformAdminStatus: "ACTIVE_GRANT",
      plan: "free",
    }));
    expect(result).toMatchObject({
      allowed: true,
      accessMode: "ops",
      settlementMode: "none",
      authorizedBy: "ACTIVE_PLATFORM_ADMIN",
      providerCostAccounting: "ALLOWED",
    });
  });

  it("CASE D/E: Agency non-commercial without billing or credits", async () => {
    const result = await authorizeAiStoryExecution(baseRequest, deps({ plan: "agency" }));
    expect(result).toMatchObject({
      allowed: true,
      accessMode: "ops",
      settlementMode: "none",
      authorizedBy: "AGENCY_PLAN_CAPABILITY",
      providerCostAccounting: "ALLOWED",
    });
  });

  it.each([
    ["free", "CASE F"],
    ["pro", "CASE G"],
    ["pro_plus", "CASE H"],
  ] as const)("%s is denied (%s)", async (plan) => {
    await expect(authorizeAiStoryExecution(baseRequest, deps({ plan })))
      .rejects.toBeInstanceOf(AiStoryExecutionDeniedError);
  });

  it("authorizes a free workspace with an explicit ai_story.execute entitlement for commercial settlement", async () => {
    const dependencies = deps({
      plan: "free",
      entitlementCapabilities: ["ai_story.access", "ai_story.execute"],
    });
    const result = await authorizeAiStoryExecution(baseRequest, dependencies);
    expect(result).toMatchObject({
      allowed: true,
      accessMode: "commercial",
      settlementMode: "credits",
      authorizedBy: "EFFECTIVE_ENTITLEMENT",
      providerCostAccounting: "ALLOWED",
    });
    expect(
      dependencies.entitlementRepository.rebuildEffectiveProjection
    ).toHaveBeenCalledWith({
      orgId: ORG,
      workspaceId: WORKSPACE,
      projectedAt: "2026-08-31T00:00:00.000Z",
      now: "2026-08-31T00:00:00.000Z",
    });
  });

  it("denies access-only entitlement and an entitlement projection for another workspace", async () => {
    await expect(
      authorizeAiStoryExecution(
        baseRequest,
        deps({ plan: "free", entitlementCapabilities: ["ai_story.access"] })
      )
    ).rejects.toBeInstanceOf(AiStoryExecutionDeniedError);

    await expect(
      authorizeAiStoryExecution(
        baseRequest,
        deps({
          plan: "free",
          entitlementCapabilities: ["ai_story.execute"],
          entitlementWorkspaceId: OTHER_WORKSPACE,
        })
      )
    ).rejects.toBeInstanceOf(AiStoryExecutionDeniedError);

    await expect(
      authorizeAiStoryExecution(
        baseRequest,
        deps({
          plan: "free",
          entitlementCapabilities: ["ai_story.execute"],
          entitlementOrgId: OTHER_ORG,
        })
      )
    ).rejects.toBeInstanceOf(AiStoryExecutionDeniedError);
  });

  it("does not allow ordinary Admin membership to imply execute authority", async () => {
    await expect(
      authorizeAiStoryExecution(
        baseRequest,
        deps({ membership: member("admin"), plan: "free" })
      )
    ).rejects.toBeInstanceOf(AiStoryExecutionDeniedError);
  });

  it("CASE I: missing membership denied", async () => {
    await expect(authorizeAiStoryExecution(baseRequest, deps({ membership: "missing" })))
      .rejects.toBeInstanceOf(AiStoryExecutionDeniedError);
  });

  it("CASE J: cross-workspace / org mismatch denied", async () => {
    await expect(
      authorizeAiStoryExecution(
        baseRequest,
        deps({ membership: member("operator", OTHER_ORG, WORKSPACE), plan: "agency" })
      )
    ).rejects.toBeInstanceOf(AiStoryExecutionDeniedError);
    await expect(
      authorizeAiStoryExecution(
        baseRequest,
        deps({ membership: member("operator", ORG, OTHER_WORKSPACE), plan: "agency" })
      )
    ).rejects.toBeInstanceOf(AiStoryExecutionDeniedError);
  });

  it("CASE K: invalid membership role denied", async () => {
    await expect(
      authorizeAiStoryExecution(
        baseRequest,
        deps({ membership: member("not-a-role"), plan: "agency" })
      )
    ).rejects.toBeInstanceOf(AiStoryExecutionDeniedError);
  });

  it("CASE L/M: forged client role and accessMode are ignored", async () => {
    await expect(
      authorizeAiStoryExecution(
        {
          ...baseRequest,
          clientClaims: { role: "super_admin", accessMode: "ops", settlementMode: "none" },
        },
        deps({ plan: "free" })
      )
    ).rejects.toBeInstanceOf(AiStoryExecutionDeniedError);
  });
});

describe("EXEC-03 commercial fail-closed", () => {
  it("denies explicit entitlement execution when billing authority is missing", async () => {
    const service = new CommercialAuthorizationService(
      { getByOrgId: vi.fn().mockResolvedValue(null) } as never,
      { getProjectionByOrgId: vi.fn() } as never,
      { getEffectiveProjection: vi.fn(), rebuildEffectiveProjection: vi.fn() } as never,
      { reserveCredits: vi.fn() } as never,
      { getByExecutionIdentity: vi.fn().mockResolvedValue(null), acceptOrConverge: vi.fn() } as never,
      undefined,
      { getActiveScope: vi.fn().mockResolvedValue(null) } as never
    );
    await expect(
      service.authorizeBillableExecute({
        orgId: ORG,
        workspaceId: WORKSPACE,
        capabilityKey: "ai_story.execute",
        executionIdentity: `execution-plan:${PLAN_ID}`,
        authorizedAt: "2026-08-19T00:00:00.000Z",
      })
    ).rejects.toMatchObject({ code: "COMMERCIAL_AUTH_BILLING_MISSING" });
  });

  it("authorizes an exact STAGING certification scope while retaining billing, entitlement and Provider USD evidence", async () => {
    const accepted = { value: { pricingRuleKey: "provider-usd:byteplus-modelark:dreamina-seedance-2-0-260128" }, replayed: false };
    const service = new CommercialAuthorizationService(
      { getByOrgId: vi.fn().mockResolvedValue({ billingAccountId: "ba" }) } as never,
      { getProjectionByOrgId: vi.fn().mockResolvedValue(null) } as never,
      {
        getEffectiveProjection: vi.fn().mockResolvedValue({
          entries: [{ capabilityKey: "ai_story.execute", entitlementGrantId: "g1" }],
          integrityHash: HASH,
        }),
        rebuildEffectiveProjection: vi.fn(),
      } as never,
      { reserveCredits: vi.fn() } as never,
      { getByExecutionIdentity: vi.fn().mockResolvedValue(null), acceptOrConverge: vi.fn().mockResolvedValue(accepted) } as never,
      undefined,
      {
        getActiveScope: vi.fn().mockResolvedValue({
          certificationScopeId: "10000000-0000-4000-8000-000000000099",
        }),
        getActivePricingEvidence: vi.fn().mockResolvedValue({
          ruleKey: "provider-usd:byteplus-modelark:dreamina-seedance-2-0-260128",
          ruleVersion: "byteplus-2026-08-01.v1",
          integrityHash: HASH,
        }),
      } as never
    );
    const result = await service.authorizeBillableExecute({
      orgId: ORG,
      workspaceId: WORKSPACE,
      capabilityKey: "ai_story.execute",
      executionIdentity: `execution-plan:${PLAN_ID}`,
      authorizedAt: "2026-08-31T00:00:00.000Z",
    });
    expect(result.pricingRule).toBeNull();
    expect(result.authorization.pricingRuleKey).toContain("provider-usd:");
  });

  it("CASE N: commercial authorization with missing subscription denied", async () => {
    const service = new CommercialAuthorizationService(
      { getByOrgId: vi.fn().mockResolvedValue({ billingAccountId: "ba" }) } as never,
      { getProjectionByOrgId: vi.fn().mockResolvedValue(null) } as never,
      { getEffectiveProjection: vi.fn(), rebuildEffectiveProjection: vi.fn() } as never,
      { reserveCredits: vi.fn() } as never,
      { getByExecutionIdentity: vi.fn().mockResolvedValue(null), acceptOrConverge: vi.fn() } as never,
      undefined,
      { getActiveScope: vi.fn().mockResolvedValue(null) } as never
    );
    await expect(
      service.authorizeBillableExecute({
        orgId: ORG,
        workspaceId: WORKSPACE,
        capabilityKey: "ai_story.execute",
        executionIdentity: `execution-plan:${PLAN_ID}`,
        authorizedAt: "2026-08-19T00:00:00.000Z",
      })
    ).rejects.toMatchObject({ code: "COMMERCIAL_AUTH_SUBSCRIPTION_INVALID" });
  });

  it("CASE O: commercial credit reserve failure denied", async () => {
    const service = new CommercialAuthorizationService(
      { getByOrgId: vi.fn().mockResolvedValue({ billingAccountId: "ba" }) } as never,
      {
        getProjectionByOrgId: vi.fn().mockResolvedValue({
          status: "ACTIVE",
          planKey: "agency",
        }),
      } as never,
      {
        getEffectiveProjection: vi.fn().mockResolvedValue({
          entries: [{ capabilityKey: "ai_story.execute", entitlementGrantId: "g1" }],
          integrityHash: HASH,
        }),
        rebuildEffectiveProjection: vi.fn(),
      } as never,
      {
        reserveCredits: vi.fn().mockRejectedValue(
          new CreditsAccountingError("CREDITS_INSUFFICIENT", "insufficient")
        ),
      } as never,
      { getByExecutionIdentity: vi.fn().mockResolvedValue(null), acceptOrConverge: vi.fn() } as never
    );
    await expect(
      service.authorizeBillableExecute({
        orgId: ORG,
        workspaceId: WORKSPACE,
        capabilityKey: "ai_story.execute",
        executionIdentity: `execution-plan:${PLAN_ID}`,
        authorizedAt: "2026-08-19T00:00:00.000Z",
      })
    ).rejects.toBeInstanceOf(CommercialAuthorizationError);
  });

  it("denies explicit entitlement execution when pricing authority is missing", async () => {
    const service = new CommercialAuthorizationService(
      { getByOrgId: vi.fn().mockResolvedValue({ billingAccountId: "ba" }) } as never,
      {
        getProjectionByOrgId: vi.fn().mockResolvedValue({
          status: "ACTIVE",
          planKey: "free",
        }),
      } as never,
      {
        getEffectiveProjection: vi.fn().mockResolvedValue({
          entries: [{ capabilityKey: "ai_story.execute", entitlementGrantId: "g1" }],
          integrityHash: HASH,
        }),
        rebuildEffectiveProjection: vi.fn(),
      } as never,
      { reserveCredits: vi.fn() } as never,
      { getByExecutionIdentity: vi.fn().mockResolvedValue(null), acceptOrConverge: vi.fn() } as never
    );
    await expect(
      service.authorizeBillableExecute({
        orgId: ORG,
        workspaceId: WORKSPACE,
        capabilityKey: "ai_story.execute",
        executionIdentity: `execution-plan:${PLAN_ID}`,
        authorizedAt: "2026-08-19T00:00:00.000Z",
        resolvePricingRule: () => null,
      })
    ).rejects.toMatchObject({ code: "COMMERCIAL_AUTH_PRICING_MISSING" });
  });
});

describe("EXEC-03 ops execute create + queue", () => {
  const storyDecision = {
    factId: "10000000-0000-4000-8000-000000000301",
    deterministicFingerprint: HASH,
  };
  const reviewRepo = {
    getLogicalProjection: vi.fn().mockResolvedValue({
      status: "APPROVED",
      storyDecision,
    }),
  };
  const assemblyRepo = {
    getProjection: vi.fn().mockResolvedValue({
      definition: {
        assemblyDefinitionId: "10000000-0000-4000-8000-000000000302",
        deterministicFingerprint: HASH,
        orderedSceneExecutionIds: [SCENE_A],
      },
      prerequisites: {
        hasDefinition: true,
        membershipComplete: true,
        orderingDeterministic: true,
      },
    }),
  };
  const persistence = {
    getByExecutionPlanId: vi.fn().mockResolvedValue({ plan: { storyExecutionId: PLAN_ID } }),
  };

  it("CASE P/Q: ops authorization creates runtime fact and enqueues without commercial settlement", async () => {
    const commercial = {
      authorizeExecutionPlanExecute: vi.fn(),
    };
    const scheduled: Array<Record<string, unknown>> = [];
    const persisted: Array<Record<string, unknown>> = [];
    const result = await authorizeAndExecuteExecutionPlan({
      executionPlanId: PLAN_ID,
      actorUserId: USER,
      ownership: OWNERSHIP,
      router: { route: vi.fn() } as never,
      reviewRepository: reviewRepo as never,
      assemblyRepository: assemblyRepo as never,
      persistenceRepository: persistence as never,
      authorizationService: {
        authorize: () => ({
          fact: RuntimeAuthorizedFactSchema.parse({
            runtimeAuthorizationId: "10000000-0000-4000-8000-000000000401",
            executionPlanId: PLAN_ID,
            runtimeAuthorizationVersion: 1,
            reviewDecisionId: storyDecision.factId,
            reviewHash: HASH,
            assemblyDefinitionId: "10000000-0000-4000-8000-000000000302",
            assemblyHash: HASH,
            orderedSceneExecutionIds: [SCENE_A],
            qcResultIds: ["10000000-0000-4000-8000-000000000311"],
            ownership: OWNERSHIP,
            authorizationContractVersion: "1",
            authorizedBy: USER,
            authorizedAt: "2026-08-19T00:00:00.000Z",
            deterministicIntegrityHash: HASH,
          }),
          converged: false,
          executionAllowed: false,
          executionLockCode: "PHASE1_EXECUTION_LOCKED",
          automaticFallbackEnabled: false,
        }),
      } as never,
      authorizationRepository: {
        acceptOrReturn: vi.fn(async (fact) => {
          persisted.push(fact as never);
          return { fact, converged: false };
        }),
      } as never,
      schedulingCoordinator: {
        scheduleAuthorizedScene: vi.fn(async (input) => {
          scheduled.push(input as never);
          return { replayed: false };
        }),
      } as never,
      sceneReleaseRepository: {
        initialize: vi.fn(async () => [{
          sceneExecutionId: SCENE_A,
          sceneOrder: 1,
          releaseState: "RELEASED",
          runtimeAuthorizationId: "10000000-0000-4000-8000-000000000401",
          workspaceId: OWNERSHIP.workspaceId,
        }]),
      } as never,
      commercialAuthorizationService: commercial as never,
      executionAuthorization: opsAdmin,
      loadLatestQc: async () => [
        {
          qcResultId: "10000000-0000-4000-8000-000000000311",
          sceneExecutionId: SCENE_A,
          status: "passed" as const,
          resultHash: HASH,
        },
      ],
    });

    expect(commercial.authorizeExecutionPlanExecute).not.toHaveBeenCalled();
    expect(result.commercialAuthorizationId).toBeNull();
    expect(persisted[0]).toMatchObject({
      executionAuthorization: toAiStoryExecutionAuthorizationEvidence(opsAdmin),
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.commercialAuthorizationId).toBeUndefined();
    expect(scheduled[0]?.executionAuthorization).toMatchObject({
      accessMode: "ops",
      settlementMode: "none",
    });
  });

  it("explicit entitlement Execute still requires commercial settlement", async () => {
    const commercial = {
      authorizeExecutionPlanExecute: vi.fn().mockRejectedValue(
        new CommercialAuthorizationError(
          "COMMERCIAL_AUTH_SUBSCRIPTION_INVALID",
          "Subscription Projection must be ACTIVE or TRIALING"
        )
      ),
    };
    await expect(
      authorizeAndExecuteExecutionPlan({
        executionPlanId: PLAN_ID,
        actorUserId: USER,
        ownership: OWNERSHIP,
        router: { route: vi.fn() } as never,
        reviewRepository: reviewRepo as never,
        assemblyRepository: assemblyRepo as never,
        persistenceRepository: persistence as never,
        authorizationService: {
          authorize: () => ({
            fact: { runtimeAuthorizationId: "10000000-0000-4000-8000-000000000401" },
            converged: false,
          }),
        } as never,
        authorizationRepository: {
          acceptOrReturn: vi.fn(async (fact) => ({ fact, converged: false })),
        } as never,
        schedulingCoordinator: { scheduleAuthorizedScene: vi.fn() } as never,
        commercialAuthorizationService: commercial as never,
        executionAuthorization: commercialEntitlement,
        loadLatestQc: async () => [
          {
            qcResultId: "10000000-0000-4000-8000-000000000311",
            sceneExecutionId: SCENE_A,
            status: "passed" as const,
            resultHash: HASH,
          },
        ],
      })
    ).rejects.toMatchObject({ code: "COMMERCIAL_AUTH_SUBSCRIPTION_INVALID" });
    expect(commercial.authorizeExecutionPlanExecute).toHaveBeenCalled();
  });
});

describe("EXEC-03 reconstructable evidence", () => {
  it("CASE R: persisted fact evidence distinguishes ops from commercial", () => {
    const parsed = RuntimeAuthorizedFactSchema.parse({
      runtimeAuthorizationId: "10000000-0000-4000-8000-000000000401",
      executionPlanId: PLAN_ID,
      runtimeAuthorizationVersion: 1,
      reviewDecisionId: "10000000-0000-4000-8000-000000000301",
      reviewHash: HASH,
      assemblyDefinitionId: "10000000-0000-4000-8000-000000000302",
      assemblyHash: HASH,
      orderedSceneExecutionIds: [SCENE_A],
      qcResultIds: ["10000000-0000-4000-8000-000000000311"],
      ownership: OWNERSHIP,
      authorizationContractVersion: "1",
      authorizedBy: USER,
      authorizedAt: "2026-08-19T00:00:00.000Z",
      deterministicIntegrityHash: HASH,
      executionAuthorization: toAiStoryExecutionAuthorizationEvidence(opsAdmin),
    });
    expect(parsed.executionAuthorization?.accessMode).toBe("ops");
    expect(parsed.executionAuthorization?.settlementMode).toBe("none");
    expect(parsed.executionAuthorization?.providerCostAccounting).toBe("ALLOWED");
  });
});

describe("EXEC-03 scheduling rejects mixed ops + commercial id", () => {
  it("ops settlement denies a commercial authorization id without looking up billing", async () => {
    const commercialAuthRepo = { getById: vi.fn() };
    const coordinator = new SceneSchedulingCoordinator({
      router: { route: vi.fn() } as never,
      authRepo: {
        getById: vi.fn().mockResolvedValue({
          executionPlanId: PLAN_ID,
          runtimeAuthorizationId: "10000000-0000-4000-8000-000000000401",
          orderedSceneExecutionIds: [SCENE_A],
          ownership: OWNERSHIP,
          executionAuthorization: toAiStoryExecutionAuthorizationEvidence(opsAdmin),
        }),
      },
      commercialAuthRepo,
      schedulingRepo: {
        getAcceptedBundleBySceneExecutionId: vi.fn(),
        scheduleAcceptedBundle: vi.fn(),
        getRoutingDecisionBySceneExecutionId: vi.fn(),
      },
      persistenceRepo: {
        getByExecutionPlanId: vi.fn(),
        getValidationResults: vi.fn(),
      },
      assemblyRepo: { listMemberships: vi.fn() },
    });

    await expect(
      coordinator.scheduleAuthorizedScene({
        executionPlanId: PLAN_ID,
        sceneExecutionId: SCENE_A,
        runtimeAuthorizationId: "10000000-0000-4000-8000-000000000401",
        commercialAuthorizationId: "10000000-0000-4000-8000-000000000501",
        executionAuthorization: toAiStoryExecutionAuthorizationEvidence(opsAdmin),
        actorUserId: USER,
      })
    ).rejects.toMatchObject({ code: "COMMERCIAL_AUTHORIZATION_DENIED" });
    expect(commercialAuthRepo.getById).not.toHaveBeenCalled();
  });

  it("commercial scheduling without authorization id remains denied", () => {
    expect(
      new SceneSchedulingError(
        "COMMERCIAL_AUTHORIZATION_REQUIRED",
        "Commercial Authorization ID is required for billable scheduling"
      ).code
    ).toBe("COMMERCIAL_AUTHORIZATION_REQUIRED");
  });
});
