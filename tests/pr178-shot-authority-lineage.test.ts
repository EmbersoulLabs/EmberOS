import { describe, expect, it } from "vitest";
import { AuthoritativeAnimationPackagePayloadSchema } from "@ceo-agent/shared";
import { bindShotPlanAuthorityLineage } from "../packages/agents/src/ai-story/story-planning-service";
import { compileSceneExecutionIntents } from "../packages/agents/src/ai-story/scene-execution-compiler";
import { buildAiStoryAnimationPackageCanonicalSceneAuthorityV1 } from "@ceo-agent/shared/server";
import { animationPackageFixture } from "./helpers/ai-story-animation-package";

const id = (n: number) => `17800000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

const grounding = {
  contractVersion: "ai-story-scene-grounding-lineage.v1" as const,
  storyId: id(1),
  storyVersionId: id(2),
  matchingResultId: id(3),
  narrativeIntent: "Customer selects Nasi Lemak",
  visualIntent: "Present the approved Nasi Lemak Product",
  evidence: [{
    bindingId: id(4),
    assetId: id(5),
    role: "PRODUCT_AUTHORITY" as const,
    semanticSnapshotId: id(6),
    groundedFacts: ["Nasi Lemak", "coconut rice", "sambal"],
  }],
  visualClaims: [{
    subject: "Nasi Lemak",
    detail: "coconut rice",
    evidenceLevel: "OBSERVED_APPEARANCE" as const,
  }],
};

const mode = {
  strategy: "FIRST_FRAME_IMAGE_TO_VIDEO" as const,
  referenceSource: "SCENE_EXPLICIT" as const,
  referenceAssetIds: [id(5)],
  firstFrameAssetId: id(5),
  productVisualIdentityRequirement: "REQUIRED" as const,
};

const scene = {
  id: "scene-002",
  beatIds: ["beat-002"],
  purpose: "Select and taste Nasi Lemak",
  durationSec: 8,
  transition: "",
  continuityNotes: "",
  order: 1,
  generationAuthority: mode,
  groundingLineage: grounding,
};

const shot = {
  id: "shot-002-001",
  sceneId: scene.id,
  cameraType: "close-up",
  cameraMovement: "slow push-in",
  composition: "approved Product centered",
  framing: "close",
  lensSuggestion: "50mm",
  durationSec: 8,
  focus: "Nasi Lemak",
  emotion: "satisfied",
  information: "Customer selects and tastes Nasi Lemak",
  order: 0,
};

describe("PR #178 Shot authority lineage", () => {
  it("deterministically binds exact Package, Story Version, matching Snapshot, Scene mode, and first frame", () => {
    const [bound] = bindShotPlanAuthorityLineage({
      planningPackageId: id(7),
      scenePlan: [scene],
      shotPlan: [shot],
    });
    expect(bound?.authorityLineage).toEqual({
      contractVersion: "ai-story-shot-authority-lineage.v1",
      planningPackageId: id(7),
      storyId: id(1),
      storyVersionId: id(2),
      matchingResultId: id(3),
      sceneId: scene.id,
      sceneOrder: 1,
      generationAuthority: mode,
      groundingLineage: grounding,
    });
    expect(bound?.authorityLineage?.generationAuthority.firstFrameAssetId).toBe(id(5));
    expect(bound?.authorityLineage?.groundingLineage.evidence[0]).toMatchObject({
      assetId: id(5),
      semanticSnapshotId: id(6),
      role: "PRODUCT_AUTHORITY",
    });
  });

  it("fails closed for missing Package, wrong Scene, duplicate Shot, or incomplete Scene coverage", () => {
    expect(() => bindShotPlanAuthorityLineage({ scenePlan: [scene], shotPlan: [shot] }))
      .toThrow("SHOT_PLAN_SOURCE_PACKAGE_AUTHORITY_REQUIRED");
    expect(() => bindShotPlanAuthorityLineage({ planningPackageId: id(7), scenePlan: [scene], shotPlan: [{ ...shot, sceneId: "other" }] }))
      .toThrow("SHOT_PLAN_SCENE_AUTHORITY_INVALID");
    expect(() => bindShotPlanAuthorityLineage({ planningPackageId: id(7), scenePlan: [scene], shotPlan: [shot, shot] }))
      .toThrow("SHOT_PLAN_DUPLICATE_ID");
    expect(() => bindShotPlanAuthorityLineage({ planningPackageId: id(7), scenePlan: [scene, { ...scene, id: "scene-003", order: 2 }], shotPlan: [shot] }))
      .toThrow("SHOT_PLAN_SCENE_COVERAGE_REQUIRED");
  });

  it("requires grounded authoritative Packages to pin their exact source Planning Package", () => {
    const legacy = animationPackageFixture("ready_for_execution");
    const grounded = {
      ...legacy,
      scenePlan: [{ ...legacy.scenePlan[0]!, generationAuthority: mode, groundingLineage: grounding }],
      shotPlan: [{ ...legacy.shotPlan[0]!, sceneId: legacy.scenePlan[0]!.id }],
      canonicalSceneAuthority: {
        contractVersion: "ai-story-animation-package-canonical-scene-binding.v1",
        scriptVersionId: id(20),
        sceneSetFingerprint: `sha256:${"a".repeat(64)}`,
        scenes: [{
          order: 0,
          planningSceneId: legacy.scenePlan[0]!.id,
          sceneId: id(21),
          sceneVersionId: id(22),
          sceneFingerprint: `sha256:${"b".repeat(64)}`,
          sourceScriptSceneIds: [id(23)],
          generationAuthority: mode,
        }],
      },
    };
    expect(AuthoritativeAnimationPackagePayloadSchema.safeParse(grounded).success).toBe(false);
    expect(AuthoritativeAnimationPackagePayloadSchema.safeParse({ ...grounded, sourcePlanningPackageId: id(7) }).success).toBe(true);
  });

  it("compiles only the exact pinned Shot lineage and fails closed on Package or Scene mutation", () => {
    const legacy = animationPackageFixture("ready_for_execution");
    const planningScene = { ...legacy.scenePlan[0]!, ...scene, order: 0 };
    const [boundShot] = bindShotPlanAuthorityLineage({
      planningPackageId: id(7),
      scenePlan: [planningScene],
      shotPlan: [{ ...shot, sceneId: planningScene.id }],
    });
    const canonicalScene = {
      sceneId: id(21), sceneVersionId: id(22), storyId: id(1), storyVersionId: id(2),
      scriptVersionId: id(20), order: 0, fingerprint: `sha256:${"b".repeat(64)}`,
      sourceScriptSceneIds: [id(23)], status: "FROZEN" as const, generationAuthority: mode,
    };
    const pkg = AuthoritativeAnimationPackagePayloadSchema.parse({
      ...legacy,
      sourcePlanningPackageId: id(7),
      scenePlan: [planningScene],
      shotPlan: [boundShot!],
      canonicalSceneAuthority: buildAiStoryAnimationPackageCanonicalSceneAuthorityV1({
        storyId: id(1), storyVersionId: id(2), scenePlan: [planningScene], canonicalScenes: [canonicalScene],
      }),
    });
    const context = {
      orgId: id(30), workspaceId: id(31), campaignId: id(32), storyId: id(1), storyVersionId: id(2),
      storyVersionNumber: 1, storyVersionFrozenAt: "2026-09-27T00:00:00.000Z",
      animationPackageId: id(33), animationPackageStatus: "ready_for_execution",
      compiledAt: "2026-09-27T00:01:00.000Z",
    };
    const compiled = compileSceneExecutionIntents(pkg, context);
    const intent = compiled.intents[0]!;
    const instructions = compiled.instructionsBySceneExecutionId[intent.identity.sceneExecutionId]!;
    expect(intent.generationAuthority?.firstFrameAssetId).toBe(id(5));
    expect(instructions.groundingLineage?.matchingResultId).toBe(id(3));
    expect(instructions.shots[0]?.authorityLineageFingerprint).toMatch(/^sha256:/);

    const wrongPackage = structuredClone(pkg);
    wrongPackage.sourcePlanningPackageId = id(99);
    expect(() => compileSceneExecutionIntents(wrongPackage, context)).toThrow("ANIMATION_PACKAGE_SHOT_AUTHORITY_LINEAGE_INVALID");
    const wrongScene = structuredClone(pkg);
    wrongScene.shotPlan[0]!.authorityLineage!.sceneOrder = 4;
    expect(() => compileSceneExecutionIntents(wrongScene, context)).toThrow("ANIMATION_PACKAGE_SHOT_AUTHORITY_LINEAGE_INVALID");
    const wrongAsset = structuredClone(pkg);
    wrongAsset.shotPlan[0]!.authorityLineage!.generationAuthority = {
      ...mode,
      referenceAssetIds: [id(98)],
      firstFrameAssetId: id(98),
    };
    expect(() => compileSceneExecutionIntents(wrongAsset, context)).toThrow("ANIMATION_PACKAGE_SHOT_AUTHORITY_LINEAGE_INVALID");
  });
});
