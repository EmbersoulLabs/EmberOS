import { z } from "zod";

export const AI_STORY_SUCCESSOR_MOTION_REVIEW_CONTRACT_VERSION =
  "ai-story-successor-motion-review.v1" as const;

const Id = z.string().uuid();
const Text = z.string().trim().min(1).max(4000);

export const AiStorySuccessorMotionSceneDecisionSchema = z
  .object({
    scriptSceneId: Id,
    sceneOrder: z.number().int().nonnegative(),
    productAuthorityId: Id,
    creativeDecision: Text,
    worldStateAtEntry: z.enum(["PRESENT", "ABSENT"]),
    worldStateAtExit: z.enum(["PRESENT", "ABSENT"]),
    visibilityTransition: z.enum([
      "CONTINUOUSLY_IN_FRAME",
      "LEAVES_FRAME_AND_RETURNS",
      "LEAVES_FRAME_THROUGH_EXIT",
      "ENTERS_FRAME_AFTER_ENTRY",
      "OUT_OF_FRAME_INTERVAL",
    ]),
    identityOutcome: z.enum([
      "PRESERVED_UNCHANGED",
      "APPEARANCE_CHANGED_IDENTITY_PRESERVED",
      "IDENTITY_REPLACED_OR_DESTROYED",
    ]),
    physicalConditionAtEntry: Text.max(500),
    physicalConditionAtExit: Text.max(500),
    ownershipAtEntry: Text.max(500),
    ownershipAtExit: Text.max(500),
    actionProgression: z.array(Text.max(1000)).min(1).max(8),
    cameraBehavior: z.enum(["PRESERVE_FROZEN_SHOT", "REVISED_CAMERA_REQUIRED"]),
    rationale: Text,
  })
  .strict();

export const AiStorySuccessorMotionReviewSchema = z
  .object({
    contractVersion: z.literal(AI_STORY_SUCCESSOR_MOTION_REVIEW_CONTRACT_VERSION),
    baseMotionPlanId: Id,
    supersededDecision:
      Text,
    latestCreativeDecision: Text,
    scenes: z.array(AiStorySuccessorMotionSceneDecisionSchema).length(2),
    submittedBy: Id,
    submittedAt: z.string().datetime(),
  })
  .strict();

export type AiStorySuccessorMotionSceneDecision = z.infer<
  typeof AiStorySuccessorMotionSceneDecisionSchema
>;
export type AiStorySuccessorMotionReview = z.infer<
  typeof AiStorySuccessorMotionReviewSchema
>;

export const SUCCESSOR_MOTION_LATEST_CREATIVE_DECISION =
  "Scene 1\n\nThe Lilies / Product is NOT required to remain continuously visible and unchanged from the first frame to the final frame.\n\nThe product may leave the camera frame or undergo a change, subject to explicit creative definition and approval.\n\nScene 3\n\nThe Lilies / Product is NOT required to remain continuously visible and unchanged from the first frame to the final frame.\n\nThe product may leave the camera frame or undergo a change, subject to explicit creative definition and approval." as const;

export const SUCCESSOR_MOTION_SCENE_1_CREATIVE_DECISION =
  "Scene 1\n\nThe Lilies / Product is NOT required to remain continuously visible and unchanged from the first frame to the final frame.\n\nThe product may leave the camera frame or undergo a change, subject to explicit creative definition and approval." as const;

export const SUCCESSOR_MOTION_SCENE_3_CREATIVE_DECISION =
  "Scene 3\n\nThe Lilies / Product is NOT required to remain continuously visible and unchanged from the first frame to the final frame.\n\nThe product may leave the camera frame or undergo a change, subject to explicit creative definition and approval." as const;

export const SUCCESSOR_MOTION_SUPERSEDED_DECISION =
  "Scene 1 and Scene 3 require continuous product visibility and unchanged state from the first frame to the final frame." as const;

export type AiStorySuccessorMotionIssue = {
  code:
    | "TARGET_SCENES_INVALID"
    | "CREATIVE_DECISION_SCOPE_MISMATCH"
    | "PRODUCT_AUTHORITY_MISMATCH"
    | "WORLD_STATE_REQUIRES_UPSTREAM_REVISION"
    | "IDENTITY_CHANGE_REQUIRES_UPSTREAM_REVISION"
    | "PHYSICAL_CHANGE_REQUIRES_UPSTREAM_REVISION"
    | "OWNERSHIP_CHANGE_REQUIRES_UPSTREAM_REVISION"
    | "ACTION_CHANGE_REQUIRES_UPSTREAM_REVISION"
    | "CAMERA_CHANGE_REQUIRES_SUCCESSOR_DIRECTOR";
  sceneOrder: number | null;
  message: string;
};
