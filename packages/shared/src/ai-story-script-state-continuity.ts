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

function sameText(left: string, right: string) {
  return left.trim().toLocaleLowerCase("en-US") === right.trim().toLocaleLowerCase("en-US");
}

/**
 * Drops physical deltas that do not change the scene's incoming and outgoing
 * value. A commercial contribution with no state change is dropped unless an
 * ACTION already uses one of its commercial authorities. A physical value that
 * actually changes is left untouched.
 */
export function dropUnchangedPhysicalScriptChanges(
  scenes: readonly ProposalScene[],
): ProposalScene[] {
  return scenes.map((scene) => {
    const incoming = new Map(scene.sceneStateIn.map((fact) => [keyOf(fact), fact.value]));
    const outgoing = new Map(scene.sceneStateOut.map((fact) => [keyOf(fact), fact.value]));
    const sceneStateDeltas = scene.sceneStateDeltas.filter((delta) => {
      if (!PHYSICAL_DIMENSIONS.has(delta.dimension)) return true;
      if (delta.fromValue !== null && delta.fromValue === delta.value) return false;
      return incoming.get(keyOf(delta)) !== outgoing.get(keyOf(delta));
    });
    const retained = new Set(sceneStateDeltas.map((delta) => JSON.stringify(delta)));
    const contribution = scene.commercialContribution;
    const productAction = contribution
      ? scene.entries.some((entry) =>
        entry.type === "ACTION"
        && entry.objectId !== undefined
        && contribution.commercialAuthorityIds.includes(entry.objectId))
      : false;
    const commercialContribution = contribution
      && (!sameText(contribution.preState, contribution.postState) || productAction)
      ? contribution
      : undefined;
    const { commercialContribution: _existing, ...rest } = scene;
    return {
      ...rest,
      sceneStateDeltas,
      entries: scene.entries.map((entry) => {
        if (entry.type !== "ACTION" || !entry.stateDelta) return entry;
        if (retained.has(JSON.stringify(entry.stateDelta))) return entry;
        if (!PHYSICAL_DIMENSIONS.has(entry.stateDelta.dimension)) return entry;
        const { stateDelta: _removed, ...action } = entry;
        return action;
      }),
      ...(commercialContribution ? { commercialContribution } : {}),
    };
  });
}

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
    entries: scene.entries.map((entry) => entry.type === "ACTION" && entry.stateDelta
      ? { ...entry, stateDelta: { ...entry.stateDelta } }
      : { ...entry }),
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
      const previousFrom = incoming.value;
      incoming.value = fact.value;
      delta.fromValue = fact.value;
      for (const entry of scene.entries) {
        if (
          entry.type === "ACTION"
          && entry.stateDelta
          && keyOf(entry.stateDelta) === key
          && entry.stateDelta.fromValue === previousFrom
          && entry.stateDelta.value === delta.value
        ) {
          entry.stateDelta.fromValue = fact.value;
        }
      }
    }
  }

  return next;
}

function boundCharacterSpeaker(speaker: string, characterNames: readonly string[]) {
  const normalized = speaker.trim().toLocaleLowerCase("en-US");
  return characterNames.some((name) => name.trim().toLocaleLowerCase("en-US") === normalized);
}

/**
 * A supplied line whose speaker is not a bound character authority is off-screen.
 * It stays in the scene as information. It is not spoken by an on-screen character.
 */
export function detachOffScreenSuppliedDialogue(
  scenes: readonly ProposalScene[],
  input: {
    characterNames: readonly string[];
    suppliedDialogue: readonly { speaker: string; line: string }[];
  },
): ProposalScene[] {
  const offScreenLines = new Set(
    input.suppliedDialogue
      .filter((line) => !boundCharacterSpeaker(line.speaker, input.characterNames))
      .map((line) => line.line.trim()),
  );
  if (offScreenLines.size === 0) return scenes.map((scene) => ({ ...scene, entries: [...scene.entries] }));
  return scenes.map((scene) => {
    const detached = scene.entries.filter(
      (entry) => entry.type === "DIALOGUE" && offScreenLines.has(entry.line.trim()),
    );
    if (detached.length === 0) return scene;
    const entries = scene.entries.filter(
      (entry) => !(entry.type === "DIALOGUE" && offScreenLines.has(entry.line.trim())),
    );
    const preserved = new Set(scene.newInformation.map((item) => item.trim()));
    const newInformation = [...scene.newInformation];
    for (const entry of detached) {
      if (entry.type !== "DIALOGUE" || preserved.has(entry.line.trim())) continue;
      preserved.add(entry.line.trim());
      newInformation.push(entry.line);
    }
    return {
      ...scene,
      entries: entries.length > 0 ? entries : scene.entries,
      newInformation,
    };
  });
}
