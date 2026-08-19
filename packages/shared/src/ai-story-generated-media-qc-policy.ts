/**
 * EMBEROS-AI-STORY-EXEC-06 — AI Story Self-Use V1 generated-media QC policy freeze.
 *
 * OPTION B: Plan/intent AI QC is authoritative for planning/structural validation
 * only. Generated-media acceptance is EXEC-04 persisted human Scene review.
 * This module does not implement media-aware QC, vision models, frame sampling,
 * or provider QC calls.
 *
 * Future-compatible extension (not implemented):
 *   generated artifact
 *   → optional automated media QC evidence
 *   → mandatory/optional human review policy
 *   → approved output
 */
import { z } from "zod";
import {
  GeneratedSceneReviewFactSchema,
  type GeneratedSceneReviewFact,
  type GeneratedSceneReviewState,
} from "./ai-story-generated-scene-review";

export const AI_STORY_V1_QC_POLICY =
  "OPTION_B_PLAN_QC_PLUS_HUMAN_REVIEW" as const;

export const GENERATED_MEDIA_ACCEPTANCE_AUTHORITY =
  "EXEC04_PERSISTED_SCENE_REVIEW" as const;

export const PLAN_QC_SCOPE = "planning_intent_structural_only" as const;

export const FUTURE_MEDIA_AWARE_QC_PIPELINE = [
  "generated_artifact",
  "optional_automated_media_qc_evidence",
  "human_review_policy",
  "approved_output",
] as const;

export type FutureMediaAwareQcPipelineStep =
  (typeof FUTURE_MEDIA_AWARE_QC_PIPELINE)[number];

/** V1 QC must never autonomously enqueue a paid provider retry. */
export const AI_STORY_V1_QC_MAY_ENQUEUE_PROVIDER_RETRY = false;

export const ASSEMBLY_ELIGIBLE_GENERATED_MEDIA_REVIEW_STATE =
  "APPROVED" as const;

export function generatedMediaReviewAllowsAssembly(
  state: GeneratedSceneReviewState | null | undefined
): boolean {
  return state === ASSEMBLY_ELIGIBLE_GENERATED_MEDIA_REVIEW_STATE;
}

export function planQcPassApprovesGeneratedMedia(): false {
  return false;
}

export const FinalStoryResultAssembledSceneProvenanceSchema = z
  .object({
    sceneExecutionId: z.string().uuid(),
    providerAttemptId: z.string().min(1),
    sceneResultId: z.string().uuid(),
    generatedMediaReviewState: z.literal("APPROVED"),
  })
  .strict();

export type FinalStoryResultAssembledSceneProvenance = z.infer<
  typeof FinalStoryResultAssembledSceneProvenanceSchema
>;

export const FinalStoryResultQcProvenanceSchema = z
  .object({
    policy: z.literal(AI_STORY_V1_QC_POLICY),
    planQcScope: z.literal(PLAN_QC_SCOPE),
    generatedMediaAcceptanceAuthority: z.literal(
      GENERATED_MEDIA_ACCEPTANCE_AUTHORITY
    ),
    mediaAwareAiQcClaimed: z.literal(false),
    assemblyComplete: z.boolean(),
    assembledScenes: z.array(FinalStoryResultAssembledSceneProvenanceSchema),
    allAssembledScenesHumanApproved: z.boolean(),
  })
  .strict();

export type FinalStoryResultQcProvenance = z.infer<
  typeof FinalStoryResultQcProvenanceSchema
>;

export type GeneratedMediaAssemblyEligibilityReason =
  | "ALL_SCENES_APPROVED"
  | "PARTIAL_SCENE_APPROVAL"
  | "UNREVIEWED_MEDIA"
  | "RETRY_REQUESTED"
  | "REJECTED_TERMINAL"
  | "MISSING_APPROVAL_BINDING";

export type GeneratedMediaAssemblyEligibility = {
  readonly eligible: boolean;
  readonly reason: GeneratedMediaAssemblyEligibilityReason;
  readonly approvedBindings: readonly FinalStoryResultAssembledSceneProvenance[];
};

function reviewsForScene(
  sceneExecutionId: string,
  reviews: readonly GeneratedSceneReviewFact[]
): GeneratedSceneReviewFact[] {
  return reviews.filter((review) => review.sceneExecutionId === sceneExecutionId);
}

/**
 * Assembly is eligible only when every required Scene has an APPROVED
 * exact (sceneExecutionId, providerAttemptId, sceneResultId) binding.
 * An older RETRY_REQUESTED row does not override a later APPROVED attempt.
 */
