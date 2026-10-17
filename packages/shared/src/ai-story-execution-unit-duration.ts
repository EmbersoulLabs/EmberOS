import type { ScenePlanItem, ShotPlanItem } from "./ai-story";
import { AI_STORY_EPISODE_PROJECTED_MOTION_COMPLEXITY_POLICY } from "./ai-story-episode-projected-authority";

/** Whole-second window certified by every Desktop video workflow (V2/V3). */
export const AI_STORY_LOCAL_GPU_DESKTOP_MIN_SEC = 5;
export const AI_STORY_LOCAL_GPU_DESKTOP_MAX_SEC = 15;
/**
 * One Scene is one generation unit. It must satisfy both the Desktop window and
 * the Pre-QC Motion complexity budget, so Planning uses the intersection.
 */
export const AI_STORY_EXECUTION_UNIT_MIN_SEC = AI_STORY_LOCAL_GPU_DESKTOP_MIN_SEC;
export const AI_STORY_EXECUTION_UNIT_MAX_SEC = Math.min(
  AI_STORY_LOCAL_GPU_DESKTOP_MAX_SEC,
  AI_STORY_EPISODE_PROJECTED_MOTION_COMPLEXITY_POLICY.maxDurationSec,
);
export const AI_STORY_EXECUTION_UNIT_DURATION_CONTRACT = "ai-story-execution-unit-duration.v2" as const;
export const AI_STORY_EXECUTION_UNIT_DURATION_SUCCESSOR_CONTRACT = "ai-story-execution-unit-duration-successor.v1" as const;

export function isCertifiedExecutionUnitDuration(durationSec: number): boolean {
  const ms = Math.round(durationSec * 1000);
  return ms % 1000 === 0
    && ms >= AI_STORY_EXECUTION_UNIT_MIN_SEC * 1000
    && ms <= AI_STORY_EXECUTION_UNIT_MAX_SEC * 1000;
}

export type ExecutionUnitDurationChange = { sceneId: string; fromDurationSec: number; toDurationSec: number };

export type ExecutionUnitDurationAssessment = {
  contractVersion: typeof AI_STORY_EXECUTION_UNIT_DURATION_CONTRACT;
  minSec: number;
  maxSec: number;
  status: "COMPLIANT" | "CREATIVE_DECISION_REQUIRED";
  episodeDurationSec: number;
  /** Each Scene is exactly one generation unit; Scenes are never regrouped here. */
  units: { sceneId: string; order: number; durationSec: number; certified: boolean }[];
  decision: {
    question: string;
    unresolvedSceneIds: string[];
    option: {
      kind: "CHANGE_UNIT_DURATION";
      changes: ExecutionUnitDurationChange[];
      episodeDurationSec: number;
      creativeChanges: string[];
    };
  } | null;
};

type Scene = Pick<ScenePlanItem, "id" | "order" | "durationSec">;

function sum(values: readonly number[]): number {
  return Math.round(values.reduce((total, value) => total + value, 0) * 1000) / 1000;
}

function nearestCertifiedDuration(durationSec: number): number {
  return Math.min(AI_STORY_EXECUTION_UNIT_MAX_SEC, Math.max(AI_STORY_EXECUTION_UNIT_MIN_SEC, Math.round(durationSec)));
}

/**
 * Deterministic duration assessment over frozen Planning facts. Scene topology is
 * owned by the frozen Script, so the only executable recovery is a per-Scene
 * duration change, which is always surfaced as an explicit human decision.
 */
export function assessExecutionUnitDurations(input: { scenePlan: readonly Scene[] }): ExecutionUnitDurationAssessment {
  const scenes = [...input.scenePlan].sort((left, right) => left.order - right.order);
  const episodeDurationSec = sum(scenes.map((scene) => scene.durationSec));
  const units = scenes.map((scene) => ({
    sceneId: scene.id, order: scene.order, durationSec: scene.durationSec,
    certified: isCertifiedExecutionUnitDuration(scene.durationSec),
  }));
  const base = {
    contractVersion: AI_STORY_EXECUTION_UNIT_DURATION_CONTRACT,
    minSec: AI_STORY_EXECUTION_UNIT_MIN_SEC,
    maxSec: AI_STORY_EXECUTION_UNIT_MAX_SEC,
    episodeDurationSec,
    units,
  };
  const unresolved = units.filter((unit) => !unit.certified);
  if (unresolved.length === 0) return { ...base, status: "COMPLIANT", decision: null };
  const changes = unresolved.map((unit) => ({
    sceneId: unit.sceneId, fromDurationSec: unit.durationSec, toDurationSec: nearestCertifiedDuration(unit.durationSec),
  }));
  const resizedEpisode = sum(units.map((unit) => changes.find((change) => change.sceneId === unit.sceneId)?.toDurationSec ?? unit.durationSec));
  return {
    ...base,
    status: "CREATIVE_DECISION_REQUIRED",
    decision: {
      question: `${unresolved.map((unit) => `${unit.sceneId} (${unit.durationSec}s)`).join(", ")} must become ${AI_STORY_EXECUTION_UNIT_MIN_SEC}–${AI_STORY_EXECUTION_UNIT_MAX_SEC} whole-second generation units. Approve the duration change to create a successor Planning revision.`,
      unresolvedSceneIds: unresolved.map((unit) => unit.sceneId),
      option: {
        kind: "CHANGE_UNIT_DURATION",
        changes,
        episodeDurationSec: resizedEpisode,
        creativeChanges: [
          ...changes.map((change) => `${change.sceneId} changes from ${change.fromDurationSec}s to ${change.toDurationSec}s`),
          `Episode length changes from ${episodeDurationSec}s to ${resizedEpisode}s`,
        ],
      },
    },
  };
}

export class ExecutionUnitDurationChangeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ExecutionUnitDurationChangeError";
  }
}

/** Splits a total across weights in whole milliseconds, preserving the exact total. */
function scaleShotDurations(shots: readonly number[], targetSec: number): number[] {
  const targetMs = Math.round(targetSec * 1000);
  const weights = shots.map((value) => Math.max(1, Math.round(value * 1000)));
  const totalWeight = weights.reduce((total, value) => total + value, 0);
  const raw = weights.map((weight) => (weight * targetMs) / totalWeight);
  const floors = raw.map(Math.floor);
  let remainder = targetMs - floors.reduce((total, value) => total + value, 0);
  const order = raw.map((value, index) => ({ index, fraction: value - floors[index]! }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const { index } of order) {
    if (remainder <= 0) break;
    floors[index]! += 1;
    remainder -= 1;
  }
  return floors.map((ms) => ms / 1000);
}

/**
 * Applies a human-authorized duration change without touching Scene topology,
 * order, purpose, transitions, continuity, beats, camera language or authority.
 * Extra time is distributed across the Scene's existing Shots proportionally,
 * so it only lengthens holds and already-planned camera motion.
 */
export function applyExecutionUnitDurationChanges<
  S extends Pick<ScenePlanItem, "id" | "order" | "durationSec">,
  T extends Pick<ShotPlanItem, "id" | "sceneId" | "order" | "durationSec">,
>(input: {
  scenePlan: readonly S[];
  shotPlan: readonly T[];
  durations: readonly { sceneId: string; durationSec: number }[];
}): { scenePlan: S[]; shotPlan: T[]; changes: ExecutionUnitDurationChange[] } {
  const requested = new Map<string, number>();
  for (const item of input.durations) {
    if (requested.has(item.sceneId)) {
      throw new ExecutionUnitDurationChangeError("EXECUTION_UNIT_DURATION_CHANGE_DUPLICATE", `Scene ${item.sceneId} is listed more than once`);
    }
    if (!input.scenePlan.some((scene) => scene.id === item.sceneId)) {
      throw new ExecutionUnitDurationChangeError("EXECUTION_UNIT_DURATION_SCENE_UNKNOWN", `Scene ${item.sceneId} is not in the source Planning revision`);
    }
    if (!isCertifiedExecutionUnitDuration(item.durationSec)) {
      throw new ExecutionUnitDurationChangeError(
        "EXECUTION_UNIT_DURATION_UNSUPPORTED",
        `Scene ${item.sceneId} must be a whole number of seconds from ${AI_STORY_EXECUTION_UNIT_MIN_SEC} to ${AI_STORY_EXECUTION_UNIT_MAX_SEC}`,
      );
    }
    requested.set(item.sceneId, item.durationSec);
  }
  const changes: ExecutionUnitDurationChange[] = [];
  const scenePlan = input.scenePlan.map((scene) => {
    const target = requested.get(scene.id);
    if (target === undefined || target === scene.durationSec) return scene;
    changes.push({ sceneId: scene.id, fromDurationSec: scene.durationSec, toDurationSec: target });
    return { ...scene, durationSec: target };
  });
  const uncertified = scenePlan.filter((scene) => !isCertifiedExecutionUnitDuration(scene.durationSec));
  if (uncertified.length) {
    throw new ExecutionUnitDurationChangeError(
      "EXECUTION_UNIT_DURATION_INCOMPLETE",
      `${uncertified.map((scene) => scene.id).join(", ")} would remain outside the certified generation range`,
    );
  }
  const shotPlan = [...input.shotPlan];
  for (const change of changes) {
    const indexes = shotPlan
      .map((shot, index) => ({ shot, index }))
      .filter(({ shot }) => shot.sceneId === change.sceneId)
      .sort((left, right) => left.shot.order - right.shot.order);
    if (indexes.length === 0) {
      throw new ExecutionUnitDurationChangeError("EXECUTION_UNIT_DURATION_SHOTS_MISSING", `Scene ${change.sceneId} has no Shots to carry its duration`);
    }
    const scaled = scaleShotDurations(indexes.map(({ shot }) => shot.durationSec), change.toDurationSec);
    indexes.forEach(({ shot, index }, position) => {
      shotPlan[index] = { ...shot, durationSec: scaled[position]! };
    });
  }
  return { scenePlan, shotPlan, changes };
}
