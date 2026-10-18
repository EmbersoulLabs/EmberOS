import { describe, expect, it } from "vitest";
import type { AiStoryPostGenerationQcEvaluation, AiStoryPostQcRequirement } from "@ceo-agent/shared";
import {
  buildChangeObservation,
  explicitCheckObservations,
  formatChangeSummary,
  looksGoodDecision,
  plainReviewError,
  sceneProgressLabel,
  validateChangeWindow,
} from "../apps/web/src/components/ai-story/simple-video-review";

const requirements: AiStoryPostQcRequirement[] = [
  { requirementId: "output-integrity", dimension: "OUTPUT_INTEGRITY", summary: "Readable video", required: true, waiverPolicy: "NON_WAIVABLE_INTEGRITY", sourceOwner: "POST_PROCESSING", visuallyObservable: false },
  { requirementId: "product-identity", dimension: "PRODUCT_FIDELITY", summary: "Preserve the product", required: true, waiverPolicy: "NON_WAIVABLE_INTEGRITY", sourceOwner: "PRODUCT_AUTHORITY", visuallyObservable: true },
  { requirementId: "character-identity", dimension: "CHARACTER_FIDELITY", summary: "Preserve the person", required: true, waiverPolicy: "NON_WAIVABLE_INTEGRITY", sourceOwner: "CHARACTER_AUTHORITY", visuallyObservable: true },
  { requirementId: "scene-action:0", dimension: "ACTION_COMPLETION", summary: "She turns the fan on", required: true, waiverPolicy: "NON_WAIVABLE_INTEGRITY", sourceOwner: "SCENE", visuallyObservable: true },
  { requirementId: "director:0", dimension: "DIRECTOR_EXECUTION", summary: "Slow push in", required: true, waiverPolicy: "WAIVABLE_BY_HUMAN", sourceOwner: "DIRECTOR", visuallyObservable: true },
  { requirementId: "must-keep:0", dimension: "MUST_KEEP", summary: "Show the pink fan", required: true, waiverPolicy: "NON_WAIVABLE_INTEGRITY", sourceOwner: "SCENE", visuallyObservable: true },
];

function evaluation(findings: AiStoryPostGenerationQcEvaluation["findings"]): AiStoryPostGenerationQcEvaluation {
  return {
    postQcEvaluationId: "11111111-1111-4111-8111-111111111111",
    contractVersion: "ai-story-post-generation-qc.v1",
    policyVersion: "ai-story-post-qc-policy.2026-09-20.v2",
    evaluationVersion: 1,
    postQcInputId: "22222222-2222-4222-8222-222222222222",
    orgId: "33333333-3333-4333-8333-333333333333",
    workspaceId: "44444444-4444-4444-8444-444444444444",
    providerAttemptId: null,
    generationResultId: "55555555-5555-4555-8555-555555555555",
    sourceKind: "LOCAL_GPU_WORKER",
    mediaAssetId: "66666666-6666-4666-8666-666666666666",
    mediaContentHash: `sha256:${"a".repeat(64)}`,
    sceneExecutionId: "77777777-7777-4777-8777-777777777777",
    sceneFingerprint: `sha256:${"b".repeat(64)}`,
    compiledRequestFingerprint: null,
    generationMode: "TEXT_TO_VIDEO",
    observations: [],
    findings,
    aggregateStatus: "POST_QC_PASS",
    evidenceUnavailable: false,
    eligibleForHumanReview: true,
    autoApproved: false,
    autoRetryAuthorized: false,
    autoReleaseAuthorized: false,
    creativeAuthority: false,
    evaluationFingerprint: `sha256:${"c".repeat(64)}`,
    evaluatedAt: "2026-10-18T00:00:00.000Z",
  };
}

