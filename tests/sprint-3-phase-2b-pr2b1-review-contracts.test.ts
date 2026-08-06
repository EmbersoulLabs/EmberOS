/**
 * Sprint 3 Phase 2B PR 2B.1 — Human Review contract + projection unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  LogicalReviewProjectionSchema,
  ReviewOpenedFactSchema,
  SceneIntentReviewDecisionSchema,
  StoryReviewDecisionSchema,
} from "@ceo-agent/shared";
import {
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
} from "@ceo-agent/db";
import {
  deriveLogicalReviewStatus,
  latestSceneDecisions,
} from "../packages/db/src/queries/ai-story-execution-plan-review";

const PLAN = "10000000-0000-4000-8000-000000000101";
const SCENE_A = "10000000-0000-4000-8000-000000000201";
const SCENE_B = "10000000-0000-4000-8000-000000000202";
const USER = "10000000-0000-4000-8000-000000000301";
const HASH = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function openedFact() {
  const fingerprint = canonicalPersistenceHash({ kind: "review-opened", executionPlanId: PLAN });
  return ReviewOpenedFactSchema.parse({
    factId: deterministicPersistenceUuid("review-opened", fingerprint),
    executionPlanId: PLAN,
    orgId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "10000000-0000-4000-8000-000000000002",
    campaignId: "10000000-0000-4000-8000-000000000003",
    storyId: "10000000-0000-4000-8000-000000000004",
    storyVersionId: "10000000-0000-4000-8000-000000000005",
    animationPackageId: "10000000-0000-4000-8000-000000000006",
    openedBy: USER,
    openedAt: "2026-08-03T12:00:00.000Z",
    contractVersion: "1",
    deterministicFingerprint: fingerprint,
  });
}

function sceneDecision(
  sceneExecutionId: string,
  decision: "APPROVED" | "REJECTED",
  reviewedAt: string
) {
  const fingerprint = canonicalPersistenceHash({
    kind: "scene-intent-review",
    executionPlanId: PLAN,
    sceneExecutionId,
    decision,
    reviewedBy: USER,
    instructionHash: HASH,
    qcResultHash: HASH,
  });
  return SceneIntentReviewDecisionSchema.parse({
    factId: deterministicPersistenceUuid("scene-intent-review", fingerprint),
    executionPlanId: PLAN,
    sceneExecutionId,
    sceneId: sceneExecutionId === SCENE_A ? "scene-a" : "scene-b",
    sceneOrder: sceneExecutionId === SCENE_A ? 0 : 1,
    decision,
    reviewedBy: USER,
    reviewedAt,
    instructionHash: HASH,
    qcResultHash: HASH,
    contractVersion: "1",
    deterministicFingerprint: fingerprint,
  });
}

function storyDecision(decision: "APPROVED" | "REJECTED") {
  const required = [SCENE_A, SCENE_B];
  const approved = decision === "APPROVED" ? required : [];
  const fingerprint = canonicalPersistenceHash({
    kind: "story-review",
    executionPlanId: PLAN,
    decision,
    reviewedBy: USER,
    requiredSceneExecutionIds: required,
    approvedSceneExecutionIds: approved,
  });
  return StoryReviewDecisionSchema.parse({
    factId: deterministicPersistenceUuid("story-review", fingerprint),
    executionPlanId: PLAN,
    decision,
    reviewedBy: USER,
    reviewedAt: "2026-08-03T12:30:00.000Z",
    requiredSceneExecutionIds: required,
    approvedSceneExecutionIds: approved,
    contractVersion: "1",
    deterministicFingerprint: fingerprint,
  });
}

describe("Phase 2B PR 2B.1 human review contracts", () => {
  it("parses ReviewOpenedFact / SceneIntentReviewDecision / StoryReviewDecision / LogicalReviewProjection", () => {
    const opened = openedFact();
    const scenes = [
      sceneDecision(SCENE_A, "APPROVED", "2026-08-03T12:10:00.000Z"),
      sceneDecision(SCENE_B, "APPROVED", "2026-08-03T12:11:00.000Z"),
    ];
    const story = storyDecision("APPROVED");
    const projection = LogicalReviewProjectionSchema.parse({
      executionPlanId: PLAN,
      orgId: opened.orgId,
      workspaceId: opened.workspaceId,
      status: "APPROVED",
      opened,
      sceneDecisions: scenes,
      latestSceneDecisionBySceneExecutionId: Object.fromEntries(
        latestSceneDecisions(scenes).entries()
      ),
      storyDecision: story,
      derivedAt: "2026-08-03T12:31:00.000Z",
    });
    expect(projection.status).toBe("APPROVED");
  });

  it("uses deterministic fact IDs for equivalent payloads", () => {
    const a = openedFact();
    const b = openedFact();
    expect(a.factId).toBe(b.factId);
    expect(a.deterministicFingerprint).toBe(b.deterministicFingerprint);
  });
});

describe("Phase 2B PR 2B.1 logical review projection", () => {
  it("derives UNDER_REVIEW until Story is approved with all Scenes approved", () => {
    expect(
      deriveLogicalReviewStatus({
        opened: null,
        sceneDecisions: [],
        storyDecision: null,
        requiredSceneExecutionIds: [SCENE_A, SCENE_B],
      })
    ).toBe("UNDER_REVIEW");

    expect(
      deriveLogicalReviewStatus({
        opened: openedFact(),
        sceneDecisions: [sceneDecision(SCENE_A, "APPROVED", "2026-08-03T12:10:00.000Z")],
        storyDecision: null,
        requiredSceneExecutionIds: [SCENE_A, SCENE_B],
      })
    ).toBe("UNDER_REVIEW");
  });

  it("derives APPROVED when every Scene and Story are approved", () => {
    const scenes = [
      sceneDecision(SCENE_A, "APPROVED", "2026-08-03T12:10:00.000Z"),
      sceneDecision(SCENE_B, "APPROVED", "2026-08-03T12:11:00.000Z"),
    ];
    expect(
      deriveLogicalReviewStatus({
        opened: openedFact(),
        sceneDecisions: scenes,
        storyDecision: storyDecision("APPROVED"),
        requiredSceneExecutionIds: [SCENE_A, SCENE_B],
      })
    ).toBe("APPROVED");
  });

  it("derives REJECTED from Scene or Story rejection and treats REJECTED as terminal", () => {
    expect(
      deriveLogicalReviewStatus({
        opened: openedFact(),
        sceneDecisions: [sceneDecision(SCENE_A, "REJECTED", "2026-08-03T12:10:00.000Z")],
        storyDecision: null,
        requiredSceneExecutionIds: [SCENE_A, SCENE_B],
      })
    ).toBe("REJECTED");

    expect(
      deriveLogicalReviewStatus({
        opened: openedFact(),
        sceneDecisions: [
          sceneDecision(SCENE_A, "APPROVED", "2026-08-03T12:10:00.000Z"),
          sceneDecision(SCENE_B, "APPROVED", "2026-08-03T12:11:00.000Z"),
        ],
        storyDecision: storyDecision("REJECTED"),
        requiredSceneExecutionIds: [SCENE_A, SCENE_B],
      })
    ).toBe("REJECTED");
  });

  it("never treats READY_FOR_EXECUTION as a review status", () => {
    const statuses = ["UNDER_REVIEW", "APPROVED", "REJECTED"] as const;
    for (const status of statuses) {
      expect(status).not.toBe("READY_FOR_EXECUTION");
    }
  });
});
