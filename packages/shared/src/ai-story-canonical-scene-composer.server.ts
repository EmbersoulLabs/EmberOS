import { deterministicUuidFromFingerprint } from "./canonical-integrity";
import {
  AiStoryCastReferenceSchema,
  type AiStoryCastReference,
} from "./ai-story-cast";
import {
  type AiStoryOutlineVersion,
} from "./ai-story-outline";
import {
  type AiStoryScriptScene,
  type AiStoryScriptVersion,
} from "./ai-story-script";
import {
  type PlanningCharacterAuthorityProjection,
  type ScenePlanItem,
  type WorldContinuity,
} from "./ai-story";
import {
  type AiStoryAuthoritativeCanonicalScene,
  type AiStoryCanonicalScene,
} from "./ai-story-scene";
import { finalizeAiStoryCanonicalScene } from "./ai-story-scene.server";
import { assertExplicitAiStorySceneGenerationMode } from "./ai-story-generation-authority";

export const AI_STORY_CANONICAL_SCENE_COMPOSER_V1 = Object.freeze({
  contractVersion: "ai-story-canonical-scene-composer.v1" as const,
  topology: "ONE_SCRIPT_SCENE_TO_ONE_CANONICAL_SCENE" as const,
  sceneRolePolicy: "SCRIPT_SCENE_FUNCTION" as const,
  importancePolicy: "ALL_CLAIMED_BEATS_MAJOR" as const,
  locationPolicy: "EPHEMERAL_ENVIRONMENT" as const,
});

export class AiStoryCanonicalSceneComposerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryCanonicalSceneComposerError";
  }
}

export type AiStoryCanonicalSceneProductSourceV1 = {
  assetId: string;
  contentHash: string;
};

export type ComposeAiStoryCanonicalSceneSetV1Input = {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  actorUserId: string;
  frozenOutline: AiStoryOutlineVersion;
  frozenScript: AiStoryScriptVersion;
  scenePlan: ScenePlanItem[];
  worldContinuity: WorldContinuity;
  characterAuthorities: PlanningCharacterAuthorityProjection[];
  productSources: AiStoryCanonicalSceneProductSourceV1[];
  currentScenes?: AiStoryCanonicalScene[];
  createdAt: string;
};

function fail(code: string, message: string): never {
  throw new AiStoryCanonicalSceneComposerError(code, message);
}

export function canonicalAiStorySceneIdV1(storyId: string, storyVersionId: string, order: number) {
  return deterministicUuidFromFingerprint(
    "ai-story-canonical-scene-v1",
    `${storyId}:${storyVersionId}:${order}`,
  );
}

function locationDescription(world: WorldContinuity, scene: ScenePlanItem) {
  return [world.environment, scene.purpose, scene.continuityNotes]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n\n");
}

function castBindings(
  scene: AiStoryScriptScene,
  script: AiStoryScriptVersion,
  campaignId: string,
  characterAuthorities: readonly PlanningCharacterAuthorityProjection[],
) {
  const exact = (scene.castReferences ?? []).map((reference) => AiStoryCastReferenceSchema.parse(reference));
  const represented = new Set(exact.map((reference) => reference.id));
  const scriptReferences = new Map(
    script.authorityReferences
      .filter((reference) => reference.authorityType === "CHARACTER")
      .map((reference) => [reference.authorityId, reference] as const),
  );
  const current = new Map(characterAuthorities.map((authority) => [authority.characterId, authority] as const));
  const added: AiStoryCastReference[] = [];
  for (const characterId of [...scene.characterIds].sort()) {
    if (represented.has(characterId)) continue;
    const reference = scriptReferences.get(characterId);
    const authority = current.get(characterId);
    if (
      !reference?.authorityVersionId || !reference.authorityFingerprint || !authority ||
      authority.characterVersionId !== reference.authorityVersionId ||
      authority.characterFingerprint !== reference.authorityFingerprint
    ) {
      fail("CANONICAL_SCENE_CHARACTER_AUTHORITY_UNRESOLVED", `Character ${characterId} does not resolve to the exact Script snapshot`);
    }
    added.push(AiStoryCastReferenceSchema.parse({
      scope: "CAMPAIGN_CHARACTER",
      id: characterId,
      campaignId,
      authorityVersionId: reference.authorityVersionId,
      authorityFingerprint: reference.authorityFingerprint,
      visualIdentityRequirement: "PREFERRED",
    }));
  }
  return [...exact, ...added];
}

