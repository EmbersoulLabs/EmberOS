import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  AiStoryGenerationResult,
  AiStoryGenerationResultDecision,
  AiStoryLocalGenerationPackage,
  AiStoryPostGenerationQcEvaluation,
} from "@ceo-agent/shared";
import { materializeSequentialLocalPackageV3 } from "../packages/agents/src/ai-story/sequential-local-generation";
import { materializeSequentialSupersessionPackage } from "../packages/agents/src/ai-story/generation-result-service";
import { selectStaleSequentialDescendants } from "../packages/db/src/queries/ai-story-sequential-local-release";

const id = (value: number) =>
  `70000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const hash = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const now = "2026-10-05T00:00:00.000Z";

type V2 = Extract<
  AiStoryLocalGenerationPackage,
  { version: "local-generation-package.v2" }
>;

function base(order: number, workflow = "MINIMAX_H3_NATIVE_DIALOGUE"): V2 {
  return {
    version: "local-generation-package.v2",
    packageId: id(100 + order),
    packageFingerprint: hash(`v2-${order}`),
    executionMode: "MANUAL_LOCAL",
    organizationId: id(1),
    workspaceId: id(2),
    campaignId: id(3),
    storyId: id(4),
    storyVersionId: id(5),
    executionPlanId: id(6),
    runtimeAuthorizationId: id(7),
    unitId: id(20 + order),
    sceneExecutionId: id(20 + order),
    sceneId: id(30 + order),
    order,
    durationSec: 5,
    aspectRatio: "9:16",
    resolutionIntent: "720p",
    recommendedWorkflow: workflow as V2["recommendedWorkflow"],
    generationMode: "TEXT_TO_VIDEO",
    prompt: `Unit ${order}`,
    negativePrompt: "",
    dialogue: [{
      speakerLabel: "Authorized Character",
      text: "Continue exactly.",
      offscreen: false,
      locale: "en-SG",
    }],
    generateAudio: true,
    audioBlocked: false,
    characterAuthority: {
      characterId: id(40),
      characterVersionId: id(41),
      dnaFingerprint: hash("character"),
      sourcePhotoSentToVideoProvider: false,
    },
    productAuthority: null,
    worldDescription: "Authorized world",
    mustKeep: ["Identity"],
    mustAvoid: ["Substitution"],
    qcRequirements: [],
    continuityRequirements: ["Continue exactly"],
    previousUnitEndState: [],
    currentUnitStartState: [],
    expectedEndState: [],
    references: [],
    sourceAuthority: {
      version: "ai-story-local-generation-source-authority.v2",
      localSourceAuthorityId: id(50 + order),
      localSourceAuthorityFingerprint: hash(`source-${order}`),
      orgId: id(1),
      workspaceId: id(2),
      campaignId: id(3),
      storyId: id(4),
      storyVersionId: id(5),
      executionPlanId: id(6),
      runtimeAuthorizationId: id(7),
      sceneExecutionId: id(20 + order),
      sceneExecutionFingerprint: hash(`execution-${order}`),
      instructionContentHash: hash(`instructions-${order}`),
      sceneVersionId: id(60 + order),
      sceneFingerprint: hash(`scene-${order}`),
      generationAuthority: {
        strategy: "TEXT_TO_VIDEO",
        referenceSource: "REFERENCE_FREE_T2V",
        effectiveReferenceIds: [],
        firstFrameAssetId: null,
        productVisualIdentityRequirement: "NONE",
      },
      generationAuthorityFingerprint: hash(`generation-${order}`),
      preGenerationQcEvaluationId: id(70 + order),
      preGenerationQcFingerprint: hash(`pre-qc-${order}`),
      directorFingerprint: hash("director"),
      motionFingerprint: hash("motion"),
      scriptVersionId: id(80),
      handoffId: id(81),
      handoffFingerprint: hash("handoff"),
      characterAuthorityFingerprint: hash("character"),
      worldAuthorityFingerprint: hash("world"),
      productMaterialFingerprint: hash("no-product"),
      productMaterialSelection: null,
    },
    planningAuthority: {
      planningLineageSource: "FROZEN_SCRIPT_DIRECTOR",
      sceneVersion: 1,
      scriptVersionId: id(80),
      handoffId: id(81),
      handoffFingerprint: hash("handoff"),
    },
    instructions: `Generate Unit ${order}`,
    state: "AWAITING_LOCAL_OUTPUT",
    retryOfPackageId: null,
    retryNumber: 0,
    createdAt: now,
  };
}

function initial(order = 1) {
  return materializeSequentialLocalPackageV3({
    basePackage: base(order),
    release: { releaseRevision: 0, releasedBy: id(90), releasedAt: now },
    predecessor: null,
  });
}

function evidence(predecessor = initial(), overrides: Record<string, unknown> = {}) {
  const result = {
    generationResultId: id(200 + predecessor.order),
    generationUnitId: predecessor.unitId,
    sceneExecutionId: predecessor.sceneExecutionId,
    runtimeAuthorizationId: predecessor.runtimeAuthorizationId,
    ownership: {
      orgId: predecessor.organizationId,
      workspaceId: predecessor.workspaceId,
      campaignId: predecessor.campaignId,
      storyId: predecessor.storyId,
      storyVersionId: predecessor.storyVersionId,
      animationPackageId: id(300),
      executionPlanId: predecessor.executionPlanId,
    },
    inputAuthority: {
      localPackageId: predecessor.packageId,
      localPackageFingerprint: predecessor.packageFingerprint,
    },
    source: {
      sourceKind: "MANUAL_LOCAL",
      providerAttemptId: null,
      localGenerationOutputId: id(350 + predecessor.order),
      localWorkerOutputId: null,
    },
    media: {
      assetId: id(400 + predecessor.order),
      contentHash: hash(`output-${predecessor.order}`),
    },
  } as unknown as AiStoryGenerationResult;
  const postQc = {
    postQcEvaluationId: id(500 + predecessor.order),
    orgId: predecessor.organizationId,
    workspaceId: predecessor.workspaceId,
    generationResultId: result.generationResultId,
    sourceKind: "MANUAL_LOCAL",
    mediaContentHash: result.media.contentHash,
    eligibleForHumanReview: true,
    aggregateStatus: "POST_QC_PASS",
  } as unknown as AiStoryPostGenerationQcEvaluation;
  const decision = {
    decisionId: id(600 + predecessor.order),
    generationResultId: result.generationResultId,
    postQcEvaluationId: postQc.postQcEvaluationId,
    decision: "APPROVED",
  } as unknown as AiStoryGenerationResultDecision;
  return {
    predecessorPackage: predecessor,
    generationResult: result,
    postQc,
    decision,
    frame: {
      frameAssetId: id(700 + predecessor.order),
      contentHash: hash(`frame-${predecessor.order}`),
      sourceContentHash: result.media.contentHash,
      extractionContractVersion: "ai-story-continuity-frame-extraction.v1",
      extractedAt: now,
    },
    ...overrides,
  };
}

function successor(order: number, predecessor = initial()) {
  return materializeSequentialLocalPackageV3({
    basePackage: base(order),
    release: {
      releaseRevision: 1,
      releasedBy: id(90),
      releasedAt: now,
    },
    predecessor: evidence(predecessor),
  });
}

describe("Sequential Local V3 Phase 2 A-L", () => {
  it("A — materializes only an initial Unit without predecessor authority", () => {
    const pkg = initial();
    expect(pkg.order).toBe(1);
    expect(pkg.predecessorAuthority).toBeNull();
    expect(pkg.releaseAuthority.semantic.gateKind).toBe("INITIAL_UNIT");
  });

  it("B — keeps canonical T2V while binding predecessor continuity", () => {
    const pkg = successor(2);
    expect(pkg.generationMode).toBe("TEXT_TO_VIDEO");
    expect(pkg.sourceAuthority.generationAuthority.strategy).toBe("TEXT_TO_VIDEO");
    expect(pkg.visualStartAuthority.sourceType).toBe("PREDECESSOR_CONTINUITY");
    expect(pkg.recommendedWorkflow).toBe("MINIMAX_H3_NATIVE_DIALOGUE");
  });

  it("C — fails closed for an uncertified local workflow", () => {
    expect(() => materializeSequentialLocalPackageV3({
      basePackage: base(1, "WAN_T2V"),
      release: { releaseRevision: 0, releasedBy: id(90), releasedAt: now },
      predecessor: null,
    })).toThrow("LOCAL_WORKFLOW_CERTIFICATION_REQUIRED");
  });

  it("D — requires the exact immediate predecessor order", () => {
    expect(() => successor(3)).toThrow("SEQUENTIAL_LOCAL_PREDECESSOR_SCOPE_MISMATCH");
  });

  it("E — rejects cross-Story predecessor authority", () => {
    const proof = evidence();
    proof.generationResult.ownership.storyId = id(999);
    expect(() => materializeSequentialLocalPackageV3({
      basePackage: base(2),
      release: { releaseRevision: 1, releasedBy: id(90), releasedAt: now },
      predecessor: proof,
    })).toThrow("SEQUENTIAL_LOCAL_PREDECESSOR_SCOPE_MISMATCH");
  });

  it("F — rejects cross-version predecessor authority", () => {
    const proof = evidence();
    proof.generationResult.ownership.storyVersionId = id(999);
    expect(() => materializeSequentialLocalPackageV3({
      basePackage: base(2),
      release: { releaseRevision: 1, releasedBy: id(90), releasedAt: now },
      predecessor: proof,
    })).toThrow("SEQUENTIAL_LOCAL_PREDECESSOR_SCOPE_MISMATCH");
  });

  it("G — rejects a stale predecessor package fingerprint", () => {
    const proof = evidence();
    proof.generationResult.inputAuthority.localPackageFingerprint = hash("stale");
    expect(() => materializeSequentialLocalPackageV3({
      basePackage: base(2),
      release: { releaseRevision: 1, releasedBy: id(90), releasedAt: now },
      predecessor: proof,
    })).toThrow("SEQUENTIAL_LOCAL_PREDECESSOR_SCOPE_MISMATCH");
  });

  it("H — requires successful Post-QC", () => {
    const proof = evidence();
    proof.postQc.aggregateStatus = "POST_QC_REJECT";
    expect(() => materializeSequentialLocalPackageV3({
      basePackage: base(2),
      release: { releaseRevision: 1, releasedBy: id(90), releasedAt: now },
      predecessor: proof,
    })).toThrow("SEQUENTIAL_LOCAL_PREDECESSOR_APPROVAL_REQUIRED");
  });

  it("I — requires an approved immutable decision", () => {
    const proof = evidence();
    proof.decision.decision = "REJECTED";
    expect(() => materializeSequentialLocalPackageV3({
      basePackage: base(2),
      release: { releaseRevision: 1, releasedBy: id(90), releasedAt: now },
      predecessor: proof,
    })).toThrow("SEQUENTIAL_LOCAL_PREDECESSOR_APPROVAL_REQUIRED");
  });

  it("J — binds the frame to predecessor output content", () => {
    const proof = evidence();
    proof.frame.sourceContentHash = hash("wrong-output");
    expect(() => materializeSequentialLocalPackageV3({
      basePackage: base(2),
      release: { releaseRevision: 1, releasedBy: id(90), releasedAt: now },
      predecessor: proof,
    })).toThrow("SEQUENTIAL_LOCAL_CONTINUITY_FRAME_MISMATCH");
  });

  it("K — converges identical authority and changes on frame lineage", () => {
    const first = successor(2);
    const replay = successor(2);
    const changedProof = evidence();
    changedProof.frame.contentHash = hash("replacement-frame");
    const changed = materializeSequentialLocalPackageV3({
      basePackage: base(2),
      release: { releaseRevision: 1, releasedBy: id(90), releasedAt: now },
      predecessor: changedProof,
    });
    expect(replay.packageId).toBe(first.packageId);
    expect(changed.packageId).not.toBe(first.packageId);
  });

  it("L — recursively materializes three Units with adjacent lineage only", () => {
    const one = initial();
    const two = successor(2, one);
    const three = materializeSequentialLocalPackageV3({
      basePackage: base(3),
      release: { releaseRevision: 1, releasedBy: id(90), releasedAt: now },
      predecessor: evidence(two),
    });
    expect([
      one.predecessorAuthority?.semantic.predecessorPackageId ?? null,
      two.predecessorAuthority?.semantic.predecessorPackageId,
      three.predecessorAuthority?.semantic.predecessorPackageId,
    ]).toEqual([null, one.packageId, two.packageId]);
    expect(selectStaleSequentialDescendants([
      { sceneExecutionId: one.sceneExecutionId, sceneOrder: 1, gateGenerationResultId: null },
      { sceneExecutionId: two.sceneExecutionId, sceneOrder: 2, gateGenerationResultId: id(901) },
      { sceneExecutionId: three.sceneExecutionId, sceneOrder: 3, gateGenerationResultId: id(902) },
      { sceneExecutionId: id(24), sceneOrder: 4, gateGenerationResultId: id(903) },
    ], 1, id(999))).toEqual([
      two.sceneExecutionId,
      three.sceneExecutionId,
      id(24),
    ]);
    const replacement = materializeSequentialSupersessionPackage(
      one,
      evidence(one).generationResult,
      "Operator-authorized correction",
    );
    expect(replacement.retryOfPackageId).toBe(one.packageId);
    expect(replacement.packageId).not.toBe(one.packageId);
    expect(replacement.releaseAuthority).toEqual(one.releaseAuthority);
  });
});
