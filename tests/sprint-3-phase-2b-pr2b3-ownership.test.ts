/**
 * Sprint 3 Phase 2B PR 2B.3 — ownership integrity unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  OwnershipIntegrityViolationError,
  assertOwnershipColumnsMatch,
  assertPlanOwnershipColumnsMatch,
  assertSceneMatchesPlan,
  assertSnapshotMatchesWorkspace,
  planOwnershipFromRow,
} from "@ceo-agent/db";

const PLAN = {
  id: "10000000-0000-4000-8000-000000000101",
  orgId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000002",
  campaignId: "10000000-0000-4000-8000-000000000003",
  storyId: "10000000-0000-4000-8000-000000000004",
  storyVersionId: "10000000-0000-4000-8000-000000000005",
  animationPackageId: "10000000-0000-4000-8000-000000000006",
} as const;

const WORKSPACE_B = "20000000-0000-4000-8000-000000000002";

describe("Phase 2B PR 2B.3 ownership integrity", () => {
  it("accepts matching ownership columns", () => {
    expect(() =>
      assertOwnershipColumnsMatch(PLAN, {
        orgId: PLAN.orgId,
        workspaceId: PLAN.workspaceId,
        campaignId: PLAN.campaignId,
        storyId: PLAN.storyId,
        storyVersionId: PLAN.storyVersionId,
        animationPackageId: PLAN.animationPackageId,
      }, "Scene")
    ).not.toThrow();
  });

  it("workspace drift fails closed with OWNERSHIP_INTEGRITY_VIOLATION", () => {
    expect(() =>
      assertOwnershipColumnsMatch(PLAN, {
        orgId: PLAN.orgId,
        workspaceId: WORKSPACE_B,
        campaignId: PLAN.campaignId,
        storyId: PLAN.storyId,
        storyVersionId: PLAN.storyVersionId,
        animationPackageId: PLAN.animationPackageId,
      }, "Scene")
    ).toThrow(OwnershipIntegrityViolationError);
    try {
      assertOwnershipColumnsMatch(PLAN, {
        orgId: PLAN.orgId,
        workspaceId: WORKSPACE_B,
        campaignId: PLAN.campaignId,
        storyId: PLAN.storyId,
        storyVersionId: PLAN.storyVersionId,
        animationPackageId: PLAN.animationPackageId,
      }, "Scene");
    } catch (error) {
      expect(error).toMatchObject({ code: "OWNERSHIP_INTEGRITY_VIOLATION", status: 409 });
    }
  });

  it("campaign / story / animation package drift fail closed", () => {
    const expected = planOwnershipFromRow(PLAN as never);
    expect(() =>
      assertPlanOwnershipColumnsMatch(expected, {
        ...expected,
        campaignId: "10000000-0000-4000-8000-000000000099",
      }, "Assembly")
    ).toThrow(OwnershipIntegrityViolationError);
    expect(() =>
      assertPlanOwnershipColumnsMatch(expected, {
        ...expected,
        storyId: "10000000-0000-4000-8000-000000000098",
      }, "Review")
    ).toThrow(OwnershipIntegrityViolationError);
    expect(() =>
      assertPlanOwnershipColumnsMatch(expected, {
        ...expected,
        animationPackageId: "10000000-0000-4000-8000-000000000097",
      }, "Snapshot")
    ).toThrow(OwnershipIntegrityViolationError);
  });

  it("scene workspace drift vs plan fails closed", () => {
    const scene = {
      ...PLAN,
      executionPlanId: PLAN.id,
      workspaceId: WORKSPACE_B,
    };
    expect(() => assertSceneMatchesPlan(PLAN as never, scene as never)).toThrow(
      OwnershipIntegrityViolationError
    );
  });

  it("snapshot workspace drift fails closed", () => {
    expect(() =>
      assertSnapshotMatchesWorkspace(PLAN, {
        orgId: PLAN.orgId,
        workspaceId: WORKSPACE_B,
      })
    ).toThrow(OwnershipIntegrityViolationError);
  });
});