export function deriveGeneratedMediaAssemblyEligibility(input: {
  readonly requiredSceneExecutionIds: readonly string[];
  readonly reviews: readonly GeneratedSceneReviewFact[];
}): GeneratedMediaAssemblyEligibility {
  const approvedBindings: FinalStoryResultAssembledSceneProvenance[] = [];
  let pending = 0;
  let retryRequested = 0;
  let rejected = 0;
  let missingBinding = 0;

  for (const sceneExecutionId of input.requiredSceneExecutionIds) {
    const sceneReviews = reviewsForScene(sceneExecutionId, input.reviews);
    const approved = sceneReviews.filter((review) => review.decision === "APPROVED");
    if (
      approved.length === 1 &&
      approved[0]?.sceneResultId &&
      approved[0].providerAttemptId
    ) {
      approvedBindings.push({
        sceneExecutionId: approved[0].sceneExecutionId,
        providerAttemptId: approved[0].providerAttemptId,
        sceneResultId: approved[0].sceneResultId,
        generatedMediaReviewState: "APPROVED",
      });
      continue;
    }
    if (approved.length > 1) {
      missingBinding += 1;
      continue;
    }
    if (sceneReviews.some((review) => review.decision === "REJECTED_TERMINAL")) {
      rejected += 1;
      continue;
    }
    if (sceneReviews.some((review) => review.decision === "PENDING_REVIEW")) {
      pending += 1;
      continue;
    }
    if (sceneReviews.some((review) => review.decision === "RETRY_REQUESTED")) {
      retryRequested += 1;
      continue;
    }
    if (sceneReviews.length === 0) {
      pending += 1;
      continue;
    }
    missingBinding += 1;
  }

  if (
    approvedBindings.length === input.requiredSceneExecutionIds.length &&
    pending === 0 &&
    retryRequested === 0 &&
    rejected === 0 &&
    missingBinding === 0
  ) {
    return {
      eligible: true,
      reason: "ALL_SCENES_APPROVED",
      approvedBindings,
    };
  }
  if (rejected > 0) {
    return { eligible: false, reason: "REJECTED_TERMINAL", approvedBindings };
  }
  if (retryRequested > 0) {
    return { eligible: false, reason: "RETRY_REQUESTED", approvedBindings };
  }
  if (missingBinding > 0) {
    return {
      eligible: false,
      reason: "MISSING_APPROVAL_BINDING",
      approvedBindings,
    };
  }
  if (approvedBindings.length > 0 && pending > 0) {
    return {
      eligible: false,
      reason: "PARTIAL_SCENE_APPROVAL",
      approvedBindings,
    };
  }
  return { eligible: false, reason: "UNREVIEWED_MEDIA", approvedBindings };
}

export function reconstructFinalStoryResultQcProvenance(input: {
  readonly orderedSceneResultIds: readonly string[];
  readonly reviews: readonly GeneratedSceneReviewFact[];
}): FinalStoryResultQcProvenance {
  const approvedByResultId = new Map<string, GeneratedSceneReviewFact>();
  for (const review of input.reviews) {
    if (
      review.decision === "APPROVED" &&
      review.sceneResultId &&
      review.providerAttemptId
    ) {
      approvedByResultId.set(review.sceneResultId, review);
    }
  }

  const assembledScenes: FinalStoryResultAssembledSceneProvenance[] = [];
  for (const sceneResultId of input.orderedSceneResultIds) {
    const review = approvedByResultId.get(sceneResultId);
    if (!review || !review.sceneResultId) continue;
    assembledScenes.push({
      sceneExecutionId: review.sceneExecutionId,
      providerAttemptId: review.providerAttemptId,
      sceneResultId: review.sceneResultId,
      generatedMediaReviewState: "APPROVED",
    });
  }

  return FinalStoryResultQcProvenanceSchema.parse({
    policy: AI_STORY_V1_QC_POLICY,
    planQcScope: PLAN_QC_SCOPE,
    generatedMediaAcceptanceAuthority: GENERATED_MEDIA_ACCEPTANCE_AUTHORITY,
    mediaAwareAiQcClaimed: false,
    assemblyComplete: input.orderedSceneResultIds.length > 0,
    assembledScenes,
    allAssembledScenesHumanApproved:
      assembledScenes.length === input.orderedSceneResultIds.length &&
      input.orderedSceneResultIds.length > 0,
  });
}

export function parseGeneratedSceneReviewFacts(
  value: unknown
): GeneratedSceneReviewFact[] {
  return z.array(GeneratedSceneReviewFactSchema).parse(value);
}
