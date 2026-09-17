import {
  AI_STORY_ANIMATION_PACKAGE_CANONICAL_SCENE_BINDING_CONTRACT_VERSION,
  AiStoryAnimationPackageCanonicalSceneAuthoritySchema,
  type AiStoryAnimationPackageCanonicalSceneAuthority,
  type ScenePlanItem,
} from "./ai-story";
import type { AiStoryCanonicalScene } from "./ai-story-scene";
import { sha256CanonicalIntegrityHash } from "./canonical-integrity";

export class AiStoryAnimationPackageCanonicalSceneBindingError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryAnimationPackageCanonicalSceneBindingError";
  }
}

export function computeAiStoryCanonicalSceneSetFingerprint(input: {
  storyId: string;
  storyVersionId: string;
  scriptVersionId: string;
  scenes: readonly Pick<AiStoryCanonicalScene, "sceneId" | "sceneVersionId" | "fingerprint" | "order">[];
}): string {
  return sha256CanonicalIntegrityHash({
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    scriptVersionId: input.scriptVersionId,
    scenes: [...input.scenes]
      .sort((left, right) => left.order - right.order)
      .map((scene) => ({
        sceneId: scene.sceneId,
        sceneVersionId: scene.sceneVersionId,
        sceneFingerprint: scene.fingerprint,
        order: scene.order,
      })),
  });
}

export function buildAiStoryAnimationPackageCanonicalSceneAuthorityV1(input: {
  storyId: string;
  storyVersionId: string;
  scenePlan: readonly ScenePlanItem[];
  canonicalScenes: readonly AiStoryCanonicalScene[];
}): AiStoryAnimationPackageCanonicalSceneAuthority {
  const scenePlan = [...input.scenePlan].sort((a, b) => a.order - b.order);
  const scenes = [...input.canonicalScenes].sort((a, b) => a.order - b.order);
  if (!scenes.length || scenePlan.length !== scenes.length) {
    throw new AiStoryAnimationPackageCanonicalSceneBindingError(
      "ANIMATION_PACKAGE_CANONICAL_SCENE_MAPPING_INVALID",
      "Animation Package planning and Canonical Scene counts differ"
    );
  }
  const scriptVersionId = scenes[0]!.scriptVersionId;
  if (
    scenePlan.some((scene, index) => scene.order !== index) ||
    scenes.some((scene, index) =>
      scene.order !== index ||
      scene.status !== "FROZEN" ||
      scene.storyId !== input.storyId ||
      scene.storyVersionId !== input.storyVersionId ||
      scene.scriptVersionId !== scriptVersionId
    )
  ) {
    throw new AiStoryAnimationPackageCanonicalSceneBindingError(
      "ANIMATION_PACKAGE_CANONICAL_SCENE_MAPPING_INVALID",
      "Animation Package Canonical Scene mapping is not exact, current, ordered, and FROZEN"
    );
  }
  if (scenes.some((scene, index) =>
    !scene.generationAuthority ||
    !scenePlan[index]?.generationAuthority ||
    sha256CanonicalIntegrityHash(scene.generationAuthority) !==
      sha256CanonicalIntegrityHash(scenePlan[index]!.generationAuthority)
  )) {
    throw new AiStoryAnimationPackageCanonicalSceneBindingError(
      "ANIMATION_PACKAGE_CANONICAL_SCENE_MODE_AUTHORITY_INVALID",
      "Every current Canonical Scene must retain the exact explicit planning generation mode"
    );
  }
  return AiStoryAnimationPackageCanonicalSceneAuthoritySchema.parse({
    contractVersion: AI_STORY_ANIMATION_PACKAGE_CANONICAL_SCENE_BINDING_CONTRACT_VERSION,
    scriptVersionId,
    sceneSetFingerprint: computeAiStoryCanonicalSceneSetFingerprint({
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      scriptVersionId,
      scenes,
    }),
    scenes: scenes.map((scene, index) => ({
      order: scene.order,
      planningSceneId: scenePlan[index]!.id,
      sceneId: scene.sceneId,
      sceneVersionId: scene.sceneVersionId,
      sceneFingerprint: scene.fingerprint,
      sourceScriptSceneIds: scene.sourceScriptSceneIds,
      generationAuthority: scene.generationAuthority,
    })),
  });
}

export function assertAiStoryAnimationPackageCanonicalSceneAuthorityCurrent(input: {
  storyId: string;
  storyVersionId: string;
  scenePlan: readonly ScenePlanItem[];
  canonicalScenes: readonly AiStoryCanonicalScene[];
  authority: AiStoryAnimationPackageCanonicalSceneAuthority | undefined;
}): AiStoryAnimationPackageCanonicalSceneAuthority {
  if (!input.authority) {
    throw new AiStoryAnimationPackageCanonicalSceneBindingError(
      "ANIMATION_PACKAGE_CANONICAL_SCENE_AUTHORITY_MISSING",
      "Animation Package lacks Canonical Scene authority"
    );
  }
  const expected = buildAiStoryAnimationPackageCanonicalSceneAuthorityV1(input);
  if (
    sha256CanonicalIntegrityHash(input.authority) !==
    sha256CanonicalIntegrityHash(expected)
  ) {
    throw new AiStoryAnimationPackageCanonicalSceneBindingError(
      "ANIMATION_PACKAGE_CANONICAL_SCENE_AUTHORITY_STALE",
      "Animation Package Canonical Scene authority is stale"
    );
  }
  return expected;
}