describe("simple video review", () => {
  it("names the scene in plain progress text", () => {
    expect(sceneProgressLabel(1, 3)).toBe("Scene 1 of 3");
  });

  it("does not turn Looks Good into fabricated check results", () => {
    expect(looksGoodDecision({ evaluation: null, requirements }).action).toBe("explain");
    const observations = explicitCheckObservations({
      requirements,
      signals: { "product-identity": "SATISFIED" },
      observationIdFor: () => "88888888-8888-4888-8888-888888888888",
    });
    expect(observations).toHaveLength(1);
    expect(observations.map((item) => item.requirementId)).toEqual(["product-identity"]);
    expect(observations.every((item) => item.observableSignal === "SATISFIED" && item.source === "HUMAN_SUPPLIED_EVIDENCE")).toBe(true);
  });

  it("blocks Looks Good while a required check is still unconfirmed", () => {
    const decision = looksGoodDecision({
      evaluation: evaluation([{
        findingId: "99999999-9999-4999-8999-999999999999",
        requirementId: "product-identity",
        dimension: "PRODUCT_FIDELITY",
        result: "UNVERIFIED",
        reason: "Required fact could not be safely verified.",
        evidenceIds: [],
        confidence: "LOW",
        failureClass: "PRODUCT_IDENTITY_DRIFT",
        repairOwner: "PROVIDER_EXECUTION",
        waiverPolicy: "NON_WAIVABLE_INTEGRITY",
        sameInputRetryCandidate: false,
      }]),
      requirements,
    });
    expect(decision.action).toBe("explain");
  });

  it("allows Looks Good only after the saved check can be accepted", () => {
    const decision = looksGoodDecision({
      evaluation: evaluation([{
        findingId: "99999999-9999-4999-8999-999999999999",
        requirementId: "product-identity",
        dimension: "PRODUCT_FIDELITY",
        result: "PASS",
        reason: "The product matches.",
        evidenceIds: [],
        confidence: "HIGH",
        failureClass: null,
        repairOwner: "PROVIDER_EXECUTION",
        waiverPolicy: "NON_WAIVABLE_INTEGRITY",
        sameInputRetryCandidate: false,
      }]),
      requirements,
    });
    expect(decision).toEqual({ action: "approve" });
  });

  it("stores one change request on the matching check, with the selected time range", () => {
    const built = buildChangeObservation({
      observationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      requirements,
      category: "product",
      startSec: 1.2,
      endSec: 3.4,
      summary: formatChangeSummary({ category: "product", startSec: 1.2, endSec: 3.4, explanation: "The logo is blurry." }),
      durationSec: 5,
    });
    expect("observation" in built).toBe(true);
    if (!("observation" in built)) return;
    expect(built.observation.requirementId).toBe("product-identity");
    expect(built.observation.observableSignal).toBe("VIOLATED");
    expect(built.observation.timeRangeMs).toEqual({ start: 1200, end: 3400 });
    expect(built.observation.subjectiveTasteOnly).toBe(false);
    expect(String(built.observation.summary)).toContain("The logo is blurry.");
  });

  it("keeps an audio note on the general visible check and says there is no separate sound check", () => {
    const built = buildChangeObservation({
      observationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      requirements,
      category: "audio",
      startSec: 0,
      endSec: 2,
      summary: "Audio needs changes from 0:00–0:02. The music is too loud.",
      durationSec: 5,
    });
    expect("observation" in built).toBe(true);
    if (!("observation" in built)) return;
    expect(built.observation.requirementId).toBe("must-keep:0");
    expect(built.observation.subjectiveTasteOnly).toBe(true);
    expect(built.limitation).toContain("no separate sound check");
  });

  it("rejects a time range that ends before it starts", () => {
    expect(validateChangeWindow(3, 1, 5)).toBe("The end time needs to be after the start time.");
    expect(plainReviewError("COMMERCIAL_AUDIO_ASSEMBLY_REQUIRED", "raw")).toContain("music");
    expect(plainReviewError("UNAUTHORIZED", "raw")).toContain("permission");
  });
});