function productRequirement(scene: AiStoryScriptScene, productId: string) {
  const functions = new Set(
    (scene.productStoryContributions ?? [])
      .filter((contribution) => contribution.productAuthorityIds.includes(productId))
      .map((contribution) => contribution.semanticFunction),
  );
  if (["PRODUCT_INTRODUCTION", "PRODUCT_DETAIL_REVEAL", "PRODUCT_EVIDENCE"].some((value) => functions.has(value))) {
    return "REQUIRED" as const;
  }
  return "PREFERRED" as const;
}

function assertTopology(input: ComposeAiStoryCanonicalSceneSetV1Input) {
  if (!input.frozenScript.scenes.length || input.frozenScript.scenes.length !== input.scenePlan.length) {
    fail("CANONICAL_SCENE_TOPOLOGY_CHANGE_UNSUPPORTED_V1", "Script Scene and Scene Plan counts must match exactly");
  }
  const orderedScript = [...input.frozenScript.scenes].sort((a, b) => a.order - b.order);
  const orderedPlan = [...input.scenePlan].sort((a, b) => a.order - b.order);
  if (orderedScript.some((scene, index) => scene.order !== index) || orderedPlan.some((scene, index) => scene.order !== index)) {
    fail("CANONICAL_SCENE_TOPOLOGY_CHANGE_UNSUPPORTED_V1", "Script and Scene Plan orders must be contiguous from zero");
  }
  return { orderedScript, orderedPlan };
}

function candidateInput(
  input: ComposeAiStoryCanonicalSceneSetV1Input,
  scriptScene: AiStoryScriptScene,
  scenePlan: ScenePlanItem,
  version: number,
  lineageOperation: "CREATE" | "REVISE",
  parentSceneVersionIds: string[],
  createdBy: string,
  createdAt: string,
) {
  if (!scenePlan.generationAuthority) {
    fail("CANONICAL_SCENE_GENERATION_MODE_AUTHORITY_MISSING", "Canonical Scene composition requires an explicit planning generation decision");
  }
  const sceneId = canonicalAiStorySceneIdV1(input.storyId, input.storyVersionId, scriptScene.order);
  const beatMap = new Map(input.frozenOutline.beats.map((beat) => [beat.id, beat] as const));
  for (const claim of scriptScene.outlineBeatClaims) {
    if (beatMap.get(claim.outlineBeatId)?.classification !== "MAJOR") {
      fail("CANONICAL_SCENE_IMPORTANCE_POLICY_UNSUPPORTED", `Claimed Beat ${claim.outlineBeatId} is not MAJOR`);
    }
  }
  const sourceMap = new Map(input.productSources.map((source) => [source.assetId, source] as const));
  const products = [...scriptScene.productAuthorityRefs].sort().map((productAuthorityId) => {
    const source = sourceMap.get(productAuthorityId);
    if (!source) fail("CANONICAL_SCENE_PRODUCT_AUTHORITY_UNRESOLVED", `Product ${productAuthorityId} does not resolve to a current source Asset`);
    return {
      productAuthorityId,
      sourceAssetId: source.assetId,
      sourceAssetContentHash: source.contentHash,
      visualIdentityRequirement: productRequirement(scriptScene, productAuthorityId),
    };
  });
  assertExplicitAiStorySceneGenerationMode({
    generationAuthority: scenePlan.generationAuthority,
    productBindings: products,
  });
  return {
    sceneId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    scriptVersionId: input.frozenScript.scriptVersionId,
    version,
    order: scriptScene.order,
    sourceScriptSceneIds: [scriptScene.scriptSceneId],
    sourceScriptEntryIds: scriptScene.entries.map((entry) => entry.entryId),
    sceneFunction: scriptScene.sceneFunction,
    sceneRole: scriptScene.sceneFunction,
    importance: "MAJOR" as const,
    locationBinding: {
      scope: "EPHEMERAL_ENVIRONMENT" as const,
      id: deterministicUuidFromFingerprint("ai-story-ephemeral-environment-v1", sceneId),
      storyId: input.storyId,
      sceneId,
      displayName: input.worldContinuity.location,
      environmentDescription: locationDescription(input.worldContinuity, scenePlan),
      visualIdentityRequirement: "NONE" as const,
    },
    locationState: { temporaryFacts: [] },
    castBindings: castBindings(scriptScene, input.frozenScript, input.campaignId, input.characterAuthorities),
    productBindings: products,
    generationAuthority: scenePlan.generationAuthority,
    entryState: structuredClone(scriptScene.sceneStateIn),
    events: structuredClone(scriptScene.entries),
    exitState: structuredClone(scriptScene.sceneStateOut),
    continuityFacts: [],
    timeRelation: "UNSPECIFIED" as const,
    discontinuity: null,
    mustKeep: [...scriptScene.mustKeep],
    mustAvoid: [...scriptScene.mustAvoid],
    lineageOperation,
    parentSceneVersionIds,
    createdBy,
    createdAt,
  };
}

