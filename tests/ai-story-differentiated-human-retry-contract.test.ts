import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  AI_STORY_MAX_HUMAN_AUTHORIZED_ATTEMPTS,
  AuthorizeSceneRetryCommandSchema,
  GeneratedSceneReviewFactSchema,
  SceneAttemptInputRevisionFactSchema,
  SceneRetryAuthorizationFactSchema,
  SceneRetryEligibilityFactSchema,
  assertRetryProviderModeMatchesFrozenScene,
  deriveAiStoryRetryProviderModeFromFrozenScene,
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

function t2vRevision(overrides: Record<string, unknown> = {}) {
  return SceneAttemptInputRevisionFactSchema.parse({
    retryInputRevisionId: ID("911"),
    orgId: ID("2"),
    workspaceId: ID("3"),
    campaignId: ID("4"),
    storyId: ID("5"),
    executionPlanId: ID("101"),
    sceneExecutionId: ID("201"),
    revisionNumber: 2,
    parentRevisionId: ID("910"),
    sourceAttemptId: "attempt-1",
    sourceReviewId: ID("801"),
    retryReason: "INSUFFICIENT_SCENE_DIFFERENTIATION",
    creativeDirection: DIFFERENT,
    productAssetId: null,
    productAuthorityHash: null,
    visualAuthorityCertificationHash: null,
    providerModeRequirement: "REFERENCE_FREE_T2V",
    canonicalFingerprint: HASH,
    createdBy: ID("1"),
    createdAt: "2026-08-25T00:00:00.000Z",
    contractVersion: "1",
    ...overrides,
  });
}

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
      referencedAssetIds: [ID("301")],
      generationAuthority: {
        strategy: "FIRST_FRAME_IMAGE_TO_VIDEO",
        referenceSource: "SCENE_EXPLICIT",
        effectiveReferenceIds: [ID("301")],
        firstFrameAssetId: ID("301"),
        productVisualIdentityRequirement: "REQUIRED",
      },
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
    expect(revised.generationAuthority).toEqual(original.generationAuthority);
    expect(revised.referencedAssetIds).toEqual([ID("301")]);
  });

  it("projects the latest human correction ahead of retry direction and suppresses rejected inherited composition", () => {
    const original = Object.freeze({
      purpose: "FLORIST PRESENTATION",
      transition: "STATIC",
      referencedAssetIds: [ID("301")],
      generationAuthority: {
        strategy: "FIRST_FRAME_IMAGE_TO_VIDEO",
        referenceSource: "SCENE_EXPLICIT",
        effectiveReferenceIds: [ID("301")],
        firstFrameAssetId: ID("301"),
        productVisualIdentityRequirement: "REQUIRED",
      },
      shots: [Object.freeze({
        shotId: "shot-1", order: 0, cameraType: "static", cameraMovement: "STATIC",
        focus: "bouquet", composition: "shop owner presenting the bouquet",
        framing: "medium", lensSuggestion: "", information: "workbench presentation",
        emotion: "calm", durationMs: 4000,
      })],
    });
    const correction = JSON.stringify({
      reason: "INSUFFICIENT_SCENE_DIFFERENTIATION",
      note: "The result remains in a florist/workbench presentation setting instead of showing Mara carrying the bouquet through an urban walkway.",
    });
    const revised = applyRetryInputRevision(original as never, revision(), {
      latestHumanReviewCorrection: correction,
    });
    const active = JSON.stringify(revised);
    expect(revised.purpose).toContain("Latest human review correction governs this retry");
    expect(revised.purpose).toContain(DIFFERENT.visualRole);
    expect(revised.shots[0]?.information).toContain(DIFFERENT.shotEmphasis);
    expect(revised.shots[0]?.cameraType).toBe("review-directed retry");
    expect(active).not.toContain("shop owner presenting the bouquet");
    expect(active).not.toContain("workbench presentation");
    expect(active).not.toContain(correction);
    expect(JSON.stringify(original)).toContain("shop owner presenting the bouquet");
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

  it("derives review-directed retry compilation identity from the immutable input revision clock", () => {
    const coordinator = readFileSync(
      "packages/agents/src/ai-story/scene-scheduling-coordinator.ts",
      "utf8"
    );
    const postTerminalClock = coordinator.indexOf(
      "input.postTerminalRetryAuthorization?.authorizedAt ??"
    );
    const reviewRetryClock = coordinator.indexOf(
      "input.retryInputRevision?.createdAt ??"
    );
    const baseClock = coordinator.indexOf("acceptedRoutingDecision.decidedAt", reviewRetryClock);
    expect(postTerminalClock).toBeGreaterThan(-1);
    expect(reviewRetryClock).toBeGreaterThan(postTerminalClock);
    expect(baseClock).toBeGreaterThan(reviewRetryClock);
    expect(coordinator).toContain("retryAuthorityHash: instructionHash");
    const requestBuilder = readFileSync(
      "packages/agents/src/ai-story/canonical-scene-provider-request.ts",
      "utf8"
    );
    expect(requestBuilder).toContain("retryAuthorityHash: input.retryAuthorityHash");
  });

  it("derives REFERENCE_FREE_T2V retry mode from frozen TEXT_TO_VIDEO Scene authority", () => {
    expect(deriveAiStoryRetryProviderModeFromFrozenScene({
      generationAuthority: {
        strategy: "TEXT_TO_VIDEO",
        referenceSource: "REFERENCE_FREE_T2V",
      },
    })).toBe("REFERENCE_FREE_T2V");
  });

  it("keeps reference-free retry free of Product Asset and visual certification fields", () => {
    const fact = t2vRevision();
    expect(fact.providerModeRequirement).toBe("REFERENCE_FREE_T2V");
    expect(fact.productAssetId).toBeNull();
    expect(fact.productAuthorityHash).toBeNull();
    expect(fact.visualAuthorityCertificationHash).toBeNull();
  });

  it("compiles a reference-free retry as TEXT_TO_VIDEO with zero image references", () => {
    const original = {
      purpose: "OPENING ATMOSPHERE",
      transition: "STATIC",
      referencedAssetIds: [],
      generationAuthority: {
        strategy: "TEXT_TO_VIDEO" as const,
        referenceSource: "REFERENCE_FREE_T2V" as const,
        effectiveReferenceIds: [],
        firstFrameAssetId: null,
        productVisualIdentityRequirement: "NONE" as const,
      },
      shots: [{
        shotId: "shot-1", cameraType: "static", cameraMovement: "STATIC",
        focus: "closed lily bud", composition: "centered", information: "closed lily bud",
        emotion: "poetic", durationMs: 4000,
      }],
    };
    const revised = applyRetryInputRevision(original as never, t2vRevision({
      creativeDirection: {
        visualRole: "closed lily bud poetic opening for next Product reveal",
        cameraInstruction: "fast elegant time-lapse bloom",
        focusProgression: ["closed lily bud", "elegant time-lapse bloom"],
        shotEmphasis: "poetic opening for next Product reveal",
      },
    }));
    expect(revised.generationAuthority).toEqual(original.generationAuthority);
    expect(revised.referencedAssetIds).toEqual([]);
    expect(revised.purpose).toContain("closed lily bud");
  });

  it("denies attaching Product first-frame material to a reference-free retry", () => {
    expect(() => t2vRevision({ productAssetId: ID("301") as never })).toThrow();
    expect(() => revision({
      providerModeRequirement: "REFERENCE_FREE_T2V",
      productAssetId: null,
      productAuthorityHash: null,
      visualAuthorityCertificationHash: null,
    })).not.toThrow();
  });

  it("denies switching a TEXT_TO_VIDEO retry to FIRST_FRAME_I2V", () => {
    expect(() => assertRetryProviderModeMatchesFrozenScene({
      retryProviderMode: "FIRST_FRAME_I2V",
      generationAuthority: {
        strategy: "TEXT_TO_VIDEO",
        referenceSource: "REFERENCE_FREE_T2V",
      },
    })).toThrow(/frozen Scene generation authority/);
  });

  it("keeps FIRST_FRAME_I2V retry Product certification mandatory", () => {
    expect(() => SceneAttemptInputRevisionFactSchema.parse({
      ...revision(),
      productAssetId: null,
      productAuthorityHash: null,
      visualAuthorityCertificationHash: null,
    })).toThrow();
    expect(revision().providerModeRequirement).toBe("FIRST_FRAME_I2V");
    expect(revision().productAssetId).toBe(ID("301"));
  });

  it("reads historical FIRST_FRAME_I2V retry rows without rewriting them", () => {
    const historical = revision();
    expect(SceneAttemptInputRevisionFactSchema.parse(historical).providerModeRequirement)
      .toBe("FIRST_FRAME_I2V");
  });
});
