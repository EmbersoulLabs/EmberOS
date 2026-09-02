/**
 * EMBEROS-AI-STORY-EXEC-04 — generated Scene review / retry.
 * Deterministic only. No Seedance / MiniMax / paid provider calls.
 */
import { describe, expect, it, vi } from "vitest";
import {
  nextProviderAttemptNumber,
  redactGeneratedSceneReviewError,
  rejectForgedGeneratedSceneReviewBody,
  resolveAiStorySceneMaxAttempts,
  selectAssemblyAuthoritativeSceneResults,
} from "@ceo-agent/shared";
import { buildCanonicalSceneProviderRequest } from "../packages/agents/src/ai-story/canonical-scene-provider-request";
import { deriveSceneCompleteReadiness } from "../packages/agents/src/ai-story/ai-story-runtime-continuation-coordinator";
import { authorizeAiStoryExecution } from "../packages/agents/src/ai-story/ai-story-execution-authorization";
import {
  GeneratedSceneReviewError,
  snapshotHasInFlightProviderExecution,
} from "../packages/db/src/queries/ai-story-generated-scene-review";
import { GeneratedSceneReviewService } from "../packages/agents/src/ai-story/generated-scene-review-service";
import { WorkspaceAccessError } from "@ceo-agent/db";

const STORY = "10000000-0000-4000-8000-000000000005";
const SCENE_EXEC = "10000000-0000-4000-8000-000000000201";
const SCENE_RESULT_1 = "10000000-0000-4000-8000-000000000301";
const SCENE_RESULT_2 = "10000000-0000-4000-8000-000000000302";
const PLAN = "10000000-0000-4000-8000-000000000101";
const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "10000000-0000-4000-8000-000000000002";
const WORKSPACE = "10000000-0000-4000-8000-000000000003";
const HASH =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REVIEW_ID = "10000000-0000-4000-8000-000000000801";
const RETRY_REVISION_ID = "10000000-0000-4000-8000-000000000901";
const RETRY_AUTHORIZATION_ID = "10000000-0000-4000-8000-000000000902";

function sceneResult(id: string, status: "SUCCEEDED" | "FAILED" = "SUCCEEDED") {
  return {
    sceneResultId: id,
    executionPlanId: PLAN,
    sceneRuntimeId: "10000000-0000-4000-8000-000000000401",
    sceneExecutionId: SCENE_EXEC,
    sceneId: "scene-a",
    sceneOrder: 0,
    ownership: {
      orgId: ORG,
      workspaceId: WORKSPACE,
      campaignId: "10000000-0000-4000-8000-000000000004",
      storyId: STORY,
      storyVersionId: "10000000-0000-4000-8000-000000000006",
      animationPackageId: "10000000-0000-4000-8000-000000000007",
      executionPlanId: PLAN,
    },
    status,
    failureClassification: null,
    mediaReference:
      status === "SUCCEEDED"
        ? { uri: "memory://approved", contentHash: HASH, mediaType: "video/mp4" }
        : null,
    durationMs: status === "SUCCEEDED" ? 1000 : null,
    acceptedAt: "2026-08-19T00:00:00.000Z",
    integrityHash: HASH,
    contractVersion: "1" as const,
  };
}

