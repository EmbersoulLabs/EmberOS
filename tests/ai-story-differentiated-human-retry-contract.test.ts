import { describe, expect, it, vi } from "vitest";
import {
  AI_STORY_MAX_HUMAN_AUTHORIZED_ATTEMPTS,
  AuthorizeSceneRetryCommandSchema,
  GeneratedSceneReviewFactSchema,
  SceneAttemptInputRevisionFactSchema,
  SceneRetryAuthorizationFactSchema,
  SceneRetryEligibilityFactSchema,
  isMateriallyDifferentiated,
  type SceneAttemptInputRevisionFact,
} from "@ceo-agent/shared";
import {
  DifferentiatedRetryService,
  applyRetryInputRevision,
} from "../packages/agents/src/ai-story/differentiated-retry-service";
import { assertGeneratedSceneRetryProviderTruth } from "../packages/db/src/queries/ai-story-differentiated-retry";

const ID = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const HASH = `sha256:${"a".repeat(64)}`;
const SOURCE = {
  visualRole: "HERO_INTRODUCTION",
  cameraInstruction: "SLOW_PUSH_IN",
  focusProgression: ["PRIMARY_PRODUCT", "FULL_COMPOSITION"],
  shotEmphasis: "HERO_PRESENTATION",
};
const DIFFERENT = {
  visualRole: "SECONDARY_DETAIL_REVEAL",
  cameraInstruction: "MINOR_LATERAL_DOLLY",
  focusProgression: ["PRIMARY_DETAIL", "SECONDARY_DETAIL"],
  shotEmphasis: "DISTINCT_VISUAL_BEAT",
};

function revision(overrides: Partial<SceneAttemptInputRevisionFact> = {}) {
  return SceneAttemptInputRevisionFactSchema.parse({
    retryInputRevisionId: ID("901"),
    orgId: ID("2"),
    workspaceId: ID("3"),
    campaignId: ID("4"),
    storyId: ID("5"),
    executionPlanId: ID("101"),
    sceneExecutionId: ID("201"),
    revisionNumber: 2,
    parentRevisionId: ID("900"),
    sourceAttemptId: "attempt-1",
    sourceReviewId: ID("801"),
    retryReason: "INSUFFICIENT_SCENE_DIFFERENTIATION",
    creativeDirection: DIFFERENT,
    productAssetId: ID("301"),
    productAuthorityHash: HASH,
    visualAuthorityCertificationHash: HASH,
    providerModeRequirement: "FIRST_FRAME_I2V",
    canonicalFingerprint: HASH,
    createdBy: ID("1"),
    createdAt: "2026-08-25T00:00:00.000Z",
    contractVersion: "1",
    ...overrides,
  });
}

