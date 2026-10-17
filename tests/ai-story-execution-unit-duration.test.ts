import { describe, expect, it } from "vitest";
import {
  AI_STORY_EPISODE_PROJECTED_MOTION_COMPLEXITY_POLICY,
  AI_STORY_EXECUTION_UNIT_MAX_SEC,
  AI_STORY_EXECUTION_UNIT_MIN_SEC,
  ExecutionUnitDurationChangeError,
  applyExecutionUnitDurationChanges,
  assessExecutionUnitDurations,
  isCertifiedExecutionUnitDuration,
} from "@ceo-agent/shared";
import { LOCAL_GPU_DURATION_MAX_SEC, LOCAL_GPU_DURATION_MIN_SEC } from "@ceo-agent/shared/server";

function scene(order: number, durationSec: number, continuityNotes = "") {
  return {
    id: `scene-00${order + 1}`,
    order,
    durationSec,
    purpose: `Purpose ${order}`,
    transition: "none",
    continuityNotes,
    beatIds: [`beat-00${order + 1}`],
  };
}

function shot(id: string, sceneId: string, order: number, durationSec: number, cameraType = "LOCKED") {
  return { id, sceneId, order, durationSec, cameraType, cameraMovement: "none", focus: "product" };
}

describe("execution unit duration contract", () => {
  it("intersects the Desktop window with the Pre-QC Motion budget", () => {
    expect([LOCAL_GPU_DURATION_MIN_SEC, LOCAL_GPU_DURATION_MAX_SEC]).toEqual([5, 15]);
    expect(AI_STORY_EXECUTION_UNIT_MIN_SEC).toBe(5);
    expect(AI_STORY_EXECUTION_UNIT_MAX_SEC).toBe(Math.min(15, AI_STORY_EPISODE_PROJECTED_MOTION_COMPLEXITY_POLICY.maxDurationSec));
    expect([4, 4.5, 5, 12, 12.5, 13, 15].map(isCertifiedExecutionUnitDuration))
      .toEqual([false, false, true, true, false, false, false]);
  });

  it("leaves compliant plans untouched", () => {
    const result = assessExecutionUnitDurations({ scenePlan: [scene(0, 5), scene(1, 12)] });
    expect(result.status).toBe("COMPLIANT");
    expect(result.decision).toBeNull();
  });

  it("never regroups Scenes and surfaces one per-Scene duration decision", () => {
    const result = assessExecutionUnitDurations({
      scenePlan: [scene(0, 2), scene(1, 2, "Scene 001 and Scene 002 are merged as one continuous shot."), scene(2, 2)],
    });
    expect(result.status).toBe("CREATIVE_DECISION_REQUIRED");
    expect(result.units.map((unit) => [unit.sceneId, unit.durationSec, unit.certified])).toEqual([
      ["scene-001", 2, false], ["scene-002", 2, false], ["scene-003", 2, false],
    ]);
    expect(result.decision?.option).toEqual({
      kind: "CHANGE_UNIT_DURATION",
      changes: [
        { sceneId: "scene-001", fromDurationSec: 2, toDurationSec: 5 },
        { sceneId: "scene-002", fromDurationSec: 2, toDurationSec: 5 },
        { sceneId: "scene-003", fromDurationSec: 2, toDurationSec: 5 },
      ],
      episodeDurationSec: 15,
      creativeChanges: [
        "scene-001 changes from 2s to 5s",
        "scene-002 changes from 2s to 5s",
        "scene-003 changes from 2s to 5s",
        "Episode length changes from 6s to 15s",
      ],
    });
    expect(assessExecutionUnitDurations({ scenePlan: [scene(0, 14)] }).decision?.option.changes)
      .toEqual([{ sceneId: "scene-001", fromDurationSec: 14, toDurationSec: 12 }]);
  });
});

describe("applyExecutionUnitDurationChanges", () => {
  const scenePlan = [scene(0, 2), scene(1, 2, "Scene 001 and Scene 002 are merged as one continuous shot."), scene(2, 2)];
  const shotPlan = [
    shot("shot-001", "scene-001", 0, 2),
    shot("shot-002a", "scene-002", 0, 0.5, "SLOW_PUSH_IN"),
    shot("shot-002b", "scene-002", 1, 1.5, "SLOW_PUSH_IN"),
    shot("shot-003", "scene-003", 0, 2),
  ];

  it("changes only durations and scales existing Shot timing to the exact Scene length", () => {
    const result = applyExecutionUnitDurationChanges({
      scenePlan,
      shotPlan,
      durations: scenePlan.map((item) => ({ sceneId: item.id, durationSec: 5 })),
    });
    expect(result.changes).toHaveLength(3);
    expect(result.scenePlan.map((item) => item.durationSec)).toEqual([5, 5, 5]);
    expect(result.scenePlan.map(({ durationSec: _d, ...rest }) => rest))
      .toEqual(scenePlan.map(({ durationSec: _d, ...rest }) => rest));
    expect(result.shotPlan.map((item) => [item.id, item.durationSec])).toEqual([
      ["shot-001", 5], ["shot-002a", 1.25], ["shot-002b", 3.75], ["shot-003", 5],
    ]);
    expect(result.shotPlan.map(({ durationSec: _d, ...rest }) => rest))
      .toEqual(shotPlan.map(({ durationSec: _d, ...rest }) => rest));
    expect(scenePlan.map((item) => item.durationSec)).toEqual([2, 2, 2]);
  });

  it("rejects incomplete, uncertified, unknown or duplicate changes", () => {
    const attempt = (durations: { sceneId: string; durationSec: number }[]) => {
      try {
        applyExecutionUnitDurationChanges({ scenePlan, shotPlan, durations });
        return null;
      } catch (error) {
        return error instanceof ExecutionUnitDurationChangeError ? error.code : String(error);
      }
    };
    expect(attempt([{ sceneId: "scene-001", durationSec: 5 }])).toBe("EXECUTION_UNIT_DURATION_INCOMPLETE");
    expect(attempt([{ sceneId: "scene-001", durationSec: 13 }])).toBe("EXECUTION_UNIT_DURATION_UNSUPPORTED");
    expect(attempt([{ sceneId: "scene-001", durationSec: 5.5 }])).toBe("EXECUTION_UNIT_DURATION_UNSUPPORTED");
    expect(attempt([{ sceneId: "scene-009", durationSec: 5 }])).toBe("EXECUTION_UNIT_DURATION_SCENE_UNKNOWN");
    expect(attempt([{ sceneId: "scene-001", durationSec: 5 }, { sceneId: "scene-001", durationSec: 6 }]))
      .toBe("EXECUTION_UNIT_DURATION_CHANGE_DUPLICATE");
  });
});