/** Pure deterministic V1 promotion from exact Script/planning authority to a complete Scene set. */
export function composeAiStoryCanonicalSceneSetV1(
  input: ComposeAiStoryCanonicalSceneSetV1Input,
): AiStoryAuthoritativeCanonicalScene[] {
  if (
    input.frozenOutline.status !== "FROZEN" || input.frozenScript.status !== "FROZEN" ||
    input.frozenOutline.storyId !== input.storyId || input.frozenOutline.storyVersionId !== input.storyVersionId ||
    input.frozenScript.storyId !== input.storyId || input.frozenScript.storyVersionId !== input.storyVersionId ||
    input.frozenScript.outlineVersionId !== input.frozenOutline.outlineVersionId ||
    input.frozenScript.outlineSourceHash !== input.frozenOutline.sourceHash
  ) {
    fail("CANONICAL_SCENE_CURRENT_SCRIPT_REQUIRED", "Composer requires exact FROZEN Outline and Script lineage");
  }
  const { orderedScript, orderedPlan } = assertTopology(input);
  const current = [...(input.currentScenes ?? [])].sort((a, b) => a.order - b.order);
  if (current.length) {
    if (current.length !== orderedScript.length || current.some((scene, index) => scene.order !== index || scene.sceneId !== canonicalAiStorySceneIdV1(input.storyId, input.storyVersionId, index))) {
      fail("CANONICAL_SCENE_TOPOLOGY_CHANGE_UNSUPPORTED_V1", "Current Scene identities do not match the stable V1 topology");
    }
    if (new Set(current.map((scene) => scene.status)).size !== 1) {
      fail("CANONICAL_SCENE_SET_LIFECYCLE_AMBIGUOUS", "Current Scene set contains mixed lifecycle states");
    }
  }

  const comparable = orderedScript.map((scriptScene, index) => {
    const prior = current[index];
    return finalizeAiStoryCanonicalScene(candidateInput(
      input,
      scriptScene,
      orderedPlan[index]!,
      prior?.version ?? 1,
      prior?.lineageOperation === "REVISE" ? "REVISE" : "CREATE",
      prior ? [...prior.parentSceneVersionIds] : [],
      prior?.createdBy ?? input.actorUserId,
      prior?.createdAt ?? input.createdAt,
    ));
  });
  if (!current.length || comparable.every((scene, index) => scene.sourceHash === current[index]!.sourceHash)) {
    return comparable;
  }
  if (current[0]!.status !== "FROZEN") {
    fail("CANONICAL_SCENE_INCOMPLETE_LINEAGE_CONFLICT", "Different Scene semantics cannot replace an incomplete current set");
  }
  return orderedScript.map((scriptScene, index) => finalizeAiStoryCanonicalScene(candidateInput(
    input,
    scriptScene,
    orderedPlan[index]!,
    current[index]!.version + 1,
    "REVISE",
    [current[index]!.sceneVersionId],
    input.actorUserId,
    input.createdAt,
  )));
}
