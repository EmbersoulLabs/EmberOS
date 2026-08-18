/**
 * Sprint 3 Phase 2B PR 2B.4 — API route contract + security tests (mocked auth/repos).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, handleApiError } from "../apps/web/src/lib/auth";
import { PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared";

const requireAuth = vi.fn();
const resolveAuthorizedExecutionPlan = vi.fn();
const openReview = vi.fn();
const appendSceneIntentDecision = vi.fn();
const appendStoryDecision = vi.fn();
const getLogicalProjection = vi.fn();
const createOrReturnAssembly = vi.fn();
const buildReadModel = vi.fn();
const buildHistory = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getAuthUser: vi.fn(),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../apps/web/src/lib/auth")>(
    "../apps/web/src/lib/auth"
  );
  return {
    ...actual,
    requireAuth: () => requireAuth(),
  };
});

vi.mock("@/lib/ai-story-execution-plan-access", () => ({
  resolveAuthorizedExecutionPlan: (...args: unknown[]) =>
    resolveAuthorizedExecutionPlan(...args),
  executionPlanRouteErrorResponse: () => null,
  ExecutionPlanRouteNotFoundError: class extends Error {
    code = "NOT_FOUND";
    status = 404;
  },
  ExecutionPlanRouteValidationError: class extends Error {
    code = "VALIDATION_ERROR";
    status = 400;
  },
}));

vi.mock("@ceo-agent/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ceo-agent/db")>();
  return {
    ...actual,
    ExecutionPlanReviewRepository: class {
      openReview = openReview;
      appendSceneIntentDecision = appendSceneIntentDecision;
      appendStoryDecision = appendStoryDecision;
      getLogicalProjection = getLogicalProjection;
    },
    ExecutionPlanAssemblyRepository: class {
      createOrReturnAssembly = createOrReturnAssembly;
    },
  };
});

vi.mock("@/lib/ai-story-review-assembly-read-model", () => ({
  buildExecutionPlanReviewAssemblyReadModel: (...args: unknown[]) => buildReadModel(...args),
  buildReviewHistoryReadModel: (...args: unknown[]) => buildHistory(...args),
  deriveExecutionPlanReadiness: vi.fn(),
}));

const CAMPAIGN = "10000000-0000-4000-8000-000000000003";
const STORY = "10000000-0000-4000-8000-000000000004";
const PLAN = "10000000-0000-4000-8000-000000000020";
const SCENE = "10000000-0000-4000-8000-000000000021";
const USER = "10000000-0000-4000-8000-000000000040";

const baseReadModel = {
  executionPlan: {
    id: PLAN,
    status: "PERSISTED",
    orgId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "10000000-0000-4000-8000-000000000002",
    campaignId: CAMPAIGN,
    storyId: STORY,
    storyVersionId: "10000000-0000-4000-8000-000000000005",
    animationPackageId: "10000000-0000-4000-8000-000000000006",
    readiness: "NOT_READY",
  },
  review: {
    status: "UNDER_REVIEW",
    openedAt: "2026-08-02T12:00:00.000Z",
    openedBy: USER,
    scenes: [],
    storyDecision: null,
  },
  assemblyDefinition: {
    status: "NOT_CREATED",
    id: null,
    sceneCount: 0,
    integrityHash: null,
    memberships: [],
    prerequisites: {
      hasDefinition: false,
      membershipComplete: false,
      reviewApproved: false,
      orderingDeterministic: false,
    },
  },
  executionReadiness: "NOT_READY",
  executionAllowed: false,
  executionLockCode: PHASE1_EXECUTION_LOCKED,
};

function params(extra: Record<string, string> = {}) {
  return Promise.resolve({
    id: CAMPAIGN,
    storyId: STORY,
    executionPlanId: PLAN,
    ...extra,
  });
}

describe("Sprint 3 Phase 2B PR 2B.4 API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue({ id: USER });
    resolveAuthorizedExecutionPlan.mockResolvedValue({
      db: {},
      userId: USER,
      campaignId: CAMPAIGN,
      storyId: STORY,
      executionPlanId: PLAN,
      orgId: baseReadModel.executionPlan.orgId,
      workspaceId: baseReadModel.executionPlan.workspaceId,
      plan: { id: PLAN },
    });
    buildReadModel.mockResolvedValue(baseReadModel);
    buildHistory.mockResolvedValue({
      executionPlanId: PLAN,
      events: [],
      executionAllowed: false,
      executionLockCode: PHASE1_EXECUTION_LOCKED,
    });
    openReview.mockResolvedValue({ factId: "10000000-0000-4000-8000-000000000050" });
    getLogicalProjection.mockResolvedValue({ status: "APPROVED" });
    appendSceneIntentDecision.mockResolvedValue({ decision: "APPROVED" });
    appendStoryDecision.mockResolvedValue({ decision: "APPROVED" });
    createOrReturnAssembly.mockResolvedValue({
      definition: { assemblyDefinitionId: "10000000-0000-4000-8000-000000000060" },
      memberships: [],
      replayed: false,
    });
  });

  it("POST /review opens with authenticated user as openedBy", async () => {
    const { POST } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/route"
    );
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: params(),
    });
    expect(response.status).toBe(200);
    expect(openReview).toHaveBeenCalledWith({
      executionPlanId: PLAN,
      openedBy: USER,
    });
    const body = await response.json();
    expect(body.executionAllowed).toBe(false);
    expect(body.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
  });

  it("GET /review returns safe read model without snapshot bodies", async () => {
    const { GET } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/route"
    );
    const response = await GET(new Request("http://localhost"), { params: params() });
    const body = await response.json();
    expect(body.executionAllowed).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/instructions|prompt|credential/i);
  });

  it("scene decision rejects client-supplied reviewerId", async () => {
    const { POST } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/scenes/[sceneExecutionId]/decisions/route"
    );
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ decision: "APPROVED", reviewerId: USER }),
      }),
      { params: params({ sceneExecutionId: SCENE }) }
    );
    expect(response.status).toBe(400);
    expect(appendSceneIntentDecision).not.toHaveBeenCalled();
  });

  it("scene decision uses authenticated user as reviewedBy", async () => {
    const { POST } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/scenes/[sceneExecutionId]/decisions/route"
    );
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "APPROVED", comment: "ok" }),
      }),
      { params: params({ sceneExecutionId: SCENE }) }
    );
    expect(response.status).toBe(200);
    expect(appendSceneIntentDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneExecutionId: SCENE,
        decision: "APPROVED",
        reviewedBy: USER,
        rationale: "ok",
      })
    );
  });

  it("story decision rejects reviewedBy impersonation", async () => {
    const { POST } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/decisions/route"
    );
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ decision: "REJECTED", reviewedBy: USER }),
      }),
      { params: params() }
    );
    expect(response.status).toBe(400);
    expect(appendStoryDecision).not.toHaveBeenCalled();
  });

  it("assembly create returns executionAllowed false", async () => {
    const { POST } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/assembly-definition/route"
    );
    const response = await POST(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: params() }
    );
    expect(response.status).toBe(200);
    expect(createOrReturnAssembly).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: USER, executionPlanId: PLAN })
    );
    const body = await response.json();
    expect(body.executionAllowed).toBe(false);
  });

  it("unauthenticated requests return 401", async () => {
    requireAuth.mockRejectedValue(new AuthError());
    const { GET } = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/review/route"
    );
    const response = await GET(new Request("http://localhost"), { params: params() });
    expect(response.status).toBe(401);
  });

  it("handleApiError maps new review/assembly codes", async () => {
    for (const [code, status] of [
      ["REVIEW_IDENTITY_CONFLICT", 409],
      ["REVIEW_STATE_CONFLICT", 409],
      ["SCENE_REVIEW_NOT_ELIGIBLE", 409],
      ["STORY_REVIEW_NOT_ELIGIBLE", 409],
      ["OWNERSHIP_INTEGRITY_VIOLATION", 409],
      ["ASSEMBLY_IDENTITY_CONFLICT", 409],
      ["ASSEMBLY_INTEGRITY_VIOLATION", 409],
      ["ASSEMBLY_OWNERSHIP_INVALID", 403],
      ["ASSEMBLY_VALIDATION_FAILED", 400],
    ] as const) {
      const err = Object.assign(new Error(code), { code });
      const response = handleApiError(err);
      expect(response.status).toBe(status);
      expect((await response.json()).code).toBe(code);
    }
  });
});
