import { describe, expect, it } from "vitest";
import {
  assessExecutionUnitDurations,
  isCertifiedExecutionUnitDuration,
  type AiStorySceneGenerationAuthority,
} from "@ceo-agent/shared";
import { LOCAL_GPU_DURATION_MAX_SEC, LOCAL_GPU_DURATION_MIN_SEC } from "@ceo-agent/shared/server";

const FRAME = "11111111-1111-4111-8111-111111111111";
const OTHER_FRAME = "22222222-2222-4222-8222-222222222222";

function grounded(firstFrameAssetId = FRAME): AiStorySceneGenerationAuthority {
  return {
    strategy: "PRODUCT_GROUNDED_VIDEO",
    referenceSource: "SCENE_EXPLICIT",
    referenceAssetIds: [firstFrameAssetId],
    firstFrameAssetId,
    productVisualIdentityRequirement: "REQUIRED",
  };
}

function scene(order: number, durationSec: number, continuityNotes = "", authority = grounded()) {
  return {
    id: `scene-${String(order + 1).padStart(3, "0")}`,
    order,
    durationSec,
    transition: "none",
    continuityNotes,
    generationAuthority: authority,
  };
}

function shots(cameras: string[]) {
  return cameras.map((cameraType, order) => ({
    sceneId: `scene-${String(order + 1).padStart(3, "0")}`,
    order: 0,
    cameraType,
  })) as never[];
}

describe("execution unit duration contract", () => {
  it("is the single source for the LOCAL_GPU Desktop range", () => {
    expect([LOCAL_GPU_DURATION_MIN_SEC, LOCAL_GPU_DURATION_MAX_SEC]).toEqual([5, 15]);
    expect([4, 4.5, 5, 15, 15.5, 16].map(isCertifiedExecutionUnitDuration))
      .toEqual([false, false, true, true, false, false]);
  });

  it("leaves compliant plans untouched", () => {
    const result = assessExecutionUnitDurations({
      scenePlan: [scene(0, 5), scene(1, 15)],
      shotPlan: shots(["LOCKED", "SLOW_PUSH_IN"]),
    });
    expect(result.status).toBe("COMPLIANT");
    expect(result.units.map((unit) => unit.sceneIds)).toEqual([["scene-001"], ["scene-002"]]);
    expect(result.decision).toBeNull();
  });

  it("regroups only along frozen continuous-shot evidence with identical authority", () => {
    const note = "Scene 001 and Scene 002 are merged as one continuous shot.";
    const result = assessExecutionUnitDurations({
      scenePlan: [scene(0, 3), scene(1, 3, note), scene(2, 6)],
      shotPlan: shots(["LOCKED", "SLOW_PUSH_IN", "LOCKED"]),
    });
    expect(result.status).toBe("REGROUP_SUPPORTED_BY_FROZEN_FACTS");
    expect(result.units).toEqual([
      expect.objectContaining({ sceneIds: ["scene-001", "scene-002"], durationSec: 6, certified: true, basis: "FROZEN_CONTINUOUS_SHOT", evidence: [note] }),
      expect.objectContaining({ sceneIds: ["scene-003"], durationSec: 6, certified: true, basis: "ORIGINAL_SCENE" }),
    ]);
    expect(result.episodeDurationSec).toBe(12);
  });

  it("does not regroup across negated continuity or a changed first frame", () => {
    const negated = assessExecutionUnitDurations({
      scenePlan: [scene(0, 3), scene(1, 3, "Scene 001 and Scene 002 are not one continuous shot.")],
      shotPlan: shots(["LOCKED", "LOCKED"]),
    });
    expect(negated.units.map((unit) => unit.basis)).toEqual(["ORIGINAL_SCENE", "ORIGINAL_SCENE"]);
    const reanchored = assessExecutionUnitDurations({
      scenePlan: [scene(0, 3), scene(1, 3, "Scene 001 and Scene 002 are merged as one continuous shot.", grounded(OTHER_FRAME))],
      shotPlan: shots(["LOCKED", "LOCKED"]),
    });
    expect(reanchored.units.map((unit) => unit.basis)).toEqual(["ORIGINAL_SCENE", "ORIGINAL_SCENE"]);
    expect(reanchored.status).toBe("CREATIVE_DECISION_REQUIRED");
    expect(reanchored.decision?.options.map((option) => option.kind)).toEqual(["CHANGE_UNIT_DURATION"]);
  });

  it("surfaces one exact creative decision when frozen facts cannot reach 5 seconds", () => {
    const result = assessExecutionUnitDurations({
      scenePlan: [
        scene(0, 2),
        scene(1, 2, "Scene 001 and Scene 002 are merged as one continuous shot."),
        scene(2, 2),
      ],
      shotPlan: shots(["LOCKED", "SLOW_PUSH_IN", "LOCKED"]),
    });
    expect(result.status).toBe("CREATIVE_DECISION_REQUIRED");
    expect(result.units).toEqual([
      expect.objectContaining({ sceneIds: ["scene-001", "scene-002"], durationSec: 4, certified: false, basis: "FROZEN_CONTINUOUS_SHOT" }),
      expect.objectContaining({ sceneIds: ["scene-003"], durationSec: 2, certified: false, basis: "ORIGINAL_SCENE" }),
    ]);
    expect(result.decision?.unresolvedSceneIds).toEqual(["scene-001", "scene-002", "scene-003"]);
    expect(result.decision?.options).toEqual([
      expect.objectContaining({
        kind: "CONFIRM_CONTINUOUS_TAKE",
        sceneIds: ["scene-001", "scene-002", "scene-003"],
        durationSec: 6,
        cameraSequence: ["LOCKED", "SLOW_PUSH_IN", "LOCKED"],
        episodeDurationSec: 6,
        creativeChanges: expect.arrayContaining([
          "Removes 1 Scene cut that frozen continuity does not mark as continuous",
          "Removes the explicit first-frame restart at scene-003",
        ]),
      }),
      expect.objectContaining({
        kind: "CHANGE_UNIT_DURATION",
        changes: [
          { sceneIds: ["scene-001", "scene-002"], fromDurationSec: 4, toDurationSec: 5 },
          { sceneIds: ["scene-003"], fromDurationSec: 2, toDurationSec: 5 },
        ],
        episodeDurationSec: 10,
      }),
    ]);
  });
});
