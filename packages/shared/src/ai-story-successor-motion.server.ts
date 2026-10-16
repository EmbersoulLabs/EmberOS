import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import {
  AiStorySuccessorMotionReviewSchema,
  SUCCESSOR_MOTION_LATEST_CREATIVE_DECISION,
  SUCCESSOR_MOTION_SCENE_1_CREATIVE_DECISION,
  SUCCESSOR_MOTION_SCENE_3_CREATIVE_DECISION,
  SUCCESSOR_MOTION_SUPERSEDED_DECISION,
  type AiStorySuccessorMotionIssue,
  type AiStorySuccessorMotionReview,
  type AiStorySuccessorMotionSceneDecision,
} from "./ai-story-successor-motion";
import {
  AiStoryEpisodeProjectedMotionPlanSchema,
  type AiStoryEpisodeProjectedMotionPlan,
  type AiStoryEpisodeProjectedMotionScene,
} from "./ai-story-episode-projected-authority";

function normalized(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function validateSuccessorMotionReview(
  base: AiStoryEpisodeProjectedMotionPlan,
  review: AiStorySuccessorMotionReview,
): AiStorySuccessorMotionIssue[] {
  const issues: AiStorySuccessorMotionIssue[] = [];
  if (review.latestCreativeDecision !== SUCCESSOR_MOTION_LATEST_CREATIVE_DECISION || review.supersededDecision !== SUCCESSOR_MOTION_SUPERSEDED_DECISION) {
    issues.push({ code: "CREATIVE_DECISION_SCOPE_MISMATCH", sceneOrder: null, message: "The Successor review must preserve the exact latest and superseded creative-decision scope." });
  }
  const orders = review.scenes.map((scene) => scene.sceneOrder).sort((a, b) => a - b);
  if (orders.length !== 2 || orders[0] !== 0 || orders[1] !== 2) {
    issues.push({ code: "TARGET_SCENES_INVALID", sceneOrder: null, message: "Successor review must resolve Scene 1 and Scene 3 exactly." });
  }
  for (const decision of review.scenes) {
    const expectedDecision = decision.sceneOrder === 0 ? SUCCESSOR_MOTION_SCENE_1_CREATIVE_DECISION : decision.sceneOrder === 2 ? SUCCESSOR_MOTION_SCENE_3_CREATIVE_DECISION : null;
    if (!expectedDecision || decision.creativeDecision !== expectedDecision) {
      issues.push({ code: "CREATIVE_DECISION_SCOPE_MISMATCH", sceneOrder: decision.sceneOrder, message: "The Scene review must preserve the exact revised creative intent." });
    }
    const scene = base.sceneMotionPlans.find((item) => item.scriptSceneId === decision.scriptSceneId && item.sceneOrder === decision.sceneOrder);
    if (!scene) {
      issues.push({ code: "TARGET_SCENES_INVALID", sceneOrder: decision.sceneOrder, message: "Reviewed Scene does not belong to the frozen Motion authority." });
      continue;
    }
    if (!scene.productBindingIds.includes(decision.productAuthorityId)) {
      issues.push({ code: "PRODUCT_AUTHORITY_MISMATCH", sceneOrder: decision.sceneOrder, message: "Reviewed Product does not match the frozen Scene product binding." });
    }
    if (decision.worldStateAtEntry !== "PRESENT" || decision.worldStateAtExit !== "PRESENT") {
      issues.push({ code: "WORLD_STATE_REQUIRES_UPSTREAM_REVISION", sceneOrder: decision.sceneOrder, message: "Object absence from the story world requires an upstream Script/Scene revision; leaving frame is not absence." });
    }
    if (decision.identityOutcome === "IDENTITY_REPLACED_OR_DESTROYED") {
      issues.push({ code: "IDENTITY_CHANGE_REQUIRES_UPSTREAM_REVISION", sceneOrder: decision.sceneOrder, message: "Replacement or destruction is not authorized by the frozen Script/Scene lineage." });
    }
    if (decision.identityOutcome === "APPEARANCE_CHANGED_IDENTITY_PRESERVED") {
      issues.push({ code: "PHYSICAL_CHANGE_REQUIRES_UPSTREAM_REVISION", sceneOrder: decision.sceneOrder, message: "An approved appearance change still requires an explicit upstream physical-state delta, even when product identity is preserved." });
    }
    if (normalized(decision.physicalConditionAtEntry) !== normalized(decision.physicalConditionAtExit)) {
      issues.push({ code: "PHYSICAL_CHANGE_REQUIRES_UPSTREAM_REVISION", sceneOrder: decision.sceneOrder, message: "A physical condition delta requires a matching frozen Script and Canonical Scene delta." });
    }
    if (normalized(decision.ownershipAtEntry) !== normalized(decision.ownershipAtExit)) {
      issues.push({ code: "OWNERSHIP_CHANGE_REQUIRES_UPSTREAM_REVISION", sceneOrder: decision.sceneOrder, message: "An ownership transfer requires a matching frozen Script and Canonical Scene delta." });
    }
    const canonicalActions = scene.actions.map((action) => normalized(action.semanticAction));
    if (JSON.stringify(decision.actionProgression.map(normalized)) !== JSON.stringify(canonicalActions)) {
      issues.push({ code: "ACTION_CHANGE_REQUIRES_UPSTREAM_REVISION", sceneOrder: decision.sceneOrder, message: "Action progression must preserve the frozen Script actions for a Motion-only successor." });
    }
    if (decision.cameraBehavior !== "PRESERVE_FROZEN_SHOT") {
      issues.push({ code: "CAMERA_CHANGE_REQUIRES_SUCCESSOR_DIRECTOR", sceneOrder: decision.sceneOrder, message: "A camera change requires a formally approved successor Director Plan." });
    }
  }
  return issues;
}

function applyDecision(
  scene: AiStoryEpisodeProjectedMotionScene,
  decision: AiStorySuccessorMotionSceneDecision,
): AiStoryEpisodeProjectedMotionScene {
  const productState = {
    dimension: "PRODUCT_STATE",
    subjectId: decision.productAuthorityId,
    value: "PRESENT",
    reason: "Explicit Successor Motion human review: in-world presence is distinct from camera visibility.",
  };
  return {
    ...scene,
    entryState: [...scene.entryState.filter((fact) => !(fact.dimension === "PRODUCT_STATE" && fact.subjectId === decision.productAuthorityId)), productState],
    exitState: [...scene.exitState.filter((fact) => !(fact.dimension === "PRODUCT_STATE" && fact.subjectId === decision.productAuthorityId)), productState],
  };
}

export function buildSuccessorProjectedMotionPlan(input: {
  base: AiStoryEpisodeProjectedMotionPlan;
  review: AiStorySuccessorMotionReview;
  version: number;
  createdBy: string;
  createdAt: string;
}): AiStoryEpisodeProjectedMotionPlan {
  const review = AiStorySuccessorMotionReviewSchema.parse(input.review);
  if (input.base.status !== "FROZEN" || review.baseMotionPlanId !== input.base.motionPlanId) {
    throw new Error("SUCCESSOR_MOTION_BASE_CONFLICT");
  }
  const issues = validateSuccessorMotionReview(input.base, review);
  if (issues.length) throw new Error(`SUCCESSOR_MOTION_REVIEW_BLOCKED:${JSON.stringify(issues)}`);
  const sceneMotionPlans = input.base.sceneMotionPlans.map((scene) => {
    const decision = review.scenes.find((item) => item.scriptSceneId === scene.scriptSceneId);
    if (!decision) return scene;
    return applyDecision(scene, decision);
  });
  const base = {
    contractVersion: input.base.contractVersion,
    storyId: input.base.storyId,
    storyVersionId: input.base.storyVersionId,
    outlineVersionId: input.base.outlineVersionId,
    scriptVersionId: input.base.scriptVersionId,
    handoffId: input.base.handoffId,
    directorPlanId: input.base.directorPlanId,
    orgId: input.base.orgId,
    workspaceId: input.base.workspaceId,
    campaignId: input.base.campaignId,
    animationPackageId: input.base.animationPackageId,
    sourceDirectorFingerprint: input.base.sourceDirectorFingerprint,
    sceneMotionPlans,
    successorReview: review,
  };
  const sourceHash = sha256CanonicalIntegrityHash(base);
  const supersedesMotionPlanId = input.base.motionPlanId;
  const motionFingerprint = sha256CanonicalIntegrityHash({ ...base, sourceHash, version: input.version, supersedesMotionPlanId });
  return AiStoryEpisodeProjectedMotionPlanSchema.parse({
    ...base,
    motionPlanId: deterministicUuidFromFingerprint("ai-story-motion-plan.successor", sourceHash),
    version: input.version,
    sourceHash,
    motionFingerprint,
    status: "DRAFT",
    supersedesMotionPlanId,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    approvedBy: null,
    approvedAt: null,
    frozenAt: null,
  });
}
