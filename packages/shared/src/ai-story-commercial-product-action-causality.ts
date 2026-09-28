import type { AiStoryScriptVersion } from "./ai-story-script";

export const COMMERCIAL_PRODUCT_ACTION_CAUSALITY_GATE =
  "COMMERCIAL_PRODUCT_ACTION_CAUSALITY_REQUIRED" as const;

const PHYSICAL_DIMENSIONS = new Set(["POSSESSION", "LOCATION", "PHYSICAL_CONDITION", "PRODUCT_STATE"]);

type ScriptScene = AiStoryScriptVersion["scenes"][number];
type StateDelta = NonNullable<Extract<ScriptScene["entries"][number], { type: "ACTION" }>["stateDelta"]>;

export type CommercialProductActionCausalityIssue = {
  gate: typeof COMMERCIAL_PRODUCT_ACTION_CAUSALITY_GATE;
  severity: "BLOCK";
  message: string;
};

function completePhysicalDeltas(scene: ScriptScene) {
  return scene.sceneStateDeltas.filter((delta) =>
    PHYSICAL_DIMENSIONS.has(delta.dimension)
    && typeof delta.fromValue === "string"
    && delta.fromValue.length > 0
    && delta.fromValue !== delta.value
  );
}

function sameProductDelta(left: StateDelta, right: { dimension: string; subjectId: string; fromValue?: string | null; value: string }) {
  return left.dimension === "PRODUCT_STATE"
    && left.dimension === right.dimension
    && left.subjectId === right.subjectId
    && left.fromValue === right.fromValue
    && left.value === right.value;
}

/**
 * A product scene with exactly one complete PRODUCT_STATE change must bind that
 * change to its single causal ACTION. Scene-level KNOWLEDGE stays where it is.
 * Ambiguous physical changes or candidate actions fail closed.
 */
export function evaluateCommercialProductActionCausality(
  script: { scenes: readonly ScriptScene[] },
): CommercialProductActionCausalityIssue[] {
  const issues: CommercialProductActionCausalityIssue[] = [];
  for (const scene of script.scenes) {
    const physical = completePhysicalDeltas(scene);
    const product = physical.filter((delta) => delta.dimension === "PRODUCT_STATE");
    if (product.length === 0 && physical.length === 0) continue;
    const fail = (message: string) => issues.push({
      gate: COMMERCIAL_PRODUCT_ACTION_CAUSALITY_GATE,
      severity: "BLOCK",
      message,
    });
    if (product.length !== 1 || physical.length !== 1) {
      fail(`Scene ${scene.scriptSceneId} does not have exactly one causal PRODUCT_STATE change`);
      continue;
    }
    const actions = scene.entries.filter((entry) => entry.type === "ACTION");
    if (actions.length !== 1) {
      fail(`Scene ${scene.scriptSceneId} does not have exactly one causal ACTION for its PRODUCT_STATE change`);
      continue;
    }
    const delta = actions[0]!.stateDelta;
    if (!delta || !sameProductDelta(delta, product[0]!)) {
      fail(`Scene ${scene.scriptSceneId} ACTION does not carry the scene PRODUCT_STATE change`);
    }
  }
  return issues;
}

export class ProductActionCausalityError extends Error {
  constructor(readonly code: "ACTION_STATE_DELTA_CARDINALITY_BLOCKER", message: string) {
    super(`${code}: ${message}`);
    this.name = "ProductActionCausalityError";
  }
}

/** Copies the scene PRODUCT_STATE delta onto the single ACTION. Scene deltas are unchanged. */
export function bindCommercialProductActionStateDelta<T extends ScriptScene>(scene: T): T {
  const physical = completePhysicalDeltas(scene);
  const product = physical.filter((delta) => delta.dimension === "PRODUCT_STATE");
  const actions = scene.entries.filter((entry) => entry.type === "ACTION");
  if (product.length !== 1 || physical.length !== 1 || actions.length !== 1) {
    throw new ProductActionCausalityError(
      "ACTION_STATE_DELTA_CARDINALITY_BLOCKER",
      `Scene ${scene.scriptSceneId} cannot bind one PRODUCT_STATE change to one ACTION`,
    );
  }
  const productDelta = product[0]!;
  return {
    ...scene,
    sceneStateIn: scene.sceneStateIn.map((fact) => ({ ...fact })),
    sceneStateDeltas: scene.sceneStateDeltas.map((delta) => ({ ...delta })),
    sceneStateOut: scene.sceneStateOut.map((fact) => ({ ...fact })),
    entries: scene.entries.map((entry) => entry.type === "ACTION" && entry.entryId === actions[0]!.entryId
      ? {
          ...entry,
          stateDelta: {
            dimension: "PRODUCT_STATE" as const,
            subjectId: productDelta.subjectId,
            value: productDelta.value,
            fromValue: productDelta.fromValue,
            reason: productDelta.reason,
          },
        }
      : entry),
  };
}
