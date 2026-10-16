import { describe, expect, it } from "vitest";
import {
  AI_STORY_MOTION_PLAN_EPISODE_PROJECTED_CONTRACT_VERSION,
  AI_STORY_SUCCESSOR_MOTION_REVIEW_CONTRACT_VERSION,
  AiStoryEpisodeProjectedMotionPlanSchema,
  SUCCESSOR_MOTION_LATEST_CREATIVE_DECISION,
  SUCCESSOR_MOTION_SCENE_1_CREATIVE_DECISION,
  SUCCESSOR_MOTION_SCENE_3_CREATIVE_DECISION,
  SUCCESSOR_MOTION_SUPERSEDED_DECISION,
  type AiStorySuccessorMotionReview,
} from "@ceo-agent/shared";
import { buildSuccessorProjectedMotionPlan, validateSuccessorMotionReview } from "@ceo-agent/shared/server";

const ids = {
  base: "00000000-0000-4000-8000-000000000001",
  story: "00000000-0000-4000-8000-000000000002",
  storyVersion: "00000000-0000-4000-8000-000000000003",
  outline: "00000000-0000-4000-8000-000000000004",
  script: "00000000-0000-4000-8000-000000000005",
  handoff: "00000000-0000-4000-8000-000000000006",
  director: "00000000-0000-4000-8000-000000000007",
  org: "00000000-0000-4000-8000-000000000008",
  workspace: "00000000-0000-4000-8000-000000000009",
  campaign: "00000000-0000-4000-8000-000000000010",
  animation: "00000000-0000-4000-8000-000000000011",
  actor: "00000000-0000-4000-8000-000000000012",
  product: "00000000-0000-4000-8000-000000000013",
  character: "00000000-0000-4000-8000-000000000014",
  scene1: "00000000-0000-4000-8000-000000000015",
  scene2: "00000000-0000-4000-8000-000000000016",
  scene3: "00000000-0000-4000-8000-000000000017",
  entry1: "00000000-0000-4000-8000-000000000018",
  entry2: "00000000-0000-4000-8000-000000000019",
  entry3: "00000000-0000-4000-8000-000000000020",
};
const hash = `sha256:${"a".repeat(64)}`;

function scene(order: number, scriptSceneId: string, entryId: string, productBound: boolean) {
  const action = order === 0 ? "Introduce the setting and the main character." : order === 2 ? "Conclude with the finished product and a call to action." : "Showcase the florist's skills and the product.";
  return {
    scriptSceneId, sceneOrder: order,
    actions: [{ entryId, semanticAction: action, subjectId: order === 2 ? ids.product : ids.character, objectId: null, stateDelta: null }],
    sceneStateIn: [], sceneStateDeltas: [], sceneStateOut: [], entryState: [],
    events: [{ entryId, type: "ACTION" as const, action, subjectId: order === 2 ? ids.product : ids.character, objectId: null, stateDelta: null }],
    exitState: [], shots: [{ shotId: `shot-${order}`, order, cameraType: "static", cameraMovement: order === 2 ? "gentle pull-back" : "locked", composition: "composition", framing: "framing", focus: "focus", information: "information", durationSec: 5 }],
    productBindingIds: productBound ? [ids.product] : [],
    generationAuthority: { state: "NOT_ASSERTED" as const },
    measuredFacts: { actionCount: 1, shotCount: 1, cameraBehaviorCount: 1, durationSec: 5, imageConditioned: false, productIdentitySensitive: false },
    physicalCompletion: { state: "NOT_APPLICABLE" as const, reason: "No persisted physical state change requires a completion path" },
    cameraStateBoundary: { state: "NOT_ASSERTED" as const },
  };
}

const base = AiStoryEpisodeProjectedMotionPlanSchema.parse({
  motionPlanId: ids.base, storyId: ids.story, storyVersionId: ids.storyVersion, outlineVersionId: ids.outline,
  scriptVersionId: ids.script, handoffId: ids.handoff, directorPlanId: ids.director, orgId: ids.org,
  workspaceId: ids.workspace, campaignId: ids.campaign, animationPackageId: ids.animation, version: 1,
  contractVersion: AI_STORY_MOTION_PLAN_EPISODE_PROJECTED_CONTRACT_VERSION, sourceDirectorFingerprint: hash,
  sceneMotionPlans: [scene(0, ids.scene1, ids.entry1, true), scene(1, ids.scene2, ids.entry2, false), scene(2, ids.scene3, ids.entry3, true)],
  sourceHash: hash, motionFingerprint: hash, status: "FROZEN", supersedesMotionPlanId: null,
  createdBy: ids.actor, createdAt: "2026-10-15T00:00:00.000Z", approvedBy: ids.actor,
  approvedAt: "2026-10-15T00:00:00.000Z", frozenAt: "2026-10-15T00:00:00.000Z",
});