describe("EXEC-04 review contract", () => {
  it("excludes a superseded pre-dispatch correlation from the in-flight gate", () => {
    const sourceCorrelationId = "10000000-0000-4000-8000-000000000711";
    expect(snapshotHasInFlightProviderExecution({
      correlations: [{
        correlationId: sourceCorrelationId,
        providerExecutionId: "execution-superseded",
      }],
      supersededCorrelationIds: new Set([sourceCorrelationId]),
      providerExecutions: new Map(),
    } as never)).toBe(false);
  });

  it("uses canonical terminal Worker evidence when the execution row is still PENDING", () => {
    expect(snapshotHasInFlightProviderExecution({
      correlations: [{
        correlationId: "10000000-0000-4000-8000-000000000712",
        providerExecutionId: "execution-terminal-worker",
      }],
      supersededCorrelationIds: new Set(),
      terminalWorkerExecutionIds: new Set(["execution-terminal-worker"]),
      providerExecutions: new Map([
        ["execution-terminal-worker", { status: "PENDING" }],
      ]),
    } as never)).toBe(false);
  });

  it("uses exact terminal NOT_ACCEPTED Worker evidence when the execution row is still PENDING", () => {
    expect(snapshotHasInFlightProviderExecution({
      correlations: [{
        correlationId: "10000000-0000-4000-8000-000000000713",
        providerExecutionId: "execution-not-accepted",
      }],
      supersededCorrelationIds: new Set(),
      terminalWorkerExecutionIds: new Set(["execution-not-accepted"]),
      providerExecutions: new Map([
        ["execution-not-accepted", { status: "PENDING" }],
      ]),
    } as never)).toBe(false);
  });

  it("A: assembly authority binds the approved attempt only", () => {
    const approved = selectAssemblyAuthoritativeSceneResults({
      sceneResults: [sceneResult(SCENE_RESULT_1), sceneResult(SCENE_RESULT_2)],
      approvedSceneResultIds: new Set([SCENE_RESULT_2]),
    });
    expect(approved).toHaveLength(1);
    expect(approved[0]?.sceneResultId).toBe(SCENE_RESULT_2);
  });

  it("N: rejected old attempt is not assembled", () => {
    const ready = deriveSceneCompleteReadiness({
      definition: {
        assemblyDefinitionId: "10000000-0000-4000-8000-000000000501",
        executionPlanId: PLAN,
        orderedSceneExecutionIds: [SCENE_EXEC],
        orderedSceneIds: ["scene-a"],
        membershipComplete: true,
        orderingDeterministic: true,
        fingerprint: HASH,
        contractVersion: "1",
      } as never,
      memberships: [
        {
          assemblyDefinitionId: "10000000-0000-4000-8000-000000000501",
          sceneExecutionId: SCENE_EXEC,
          sceneId: "scene-a",
          sceneOrder: 0,
        },
      ] as never,
      sceneResults: [sceneResult(SCENE_RESULT_2)],
    });
    expect(ready.ready).toBe(true);
    expect(ready.orderedSceneResultIds).toEqual([SCENE_RESULT_2]);
  });

  it("B/C: frozen payload hash is preserved across retry identity", () => {
    const first = buildCanonicalSceneProviderRequest({
      ownership: sceneResult(SCENE_RESULT_1).ownership,
      sceneExecutionId: SCENE_EXEC,
      sceneId: "scene-a",
      sceneOrder: 0,
      runtimeAuthorizationId: "10000000-0000-5000-8000-000000000401",
      payloadReference: {
        uri: "snapshot://scene-a",
        contentHash: HASH,
        mediaType: "application/json",
      },
      correlationId: "10000000-0000-5000-8000-000000000701",
      pipelineRunId: PLAN,
    });
    expect(first.normalizedPayloadReference.contentHash).toBe(HASH);
  });

  it("D/E: retry increments attempt number without rewriting the old attempt", () => {
    const firstNumber = nextProviderAttemptNumber([], "attempt-1");
    const secondNumber = nextProviderAttemptNumber(
      [{ attemptId: "attempt-1", attemptNumber: firstNumber }],
      "attempt-2"
    );
    expect(firstNumber).toBe(1);
    expect(secondNumber).toBe(2);
  });

  it("F: retry cap is configurable and bounded", () => {
    expect(resolveAiStorySceneMaxAttempts({})).toBe(3);
    expect(resolveAiStorySceneMaxAttempts({ AI_STORY_SCENE_MAX_ATTEMPTS: "4" })).toBe(4);
    expect(resolveAiStorySceneMaxAttempts({ AI_STORY_SCENE_MAX_ATTEMPTS: "0" })).toBe(3);
    expect(resolveAiStorySceneMaxAttempts({ AI_STORY_SCENE_MAX_ATTEMPTS: "abc" })).toBe(3);
  });

  it("Q/R: client-forged scene/attempt identity fields are rejected", () => {
    expect(rejectForgedGeneratedSceneReviewBody({ attemptNumber: 9 })).toBe(
      "attemptNumber"
    );
    expect(rejectForgedGeneratedSceneReviewBody({ sceneId: "forged" })).toBe("sceneId");
    expect(rejectForgedGeneratedSceneReviewBody({ role: "admin" })).toBe("role");
    expect(rejectForgedGeneratedSceneReviewBody({})).toBeNull();
  });

  it("redacts secrets from review/retry errors", () => {
    expect(redactGeneratedSceneReviewError("Authorization: Bearer secret")).toBe(
      "Scene review request failed."
    );
    expect(redactGeneratedSceneReviewError("Scene retry limit reached")).toBe(
      "Scene retry limit reached"
    );
  });
});

