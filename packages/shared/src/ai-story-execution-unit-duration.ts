import type { ScenePlanItem, ShotPlanItem } from "./ai-story";

/** Whole-second window certified by every Desktop video workflow (V2/V3). */
export const AI_STORY_EXECUTION_UNIT_MIN_SEC = 5;
export const AI_STORY_EXECUTION_UNIT_MAX_SEC = 15;
export const AI_STORY_EXECUTION_UNIT_DURATION_CONTRACT = "ai-story-execution-unit-duration.v1" as const;

export function isCertifiedExecutionUnitDuration(durationSec: number): boolean {
  const ms = Math.round(durationSec * 1000);
  return ms % 1000 === 0
    && ms >= AI_STORY_EXECUTION_UNIT_MIN_SEC * 1000
    && ms <= AI_STORY_EXECUTION_UNIT_MAX_SEC * 1000;
}

export type ExecutionUnitBasis = "ORIGINAL_SCENE" | "FROZEN_CONTINUOUS_SHOT";

export type ExecutionUnitProposal = {
  sceneIds: string[];
  durationSec: number;
  certified: boolean;
  basis: ExecutionUnitBasis;
  /** Frozen continuityNotes that justify grouping; empty for an original Scene. */
  evidence: string[];
  /** Camera families of the grouped Shots, in order; a regroup keeps them as one take. */
  cameraSequence: string[];
};

export type ExecutionUnitDecisionOption =
  | {
      kind: "CONFIRM_CONTINUOUS_TAKE";
      sceneIds: string[];
      durationSec: number;
      cameraSequence: string[];
      episodeDurationSec: number;
      creativeChanges: string[];
    }
  | {
      kind: "CHANGE_UNIT_DURATION";
      changes: { sceneIds: string[]; fromDurationSec: number; toDurationSec: number }[];
      episodeDurationSec: number;
      creativeChanges: string[];
    };

export type ExecutionUnitDurationAssessment = {
  contractVersion: typeof AI_STORY_EXECUTION_UNIT_DURATION_CONTRACT;
  minSec: number;
  maxSec: number;
  status: "COMPLIANT" | "REGROUP_SUPPORTED_BY_FROZEN_FACTS" | "CREATIVE_DECISION_REQUIRED";
  episodeDurationSec: number;
  scenes: { sceneId: string; order: number; durationSec: number; certified: boolean }[];
  units: ExecutionUnitProposal[];
  /** Present only when frozen facts cannot produce certified units without a creative choice. */
  decision: { question: string; unresolvedSceneIds: string[]; options: ExecutionUnitDecisionOption[] } | null;
};

type Scene = Pick<ScenePlanItem, "id" | "order" | "durationSec" | "continuityNotes" | "transition" | "generationAuthority">;
type Shot = Pick<ShotPlanItem, "sceneId" | "order" | "cameraType">;

function sceneNumber(scene: Scene): number {
  const match = /(\d+)\s*$/.exec(scene.id);
  return match ? Number(match[1]) : scene.order + 1;
}

function mentionedSceneNumbers(note: string): Set<number> {
  const numbers = new Set<number>();
  for (const match of note.matchAll(/\bscenes?[\s_-]*0*(\d+)(?:\s*(?:,|and|&)\s*(?:scene[\s_-]*)?0*(\d+))*/gi)) {
    for (const part of match[0].matchAll(/0*(\d+)/g)) numbers.add(Number(part[1]));
  }
  return numbers;
}

const CONTINUOUS = /\b(merged|continuous|one shot|single shot|same shot|same take|one take|uninterrupted)\b/i;
const NEGATED = /\b(not|never|no longer|separate|cut to|hard cut)\b/i;

/** Only an explicit frozen note naming both adjacent Scenes as one continuous shot links them. */
function frozenContinuityEvidence(left: Scene, right: Scene): string[] {
  const pair = [sceneNumber(left), sceneNumber(right)];
  return [left.continuityNotes, right.continuityNotes].filter((note): note is string => {
    if (!note || !CONTINUOUS.test(note) || NEGATED.test(note)) return false;
    const mentioned = mentionedSceneNumbers(note);
    return pair.every((value) => mentioned.has(value));
  });
}