function review(): AiStorySuccessorMotionReview {
  const decision = (sceneOrder: 0 | 2, scriptSceneId: string, action: string) => ({
    scriptSceneId, sceneOrder, productAuthorityId: ids.product,
    creativeDecision: sceneOrder === 0 ? SUCCESSOR_MOTION_SCENE_1_CREATIVE_DECISION : SUCCESSOR_MOTION_SCENE_3_CREATIVE_DECISION,
    worldStateAtEntry: "PRESENT" as const, worldStateAtExit: "PRESENT" as const,
    visibilityTransition: "LEAVES_FRAME_AND_RETURNS" as const,
    identityOutcome: "PRESERVED_UNCHANGED" as const,
    physicalConditionAtEntry: "fresh lilies", physicalConditionAtExit: "fresh lilies",
    ownershipAtEntry: "florist custody", ownershipAtExit: "florist custody",
    actionProgression: [action], cameraBehavior: "PRESERVE_FROZEN_SHOT" as const,
    rationale: "The product may leave the camera frame while remaining the same in-world product.",
  });
  return {
    contractVersion: AI_STORY_SUCCESSOR_MOTION_REVIEW_CONTRACT_VERSION,
    baseMotionPlanId: ids.base,
    supersededDecision: SUCCESSOR_MOTION_SUPERSEDED_DECISION,
    latestCreativeDecision: SUCCESSOR_MOTION_LATEST_CREATIVE_DECISION,
    scenes: [decision(0, ids.scene1, "Introduce the setting and the main character."), decision(2, ids.scene3, "Conclude with the finished product and a call to action.")],
    submittedBy: ids.actor, submittedAt: "2026-10-16T00:00:00.000Z",
  };
}

describe("Successor Motion human authority", () => {
  it("keeps visibility separate from in-world existence and product identity", () => {
    const facts = review();
    expect(validateSuccessorMotionReview(base, facts)).toEqual([]);
    const successor = buildSuccessorProjectedMotionPlan({ base, review: facts, version: 2, createdBy: ids.actor, createdAt: facts.submittedAt });
    expect(successor.status).toBe("DRAFT");
    expect(successor.supersedesMotionPlanId).toBe(base.motionPlanId);
    expect(successor.successorReview?.latestCreativeDecision).toBe(SUCCESSOR_MOTION_LATEST_CREATIVE_DECISION);
    expect(successor.sceneMotionPlans[0]?.entryState).toContainEqual(expect.objectContaining({ dimension: "PRODUCT_STATE", subjectId: ids.product, value: "PRESENT" }));
    expect(successor.sceneMotionPlans[0]?.exitState).toContainEqual(expect.objectContaining({ dimension: "PRODUCT_STATE", subjectId: ids.product, value: "PRESENT" }));
    expect(base.sceneMotionPlans[0]?.entryState).toEqual([]);
  });

  it("does not infer an appearance, identity, ownership, action, or camera change", () => {
    const cases: Array<[string, (facts: AiStorySuccessorMotionReview) => void]> = [
      ["PHYSICAL_CHANGE_REQUIRES_UPSTREAM_REVISION", (facts) => { facts.scenes[0]!.identityOutcome = "APPEARANCE_CHANGED_IDENTITY_PRESERVED"; }],
      ["IDENTITY_CHANGE_REQUIRES_UPSTREAM_REVISION", (facts) => { facts.scenes[0]!.identityOutcome = "IDENTITY_REPLACED_OR_DESTROYED"; }],
      ["OWNERSHIP_CHANGE_REQUIRES_UPSTREAM_REVISION", (facts) => { facts.scenes[0]!.ownershipAtExit = "customer custody"; }],
      ["ACTION_CHANGE_REQUIRES_UPSTREAM_REVISION", (facts) => { facts.scenes[0]!.actionProgression = ["Remove the lilies"]; }],
      ["CAMERA_CHANGE_REQUIRES_SUCCESSOR_DIRECTOR", (facts) => { facts.scenes[0]!.cameraBehavior = "REVISED_CAMERA_REQUIRED"; }],
    ];
    for (const [code, mutate] of cases) {
      const facts = review();
      mutate(facts);
      expect(validateSuccessorMotionReview(base, facts).map((issue) => issue.code)).toContain(code);
    }
  });
});