describe("EXEC-04 retry authorization service", () => {
  const auth = {
    allowed: true as const,
    accessMode: "ops" as const,
    settlementMode: "none" as const,
    authorizedBy: "ACTIVE_PLATFORM_ADMIN" as const,
    policyVersion: "ai-story-exec-03.v1" as const,
    reason: "ops",
    providerCostAccounting: "ALLOWED" as const,
  };

  function pendingSnapshot(attemptCount = 1) {
    return {
      sceneExecutionId: SCENE_EXEC,
      sceneId: "scene-a",
      sceneOrder: 0,
      executionPlanId: PLAN,
      orgId: ORG,
      workspaceId: WORKSPACE,
      campaignId: "10000000-0000-4000-8000-000000000004",
      storyId: STORY,
      reviews: [
        {
          generatedSceneReviewId: REVIEW_ID,
          orgId: ORG,
          workspaceId: WORKSPACE,
          campaignId: "10000000-0000-4000-8000-000000000004",
          storyId: STORY,
          executionPlanId: PLAN,
          sceneExecutionId: SCENE_EXEC,
          sceneId: "scene-a",
          providerAttemptId: "attempt-1",
          sceneResultId: SCENE_RESULT_1,
          decision: "PENDING_REVIEW" as const,
          decidedBy: null,
          decidedAt: null,
          rationale: null,
          contractVersion: "1" as const,
        },
      ],
      results: [
        {
          workspaceId: WORKSPACE,
          executionPlanId: PLAN,
          sceneExecutionId: SCENE_EXEC,
          sceneId: "scene-a",
          providerAttemptId: "attempt-1",
          status: "SUCCEEDED",
          sceneResultId: SCENE_RESULT_1,
          projectedAt: new Date("2026-08-05T13:00:00.000Z"),
        },
      ],
      correlations: Array.from({ length: attemptCount }, (_, index) => ({
        providerExecutionId: `exec-${index + 1}`,
        scheduledAt: new Date("2026-08-05T12:55:00.000Z"),
      })),
      providerExecutions: new Map(
        Array.from({ length: attemptCount }, (_, index) => [
          `exec-${index + 1}`,
          { status: "SUCCEEDED", acceptedAttemptId: `attempt-${index + 1}` },
        ])
      ),
      attemptCount,
      maxAttempts: 3,
    };
  }

  it("A: approve binds the exact attempt", async () => {
    const write = vi.fn(async (_tx: unknown, input: { decision: string }) => ({
      ...pendingSnapshot().reviews[0],
      decision: input.decision,
      providerAttemptId: "attempt-1",
      sceneResultId: SCENE_RESULT_1,
    }));
    const service = new GeneratedSceneReviewService({
      reviewRepository: {
        transactDecision: async (
          _input: unknown,
          work: (tx: unknown, snapshot: unknown) => Promise<unknown>
        ) => work({}, pendingSnapshot()),
        writeDecisionInTransaction: write,
        listByExecutionPlanId: async () => pendingSnapshot().reviews,
      } as never,
      persistenceRepository: {
        getByExecutionPlanId: async () => ({
          intents: [
            {
              identity: {
                sceneExecutionId: SCENE_EXEC,
                sceneId: "scene-a",
                sceneOrder: 0,
              },
            },
          ],
        }),
      } as never,
    });
    vi.spyOn(service, "loadPlanReadModel").mockResolvedValue([
      {
        sceneExecutionId: SCENE_EXEC,
        sceneId: "scene-a",
        sceneOrder: 0,
        reviewState: "APPROVED",
        approvedAttemptId: "attempt-1",
        approvedSceneResultId: SCENE_RESULT_1,
        latestAttemptId: "attempt-1",
        latestAttemptNumber: 1,
        latestAttemptStatus: "success",
        attemptCount: 1,
        retryRemaining: 2,
        maxAttempts: 3,
        latestAttemptKnownCost: 0.35,
        sceneKnownCost: 0.35,
        currency: "USD",
        running: false,
        attempts: [],
      },
    ]);
    const result = await service.approve({
      executionPlanId: PLAN,
      sceneExecutionId: SCENE_EXEC,
      attemptId: "attempt-1",
      actorUserId: USER,
      workspaceId: WORKSPACE,
      executionAuthorization: auth,
    });
    expect(result.review.decision).toBe("APPROVED");
    expect(write).toHaveBeenCalled();
  });

  it("F/G: retry without a separately durable human authorization is denied", async () => {
    const schedule = vi.fn();
    const service = new GeneratedSceneReviewService({
      reviewRepository: {
        transactDecision: async (
          _input: unknown,
          work: (tx: unknown, snapshot: unknown) => Promise<unknown>
        ) => work({}, pendingSnapshot(3)),
        writeDecisionInTransaction: vi.fn(),
      } as never,
      schedulingCoordinator: { scheduleAuthorizedScene: schedule } as never,
    });
    await expect(
      service.retry({
        executionPlanId: PLAN,
        sceneExecutionId: SCENE_EXEC,
        actorUserId: USER,
        workspaceId: WORKSPACE,
        executionAuthorization: auth,
      })
    ).rejects.toMatchObject({ code: "GENERATED_SCENE_RETRY_NOT_ELIGIBLE" });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("G/H: explicit human retry creates generation 2 and duplicate requests converge", async () => {
    const snapshot = pendingSnapshot(1);
    snapshot.reviews[0]!.decision = "REJECTED";
    const scheduledIdentities = new Set<string>();
    const schedule = vi.fn(async (input: { retryGeneration: number }) => {
      scheduledIdentities.add(`${SCENE_EXEC}:${input.retryGeneration}`);
      return {};
    });
    const service = new GeneratedSceneReviewService({
      reviewRepository: {
        transactDecision: async (
          _input: unknown,
          work: (tx: unknown, locked: unknown) => Promise<unknown>
        ) => work({}, snapshot),
        writeDecisionInTransaction: vi.fn(async (_tx, input) => ({
          ...input.current,
          decision: input.decision,
          decidedBy: input.decidedBy,
          decidedAt: input.decidedAt,
        })),
      } as never,
      authorizationRepository: {
        getByExecutionPlanId: async () => ({
          runtimeAuthorizationId: "10000000-0000-5000-8000-000000000099",
        }),
      } as never,
      persistenceRepository: {
        getByExecutionPlanId: async () => ({ intents: [{}] }),
      } as never,
      schedulingCoordinator: { scheduleAuthorizedScene: schedule } as never,
      differentiatedRetryRepository: {
        getAuthorization: async () => ({
          retryAuthorizationId: RETRY_AUTHORIZATION_ID,
          sceneExecutionId: SCENE_EXEC,
          executionPlanId: PLAN,
          workspaceId: WORKSPACE,
          sourceReviewId: REVIEW_ID,
          sourceAttemptId: "attempt-1",
          authorizedAttemptNumber: 2,
          retryInputRevisionId: RETRY_REVISION_ID,
          retryInputFingerprint: HASH,
        }) as never,
        getRevision: async () => ({
          retryInputRevisionId: RETRY_REVISION_ID,
          sceneExecutionId: SCENE_EXEC,
          executionPlanId: PLAN,
          workspaceId: WORKSPACE,
          revisionNumber: 2,
          providerModeRequirement: "FIRST_FRAME_I2V",
          canonicalFingerprint: HASH,
        }) as never,
        markAuthorizationConsumed: async () => ({}) as never,
      },
    });
    vi.spyOn(service, "loadPlanReadModel").mockResolvedValue([
      {
        sceneExecutionId: SCENE_EXEC,
        sceneId: "scene-a",
        sceneOrder: 0,
        reviewState: "RETRY_REQUESTED",
        approvedAttemptId: null,
        approvedSceneResultId: null,
        latestAttemptId: "attempt-1",
        latestAttemptNumber: 1,
        latestAttemptStatus: "failed",
        attemptCount: 1,
        retryRemaining: 2,
        maxAttempts: 3,
        latestAttemptKnownCost: 0.01,
        sceneKnownCost: 0.01,
        currency: "USD",
        running: false,
        attempts: [],
      },
    ]);

    const retryInput = {
      executionPlanId: PLAN,
      sceneExecutionId: SCENE_EXEC,
      actorUserId: USER,
      workspaceId: WORKSPACE,
      executionAuthorization: auth,
      retryAuthorizationId: RETRY_AUTHORIZATION_ID,
    };
    const first = await service.retry(retryInput);
    const duplicate = await service.retry(retryInput);

    expect(first.newAttemptNumber).toBe(2);
    expect(duplicate.newAttemptNumber).toBe(2);
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(schedule).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ retryGeneration: 2 })
    );
    expect(schedule).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ retryGeneration: 2 })
    );
    expect(scheduledIdentities.size).toBe(1);
  });

  it("H: an unauthorised retry cannot enqueue even when an attempt is in-flight", async () => {
    const snapshot = pendingSnapshot(1);
    snapshot.providerExecutions.set("exec-1", { status: "PENDING" });
    const schedule = vi.fn();
    const service = new GeneratedSceneReviewService({
      reviewRepository: {
        transactDecision: async (
          _input: unknown,
          work: (tx: unknown, snapshot: unknown) => Promise<unknown>
        ) => work({}, snapshot),
        writeDecisionInTransaction: vi.fn(),
      } as never,
      schedulingCoordinator: { scheduleAuthorizedScene: schedule } as never,
    });
    await expect(
      service.retry({
        executionPlanId: PLAN,
        sceneExecutionId: SCENE_EXEC,
        actorUserId: USER,
        workspaceId: WORKSPACE,
        executionAuthorization: auth,
      })
    ).rejects.toMatchObject({ code: "GENERATED_SCENE_RETRY_NOT_ELIGIBLE" });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("I: approve vs in-flight retry is fail-closed", async () => {
    const snapshot = pendingSnapshot(1);
    snapshot.providerExecutions.set("exec-1", { status: "RUNNING" });
    const service = new GeneratedSceneReviewService({
      reviewRepository: {
        transactDecision: async (
          _input: unknown,
          work: (tx: unknown, snapshot: unknown) => Promise<unknown>
        ) => work({}, snapshot),
        writeDecisionInTransaction: vi.fn(),
      } as never,
    });
    await expect(
      service.approve({
        executionPlanId: PLAN,
        sceneExecutionId: SCENE_EXEC,
        attemptId: "attempt-1",
        actorUserId: USER,
        workspaceId: WORKSPACE,
        executionAuthorization: auth,
      })
    ).rejects.toMatchObject({ code: "GENERATED_SCENE_RETRY_IN_FLIGHT" });
  });
});