function firstFrameAssetId(authority: NonNullable<Scene["generationAuthority"]>): string | null {
  return "firstFrameAssetId" in authority ? authority.firstFrameAssetId ?? null : null;
}

function authorityKey(scene: Scene): string | null {
  const authority = scene.generationAuthority;
  if (!authority) return null;
  return JSON.stringify({
    strategy: authority.strategy,
    referenceSource: authority.referenceSource,
    referenceAssetIds: "referenceAssetIds" in authority ? [...authority.referenceAssetIds].sort() : null,
    firstFrameAssetId: firstFrameAssetId(authority),
    productVisualIdentityRequirement: authority.productVisualIdentityRequirement,
  });
}

/** Grouping never crosses a change of generation strategy, references or first-frame authority. */
function authorityCompatible(left: Scene, right: Scene): boolean {
  const key = authorityKey(left);
  return key !== null && key === authorityKey(right);
}

function cameraSequence(sceneIds: readonly string[], shots: readonly Shot[]): string[] {
  return sceneIds.flatMap((sceneId) => shots
    .filter((shot) => shot.sceneId === sceneId)
    .sort((left, right) => left.order - right.order)
    .map((shot) => shot.cameraType));
}

function sum(values: readonly number[]): number {
  return Math.round(values.reduce((total, value) => total + value, 0) * 1000) / 1000;
}

function minimumCertifiedDuration(durationSec: number): number {
  return Math.min(AI_STORY_EXECUTION_UNIT_MAX_SEC, Math.max(AI_STORY_EXECUTION_UNIT_MIN_SEC, Math.ceil(durationSec)));
}

/**
 * Deterministic duration assessment over frozen Planning facts. It groups adjacent
 * Scenes only where frozen continuity notes already state one continuous shot and
 * the generation authority is identical. Anything else is surfaced as a single
 * explicit creative decision; this function never invents continuity or timing.
 */
