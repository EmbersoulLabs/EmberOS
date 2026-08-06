/**
 * Sprint 3 Phase 2B PR 2B.4 — read-model + request contract unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  AssemblyDefinitionCreateRequestSchema,
  ExecutionPlanReviewAssemblyReadModelSchema,
  PHASE1_EXECUTION_LOCKED,
  ReviewDecisionRequestSchema,
  ReviewHistoryReadModelSchema,
} from "@ceo-agent/shared";
import { deriveExecutionPlanReadiness } from "../apps/web/src/lib/ai-story-review-assembly-read-model";
import { normalizeReviewAssemblyApiError } from "../apps/web/src/lib/ai-story-review-assembly-errors";

describe("Sprint 3 Phase 2B PR 2B.4 contracts and readiness", () => {
  it("derives READY_FOR_EXECUTION only when review+assembly+QC prerequisites hold", () => {
    expect(
      deriveExecutionPlanReadiness({
        reviewStatus: "APPROVED",
        hasDefinition: true,
        membershipComplete: true,
        orderingDeterministic: true,
        scenesHaveNonBlockingQc: true,
      })
    ).toBe("READY_FOR_EXECUTION");

    expect(
      deriveExecutionPlanReadiness({
        reviewStatus: "APPROVED",
        hasDefinition: false,
        membershipComplete: false,
        orderingDeterministic: false,
        scenesHaveNonBlockingQc: true,
      })
    ).toBe("NOT_READY");

    expect(
      deriveExecutionPlanReadiness({
        reviewStatus: "UNDER_REVIEW",
        hasDefinition: true,
        membershipComplete: true,
        orderingDeterministic: true,
        scenesHaveNonBlockingQc: true,
      })
    ).toBe("NOT_READY");
  });

  it("rejects reviewerId / reviewedBy in decision request schema via .strict()", () => {
    expect(
      ReviewDecisionRequestSchema.safeParse({
        decision: "APPROVED",
        reviewerId: "10000000-0000-4000-8000-000000000099",
      }).success
    ).toBe(false);

    expect(
      ReviewDecisionRequestSchema.safeParse({
        decision: "REJECTED",
        comment: "no",
      }).success
    ).toBe(true);
  });

  it("accepts empty assembly create body and optional ordered ids", () => {
    expect(AssemblyDefinitionCreateRequestSchema.safeParse({}).success).toBe(true);
    expect(
      AssemblyDefinitionCreateRequestSchema.safeParse({
        orderedSceneExecutionIds: ["10000000-0000-4000-8000-000000000010"],
      }).success
    ).toBe(true);
  });

  it("read model always locks execution", () => {
    const model = ExecutionPlanReviewAssemblyReadModelSchema.parse({
      executionPlan: {
        id: "10000000-0000-4000-8000-000000000020",
        status: "PERSISTED",
        orgId: "10000000-0000-4000-8000-000000000001",
        workspaceId: "10000000-0000-4000-8000-000000000002",
        campaignId: "10000000-0000-4000-8000-000000000003",
        storyId: "10000000-0000-4000-8000-000000000004",
        storyVersionId: "10000000-0000-4000-8000-000000000005",
        animationPackageId: "10000000-0000-4000-8000-000000000006",
        readiness: "READY_FOR_EXECUTION",
      },
      review: {
        status: "APPROVED",
        openedAt: "2026-08-02T12:00:00.000Z",
        openedBy: "10000000-0000-4000-8000-000000000040",
        scenes: [],
        storyDecision: null,
      },
      assemblyDefinition: {
        status: "PERSISTED",
        id: "10000000-0000-4000-8000-000000000030",
        sceneCount: 0,
        integrityHash: "hash",
        memberships: [],
        prerequisites: {
          hasDefinition: true,
          membershipComplete: true,
          reviewApproved: true,
          orderingDeterministic: true,
        },
      },
      executionReadiness: "READY_FOR_EXECUTION",
      executionAllowed: false,
      executionLockCode: PHASE1_EXECUTION_LOCKED,
    });
    expect(model.executionAllowed).toBe(false);
    expect(model.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
    expect(model.executionPlan.readiness).toBe("READY_FOR_EXECUTION");
  });

  it("maps repository review errors onto stable API aliases", () => {
    const identity = Object.assign(new Error("conflict"), {
      code: "EXECUTION_PLAN_REVIEW_IDENTITY_CONFLICT",
    });
    expect((normalizeReviewAssemblyApiError(identity) as Error & { code: string }).code).toBe(
      "REVIEW_IDENTITY_CONFLICT"
    );

    const qc = Object.assign(new Error("Scene Intent cannot be approved while AI QC is blocking"), {
      code: "EXECUTION_PLAN_REVIEW_STATE_INVALID",
    });
    expect((normalizeReviewAssemblyApiError(qc) as Error & { code: string }).code).toBe(
      "SCENE_REVIEW_NOT_ELIGIBLE"
    );

    const story = Object.assign(
      new Error("Story approval requires every required Scene Intent to be approved"),
      {
        code: "EXECUTION_PLAN_REVIEW_STATE_INVALID",
      }
    );
    expect((normalizeReviewAssemblyApiError(story) as Error & { code: string }).code).toBe(
      "STORY_REVIEW_NOT_ELIGIBLE"
    );
  });

  it("history schema forbids execution unlock", () => {
    const history = ReviewHistoryReadModelSchema.parse({
      executionPlanId: "10000000-0000-4000-8000-000000000020",
      events: [],
      executionAllowed: false,
      executionLockCode: PHASE1_EXECUTION_LOCKED,
    });
    expect(history.executionAllowed).toBe(false);
  });
});