describe("EXEC-04 product authorization", () => {
  const USER_ID = "10000000-0000-4000-8000-000000000001";
  function member(role = "operator") {
    return { orgId: ORG, workspaceId: WORKSPACE, role };
  }
  function deps(input?: {
    platformAdminStatus?: "ACTIVE_GRANT" | "DENIED";
    plan?: string;
    membership?: ReturnType<typeof member> | "missing";
  }) {
    const membership = input?.membership ?? member();
    return {
      requireWorkspaceRole:
        membership === "missing"
          ? vi.fn().mockRejectedValue(new WorkspaceAccessError("Not a member", "FORBIDDEN"))
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
          orgId: ORG,
          workspaceId: WORKSPACE,
          entries: [],
          projectedAt: "2026-08-31T00:00:00.000Z",
          integrityHash: HASH,
        }),
      },
      now: () => "2026-08-31T00:00:00.000Z",
    };
  }
  const request = {
    user: { id: USER_ID, email: "ops@example.com" },
    orgId: ORG,
    workspaceId: WORKSPACE,
    minRole: "operator" as const,
  };

  it("P: Super Admin and Agency are authorized", async () => {
    await expect(
      authorizeAiStoryExecution(request, deps({ platformAdminStatus: "ACTIVE_GRANT" }))
    ).resolves.toMatchObject({ allowed: true, authorizedBy: "ACTIVE_PLATFORM_ADMIN" });
    await expect(
      authorizeAiStoryExecution(request, deps({ plan: "agency" }))
    ).resolves.toMatchObject({ allowed: true, authorizedBy: "AGENCY_PLAN_CAPABILITY" });
  });

  it("O: Free/Pro/Pro Plus cannot review/retry", async () => {
    for (const plan of ["free", "pro", "pro_plus"]) {
      await expect(authorizeAiStoryExecution(request, deps({ plan }))).rejects.toMatchObject({
        code: "AI_STORY_EXECUTION_DENIED",
      });
    }
  });

  it("Q: cross-workspace membership is denied", async () => {
    await expect(
      authorizeAiStoryExecution(request, deps({ membership: "missing" }))
    ).rejects.toMatchObject({ code: "AI_STORY_EXECUTION_DENIED" });
  });
});

describe("EXEC-04 error class", () => {
  it("keeps fail-closed review errors bounded", () => {
    const error = new GeneratedSceneReviewError(
      "GENERATED_SCENE_RETRY_LIMIT_EXHAUSTED",
      "Scene retry limit reached"
    );
    expect(error.status).toBe(409);
    expect(error.message).not.toMatch(/seedance|minimax|authorization/i);
  });
});
