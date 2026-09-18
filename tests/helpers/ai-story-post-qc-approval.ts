/** Synthetic immutable QC evidence for review-boundary tests only. */
import {
  AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
  AI_STORY_POST_QC_POLICY_VERSION,
  AiStoryPostGenerationQcEvaluationSchema,
  type AiStoryPostGenerationQcEvaluation,
} from "@ceo-agent/shared";

const id = (n: number) => `a1000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = `sha256:${"a".repeat(64)}`;

export function approvalQcEvaluation(
  providerAttemptId: string,
  result: "PASS" | "WARN" | "REJECT" = "PASS",
  waiverPolicy: "WAIVABLE_BY_HUMAN" | "NON_WAIVABLE_INTEGRITY" = "WAIVABLE_BY_HUMAN",
): AiStoryPostGenerationQcEvaluation {
  return AiStoryPostGenerationQcEvaluationSchema.parse({
    postQcEvaluationId: id(1),
    contractVersion: AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
    policyVersion: AI_STORY_POST_QC_POLICY_VERSION,
    evaluationVersion: 1,
    postQcInputId: id(2), orgId: id(3), workspaceId: id(4),
    providerAttemptId, mediaAssetId: id(5), mediaContentHash: hash,
    sceneExecutionId: id(6), sceneFingerprint: hash,
    compiledRequestFingerprint: hash, generationMode: "TEXT_TO_VIDEO",
    observations: [],
    findings: result === "PASS" ? [] : [{
      findingId: id(7), requirementId: "fixture-integrity", dimension: "OUTPUT_INTEGRITY",
      result, reason: "Synthetic review-boundary finding", evidenceIds: [],
      confidence: "HIGH", failureClass: result === "REJECT" ? "OUTPUT_INTEGRITY_FAILURE" : null,
      repairOwner: "POST_PROCESSING", waiverPolicy, sameInputRetryCandidate: false,
    }],
    aggregateStatus: result === "REJECT" ? "POST_QC_REJECT" : result === "WARN" ? "POST_QC_WARN" : "POST_QC_PASS",
    evidenceUnavailable: false, eligibleForHumanReview: true,
    autoApproved: false, autoRetryAuthorized: false, autoReleaseAuthorized: false,
    creativeAuthority: false, evaluationFingerprint: hash,
    evaluatedAt: "2026-09-18T00:00:00.000Z",
  });
}

export function approvalQcRepository(
  evaluation: AiStoryPostGenerationQcEvaluation | null = null,
) {
  return {
    async getLatestByProviderAttemptIds(input: {
      workspaceId: string;
      providerAttemptIds: readonly string[];
    }): Promise<ReadonlyMap<string, AiStoryPostGenerationQcEvaluation>> {
      void input.workspaceId;
      return evaluation && input.providerAttemptIds.includes(evaluation.providerAttemptId)
        ? new Map([[evaluation.providerAttemptId, evaluation]])
        : new Map();
    },
  };
}