describe("differentiated human retry contract", () => {
  it("accepts current runtime v1 PENDING only with complete terminal success evidence", () => {
    expect(() => assertGeneratedSceneRetryProviderTruth({
      attempt: {
        attemptId: "attempt-1", executionId: "execution-1",
        contractVersion: "ai-story-provider-runtime.v1",
        providerRequestId: "task-1", status: "PENDING",
      },
      result: { status: "SUCCEEDED", providerAttemptId: "attempt-1" },
      workerResults: [{
        providerAttemptId: "attempt-1", providerExecutionId: "execution-1",
        providerRequestId: "task-1", workerState: "TERMINAL_SUCCESS",
        acceptanceClassification: "ACCEPTED", canonicalProviderState: "SUCCEEDED",
        reconciliationRequired: false,
      }],
      observations: [{
        providerAttemptId: "attempt-1", providerExecutionId: "execution-1",
        providerRequestId: "task-1", observationKind: "ACCEPTED",
        reconciliationRequired: false,
      }],
    })).not.toThrow();
  });

  it("fails closed for conflicting current runtime retry evidence", () => {
    expect(() => assertGeneratedSceneRetryProviderTruth({
      attempt: {
        attemptId: "attempt-1", executionId: "execution-1",
        contractVersion: "ai-story-provider-runtime.v1",
        providerRequestId: "task-1", status: "PENDING",
      },
      result: { status: "SUCCEEDED", providerAttemptId: "attempt-1" },
      workerResults: [{
        providerAttemptId: "attempt-1", providerExecutionId: "execution-1",
        providerRequestId: "task-2", workerState: "TERMINAL_SUCCESS",
        acceptanceClassification: "ACCEPTED", canonicalProviderState: "SUCCEEDED",
        reconciliationRequired: false,
      }],
      observations: [{
        providerAttemptId: "attempt-1", providerExecutionId: "execution-1",
        providerRequestId: "task-1", observationKind: "ACCEPTED",
        reconciliationRequired: false,
      }],
    })).toThrow(/incomplete or conflicting/);
  });

  it("keeps Provider success independent from a creative human rejection", () => {
    const providerAttempt = Object.freeze({ attemptId: "attempt-1", status: "SUCCEEDED" });
    const review = GeneratedSceneReviewFactSchema.parse({
      generatedSceneReviewId: ID("801"), orgId: ID("2"), workspaceId: ID("3"),
      campaignId: ID("4"), storyId: ID("5"), executionPlanId: ID("101"),
      sceneExecutionId: ID("201"), sceneId: "scene-002", providerAttemptId: "attempt-1",
      sceneResultId: ID("701"), decision: "REJECTED", decidedBy: ID("1"),
      decidedAt: "2026-08-25T00:00:00.000Z",
      rationale: JSON.stringify({ reason: "INSUFFICIENT_SCENE_DIFFERENTIATION" }),
      contractVersion: "1",
    });
    expect(providerAttempt.status).toBe("SUCCEEDED");
    expect(review.decision).toBe("REJECTED");
  });

  it("represents REJECTED + ELIGIBLE without authorizing spend", () => {
    const eligibility = SceneRetryEligibilityFactSchema.parse({
      retryEligibilityId: ID("802"), orgId: ID("2"), workspaceId: ID("3"),
      campaignId: ID("4"), storyId: ID("5"), executionPlanId: ID("101"),
      sceneExecutionId: ID("201"), sourceReviewId: ID("801"), sourceAttemptId: "attempt-1",
      eligibility: "ELIGIBLE", nextAttemptNumber: 2,
      reason: "INSUFFICIENT_SCENE_DIFFERENTIATION", canonicalFingerprint: HASH,
      evaluatedAt: "2026-08-25T00:00:00.000Z", contractVersion: "1",
    });
    expect(eligibility).toMatchObject({ eligibility: "ELIGIBLE", nextAttemptNumber: 2 });
  });

  it("requires material, semantic differentiation rather than textual noise", () => {
    expect(isMateriallyDifferentiated({
      source: SOURCE,
      candidate: { ...SOURCE, visualRole: " hero_introduction " },
      reason: "INSUFFICIENT_SCENE_DIFFERENTIATION",
    })).toBe(false);
    expect(isMateriallyDifferentiated({
      source: SOURCE,
      candidate: DIFFERENT,
      reason: "INSUFFICIENT_SCENE_DIFFERENTIATION",
    })).toBe(true);
  });

  it("creates a distinct immutable revision and leaves revision 1 untouched", () => {
    const original = Object.freeze({
      purpose: "HERO_INTRODUCTION",
      transition: "SLOW_PUSH_IN",
      shots: [Object.freeze({
        shotId: "shot-1", cameraType: "close-up", cameraMovement: "SLOW_PUSH_IN",
        focus: "PRIMARY_PRODUCT", composition: "centered", information: "HERO_PRESENTATION",
        emotion: "calm", durationMs: 4000,
      })],
    });
    const revised = applyRetryInputRevision(original as never, revision());
    expect(revised).not.toBe(original);
    expect(revised.purpose).toBe("SECONDARY_DETAIL_REVEAL");
    expect(original.purpose).toBe("HERO_INTRODUCTION");
  });

  it("locks product authority and FIRST_FRAME_I2V in the revision schema", () => {
    expect(() => revision({ providerModeRequirement: "REFERENCE_IMAGE_T2V" as never })).toThrow();
    expect(revision().productAssetId).toBe(ID("301"));
  });

  it("forbids attempt 4 and requires an exact revision-bound authorization", () => {
    expect(AI_STORY_MAX_HUMAN_AUTHORIZED_ATTEMPTS).toBe(3);
    expect(() => SceneRetryAuthorizationFactSchema.parse({
      retryAuthorizationId: ID("902"), orgId: ID("2"), workspaceId: ID("3"),
      campaignId: ID("4"), storyId: ID("5"), executionPlanId: ID("101"),
      sceneExecutionId: ID("201"), sourceReviewId: ID("801"), sourceAttemptId: "attempt-1",
      authorizedAttemptNumber: 4, authorizedBy: ID("1"), authorizedAt: "2026-08-25T00:00:00.000Z",
      reason: "INSUFFICIENT_SCENE_DIFFERENTIATION", retryInputRevisionId: ID("901"),
      retryInputFingerprint: HASH, status: "AUTHORIZED", canonicalFingerprint: HASH,
      contractVersion: "1",
    })).toThrow();
  });

  it("rejects client identity/provider fields from the authorization command", () => {
    expect(() => AuthorizeSceneRetryCommandSchema.parse({
      sourceReviewId: ID("801"), retryInputRevisionId: ID("901"),
      workspaceId: ID("999"), provider: "seedance",
    })).toThrow();
  });

  it("review rejection invokes no Provider or scheduling authority", async () => {
    const rejectCreative = vi.fn(async () => ({ reviewId: ID("801") }));
    const providerSubmit = vi.fn();
    const service = new DifferentiatedRetryService({ rejectCreative } as never);
    await service.rejectCreative({
      executionPlanId: ID("101"), sceneExecutionId: ID("201"), workspaceId: ID("3"),
      actorUserId: ID("1"), command: { reason: "INSUFFICIENT_SCENE_DIFFERENTIATION" },
    });
    expect(rejectCreative).toHaveBeenCalledOnce();
    expect(providerSubmit).not.toHaveBeenCalled();
  });
});
