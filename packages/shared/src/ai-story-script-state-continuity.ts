import type { AiStoryScriptSemanticProposalV1 } from "./ai-story-script-semantic-writer";

const PHYSICAL_DIMENSIONS = new Set([
  "POSSESSION",
  "LOCATION",
  "PHYSICAL_CONDITION",
  "PRODUCT_STATE",
]);

type ProposalScene = AiStoryScriptSemanticProposalV1["scenes"][number];

const keyOf = (fact: { dimension: string; subjectId: string }) =>
  `${fact.dimension}:${fact.subjectId}`;

/**
 * Projects unchanged story-world state across Scene boundaries.
 * Omitted physical facts are copied forward. A non-physical fact that the
 * model restated as a new incoming value is rebased onto the previous
 * outgoing value when that Scene already has an in-scene delta for it.
 * A different physical value is left in place so the continuity gate still
 * rejects an unexplained product, pose, or location reset.
 */
export function carryForwardUnchangedScriptSceneState(
  scenes: readonly ProposalScene[],
): ProposalScene[] {
  const next = scenes.map((scene) => ({
    ...scene,
    sceneStateIn: scene.sceneStateIn.map((fact) => ({ ...fact })),
    sceneStateDeltas: scene.sceneStateDeltas.map((delta) => ({ ...delta })),
    sceneStateOut: scene.sceneStateOut.map((fact) => ({ ...fact })),
  }));

  for (let index = 1; index < next.length; index += 1) {
    const prior = next[index - 1]!;
    const scene = next[index]!;
    for (const fact of prior.sceneStateOut) {
      const key = keyOf(fact);
      const incoming = scene.sceneStateIn.find((item) => keyOf(item) === key);
      if (!incoming) {
        if (!PHYSICAL_DIMENSIONS.has(fact.dimension)) continue;
        const outgoing = scene.sceneStateOut.find((item) => keyOf(item) === key);
        if (outgoing && outgoing.value !== fact.value) {
          scene.sceneStateIn.push({ ...fact, value: outgoing.value });
          continue;
        }
        scene.sceneStateIn.push({ ...fact });
        if (!outgoing) scene.sceneStateOut.push({ ...fact });
        continue;
      }
      if (incoming.value === fact.value || PHYSICAL_DIMENSIONS.has(fact.dimension)) continue;
      const delta = scene.sceneStateDeltas.find(
        (item) => keyOf(item) === key && item.fromValue === incoming.value,
      );
      if (!delta) continue;
      incoming.value = fact.value;
      delta.fromValue = fact.value;
    }
  }

  return next;
}