export function assessExecutionUnitDurations(input: {
  scenePlan: readonly Scene[];
  shotPlan: readonly Shot[];
}): ExecutionUnitDurationAssessment {
  const scenes = [...input.scenePlan].sort((left, right) => left.order - right.order);
  const episodeDurationSec = sum(scenes.map((scene) => scene.durationSec));
  const sceneFacts = scenes.map((scene) => ({
    sceneId: scene.id, order: scene.order, durationSec: scene.durationSec,
    certified: isCertifiedExecutionUnitDuration(scene.durationSec),
  }));
  const base = {
    contractVersion: AI_STORY_EXECUTION_UNIT_DURATION_CONTRACT,
    minSec: AI_STORY_EXECUTION_UNIT_MIN_SEC,
    maxSec: AI_STORY_EXECUTION_UNIT_MAX_SEC,
    episodeDurationSec,
    scenes: sceneFacts,
  };
  const original = (scene: Scene): ExecutionUnitProposal => ({
    sceneIds: [scene.id], durationSec: scene.durationSec,
    certified: isCertifiedExecutionUnitDuration(scene.durationSec), basis: "ORIGINAL_SCENE",
    evidence: [], cameraSequence: cameraSequence([scene.id], input.shotPlan),
  });
  if (sceneFacts.every((scene) => scene.certified)) {
    return { ...base, status: "COMPLIANT", units: scenes.map(original), decision: null };
  }

  const units: ExecutionUnitProposal[] = [];
  for (let index = 0; index < scenes.length;) {
    const run = [scenes[index]!];
    const evidence: string[] = [];
    while (index + run.length < scenes.length) {
      const previous = run[run.length - 1]!;
      const next = scenes[index + run.length]!;
      const linked = frozenContinuityEvidence(previous, next);
      if (linked.length === 0 || !authorityCompatible(previous, next)) break;
      run.push(next);
      evidence.push(...linked.filter((note) => !evidence.includes(note)));
    }
    const runIds = run.map((scene) => scene.id);
    const allCertified = run.every((scene) => isCertifiedExecutionUnitDuration(scene.durationSec));
    if (run.length > 1 && !allCertified) {
      const durationSec = sum(run.map((scene) => scene.durationSec));
      units.push({
        sceneIds: runIds, durationSec, certified: isCertifiedExecutionUnitDuration(durationSec),
        basis: "FROZEN_CONTINUOUS_SHOT", evidence, cameraSequence: cameraSequence(runIds, input.shotPlan),
      });
    } else {
      units.push(...run.map(original));
    }
    index += run.length;
  }
  if (units.every((unit) => unit.certified)) {
    return { ...base, status: "REGROUP_SUPPORTED_BY_FROZEN_FACTS", units, decision: null };
  }

  const unresolved = units.filter((unit) => !unit.certified);
  const options: ExecutionUnitDecisionOption[] = [];
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  // Smallest authority-compatible window of adjacent units around each unresolved unit.
  for (const target of unresolved) {
    const start = units.indexOf(target);
    let best: { from: number; to: number } | null = null;
    for (let from = start; from >= 0; from -= 1) {
      for (let to = start; to < units.length; to += 1) {
        const window = units.slice(from, to + 1);
        const windowScenes = window.flatMap((unit) => unit.sceneIds.map((id) => sceneById.get(id)!));
        const compatible = windowScenes.every((scene, i) => i === 0 || authorityCompatible(windowScenes[i - 1]!, scene));
        if (!compatible || window.length < 2) continue;
        if (!isCertifiedExecutionUnitDuration(sum(window.map((unit) => unit.durationSec)))) continue;
        if (!best || (to - from) < (best.to - best.from)) best = { from, to };
      }
    }
    if (best) {
      const window = units.slice(best.from, best.to + 1);
      const sceneIds = window.flatMap((unit) => unit.sceneIds);
      const camera = cameraSequence(sceneIds, input.shotPlan);
      const removedCuts = window.length - 1;
      const reanchored = window.slice(1).map((unit) => unit.sceneIds[0]!)
        .filter((id) => {
          const authority = sceneById.get(id)?.generationAuthority;
          return authority ? firstFrameAssetId(authority) !== null : false;
        });
      const option: ExecutionUnitDecisionOption = {
        kind: "CONFIRM_CONTINUOUS_TAKE",
        sceneIds,
        durationSec: sum(window.map((unit) => unit.durationSec)),
        cameraSequence: camera,
        episodeDurationSec,
        creativeChanges: [
          `Removes ${removedCuts} Scene cut${removedCuts === 1 ? "" : "s"} that frozen continuity does not mark as continuous`,
          `Camera progression ${camera.join(" → ")} is performed inside one generation`,
          ...(reanchored.length ? [`Removes the explicit first-frame restart at ${reanchored.join(", ")}`] : []),
        ],
      };
      if (!options.some((existing) => JSON.stringify(existing) === JSON.stringify(option))) options.push(option);
    }
  }
  const resized = unresolved.map((unit) => ({ unit, to: minimumCertifiedDuration(unit.durationSec) }));
  const resizedEpisode = sum([
    ...units.filter((unit) => unit.certified).map((unit) => unit.durationSec),
    ...resized.map((item) => item.to),
  ]);
  options.push({
    kind: "CHANGE_UNIT_DURATION",
    changes: resized.map(({ unit, to }) => ({ sceneIds: unit.sceneIds, fromDurationSec: unit.durationSec, toDurationSec: to })),
    episodeDurationSec: resizedEpisode,
    creativeChanges: [
      ...resized.map(({ unit, to }) => `${unit.sceneIds.join(" + ")} changes from ${unit.durationSec}s to ${to}s`),
      `Episode length changes from ${episodeDurationSec}s to ${resizedEpisode}s`,
    ],
  });
  return {
    ...base,
    status: "CREATIVE_DECISION_REQUIRED",
    units,
    decision: {
      question: `Frozen Planning facts cannot form ${AI_STORY_EXECUTION_UNIT_MIN_SEC}–${AI_STORY_EXECUTION_UNIT_MAX_SEC}s generation units for ${unresolved.flatMap((unit) => unit.sceneIds).join(", ")} without a creative change. Choose one option.`,
      unresolvedSceneIds: unresolved.flatMap((unit) => unit.sceneIds),
      options,
    },
  };
}
