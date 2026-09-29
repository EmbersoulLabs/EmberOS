import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "./canonical-integrity";
import {
  AI_STORY_NATIVE_DIALOGUE_CONTRACT_VERSION,
  AiStoryCharacterDialoguePerformanceAuthoritySchema,
  type AiStoryCharacterDialoguePerformanceAuthority,
} from "./ai-story-native-dialogue";
import type { AiStoryGenerationUnit } from "./ai-story-generation-unit";
import { compileAiStoryGenerationPlan } from "./ai-story-generation-unit.server";
import type { AiStoryScriptVersion } from "./ai-story-script";
import type { AiStoryCanonicalScene } from "./ai-story-scene";
import type { AiStoryDirectorPlan } from "./ai-story-director-plan";
import type { AiStoryMotionPlan } from "./ai-story-motion-plan";
import type { AiStoryEpisodeIntentAuthority } from "./ai-story-episode-intent";
import {
  AI_STORY_AUDIO_LOCALES,
  AI_STORY_DELIVERY_STYLES,
  type AiStoryCodeSwitchPolicySchema,
} from "./ai-story-audio-plan";
import type { z } from "zod";

type Locale = (typeof AI_STORY_AUDIO_LOCALES)[number];
type DeliveryStyle = (typeof AI_STORY_DELIVERY_STYLES)[number];
type CodeSwitchPolicy = z.infer<typeof AiStoryCodeSwitchPolicySchema>;

export class AiStoryNativeDialogueAuthorityError extends Error {
  constructor(
    readonly code:
      | "NATIVE_DIALOGUE_AUTHORITY_INVALID"
      | "NATIVE_DIALOGUE_SCRIPT_MISMATCH"
      | "NATIVE_DIALOGUE_CHARACTER_MISMATCH"
      | "VISIBLE_DIALOGUE_AUDIO_AUTHORITY_CONFLICT",
    message: string
  ) {
    super(message);
    this.name = "AiStoryNativeDialogueAuthorityError";
  }
}

export type VisibleDialogueDetachedTtsBinding = {
  readonly dialogueEntryId: string;
};

/**
 * Fail-closed before Provider submission: a visible native-AV dialogue entry
 * cannot also bind detached TTS.
 */
export function assertVisibleDialogueAudioAuthorityExclusive(input: {
  readonly nativeDialogueAuthorities: readonly AiStoryCharacterDialoguePerformanceAuthority[];
  readonly detachedTtsBindings: readonly VisibleDialogueDetachedTtsBinding[];
}): void {
  for (const authority of input.nativeDialogueAuthorities) {
    const parsed =
      AiStoryCharacterDialoguePerformanceAuthoritySchema.parse(authority);
    if (!parsed.onScreenSpeaker || !parsed.nativeAvRequired) {
      continue;
    }
    const conflict = input.detachedTtsBindings.find(
      (binding) => binding.dialogueEntryId === parsed.dialogueEntryId
    );
    if (conflict) {
      fail(
        "VISIBLE_DIALOGUE_AUDIO_AUTHORITY_CONFLICT",
        `Visible native-AV dialogue ${parsed.dialogueEntryId} cannot also bind detached TTS`
      );
    }
  }
}

function fail(
  code: AiStoryNativeDialogueAuthorityError["code"],
  message: string
): never {
  throw new AiStoryNativeDialogueAuthorityError(code, message);
}

export function computeAiStoryNativeDialogueFingerprint(
  input: Omit<
    AiStoryCharacterDialoguePerformanceAuthority,
    "dialogueAuthorityId" | "dialogueFingerprint"
  >
): string {
  return sha256CanonicalIntegrityHash({
    kind: AI_STORY_NATIVE_DIALOGUE_CONTRACT_VERSION,
    ...input,
  });
}

export function compileAiStoryCharacterDialoguePerformanceAuthority(input: {
  readonly script: AiStoryScriptVersion;
  readonly generationUnit: AiStoryGenerationUnit;
  readonly scriptSceneId: string;
  readonly dialogueEntryId: string;
  readonly primaryLocale: Locale;
  readonly secondaryLocales: readonly Locale[];
  readonly codeSwitchPolicy: CodeSwitchPolicy;
  readonly deliveryStyle: DeliveryStyle;
  readonly performanceIntent: string;
  readonly emotionIntent: string;
  readonly speechIntensity: "SOFT" | "NATURAL" | "EMPHATIC";
  readonly paceIntent: "SLOW" | "MEASURED" | "NATURAL" | "BRISK";
  readonly mustPreserve?: readonly string[];
  readonly mustAvoid?: readonly string[];
  /**
   * Commercial Generation Units bind the canonical Scene id. Pass that id when
   * the caller has already proved the canonical Scene owns this Script Scene.
   * Historical callers keep the Script Scene id on the Generation Unit.
   */
  readonly boundCanonicalSceneId?: string;
}): AiStoryCharacterDialoguePerformanceAuthority {
  if (input.script.status !== "FROZEN") {
    fail(
      "NATIVE_DIALOGUE_AUTHORITY_INVALID",
      "Native dialogue requires a frozen Script"
    );
  }
  if (
    input.generationUnit.storyId !== input.script.storyId ||
    input.generationUnit.storyVersionId !== input.script.storyVersionId ||
    input.generationUnit.sourceAuthority.scriptVersionId !==
      input.script.scriptVersionId
  ) {
    fail(
      "NATIVE_DIALOGUE_AUTHORITY_INVALID",
      "Generation Unit does not bind the exact frozen Script"
    );
  }
  const scene = input.script.scenes.find(
    (candidate) => candidate.scriptSceneId === input.scriptSceneId
  );
  const entry = scene?.entries.find(
    (candidate) => candidate.entryId === input.dialogueEntryId
  );
  if (!scene || !entry || entry.type !== "DIALOGUE") {
    fail(
      "NATIVE_DIALOGUE_SCRIPT_MISMATCH",
      "Native dialogue entry is absent from the frozen Script Scene"
    );
  }
  const boundToScriptScene = input.generationUnit.sceneId === scene.scriptSceneId;
  const boundToCanonicalScene =
    input.boundCanonicalSceneId !== undefined &&
    input.generationUnit.sceneId === input.boundCanonicalSceneId;
  if (
    (!boundToScriptScene && !boundToCanonicalScene) ||
    !input.generationUnit.sourceAuthority.characterIds.includes(entry.speakerId) ||
    !input.generationUnit.inheritedContinuity.characterIds.includes(
      entry.speakerId
    )
  ) {
    fail(
      "NATIVE_DIALOGUE_CHARACTER_MISMATCH",
      "On-screen speaker is not bound to the Generation Unit"
    );
  }
  if (entry.language !== input.primaryLocale) {
    fail(
      "NATIVE_DIALOGUE_SCRIPT_MISMATCH",
      "Requested primary locale differs from frozen Script authority"
    );
  }
  const withoutIdentity = {
    contractVersion: AI_STORY_NATIVE_DIALOGUE_CONTRACT_VERSION,
    storyId: input.script.storyId,
    storyVersionId: input.script.storyVersionId,
    scriptVersionId: input.script.scriptVersionId,
    scriptFingerprint: input.script.sourceHash,
    scriptSceneId: scene.scriptSceneId,
    dialogueEntryId: entry.entryId,
    generationUnitId: input.generationUnit.generationUnitId,
    directorShotId: input.generationUnit.directorShotId,
    characterId: entry.speakerId,
    exactText: entry.line,
    primaryLocale: input.primaryLocale,
    secondaryLocales: [...input.secondaryLocales],
    codeSwitchPolicy: input.codeSwitchPolicy,
    deliveryStyle: input.deliveryStyle,
    performanceIntent: input.performanceIntent,
    emotionIntent: input.emotionIntent,
    speechIntensity: input.speechIntensity,
    paceIntent: input.paceIntent,
    onScreenSpeaker: true as const,
    nativeAvRequired: true as const,
    detachedTtsPermitted: false as const,
    mustPreserve: [
      "Exact frozen Script text and meaning",
      ...(input.mustPreserve ?? []),
    ],
    mustAvoid: [
      "Detached TTS",
      "Invented dialogue",
      "Invented dialect particles",
      ...(input.mustAvoid ?? []),
    ],
  };
  const dialogueFingerprint =
    computeAiStoryNativeDialogueFingerprint(withoutIdentity);
  return AiStoryCharacterDialoguePerformanceAuthoritySchema.parse({
    ...withoutIdentity,
    dialogueAuthorityId: deterministicUuidFromFingerprint(
      "ai-story-native-dialogue-authority",
      dialogueFingerprint
    ),
    dialogueFingerprint,
  });
}

export function assertAiStoryNativeDialogueMatchesFrozenScript(input: {
  readonly authority: AiStoryCharacterDialoguePerformanceAuthority;
  readonly script: AiStoryScriptVersion;
  readonly generationUnit: AiStoryGenerationUnit;
}): void {
  const authority =
    AiStoryCharacterDialoguePerformanceAuthoritySchema.parse(input.authority);
  const scene = input.script.scenes.find(
    (candidate) => candidate.scriptSceneId === authority.scriptSceneId
  );
  const entry = scene?.entries.find(
    (candidate) => candidate.entryId === authority.dialogueEntryId
  );
  if (
    input.script.status !== "FROZEN" ||
    input.script.scriptVersionId !== authority.scriptVersionId ||
    input.script.sourceHash !== authority.scriptFingerprint ||
    !entry ||
    entry.type !== "DIALOGUE" ||
    entry.line !== authority.exactText
  ) {
    fail(
      "NATIVE_DIALOGUE_SCRIPT_MISMATCH",
      "Native dialogue differs from frozen Script text or lineage"
    );
  }
  if (
    entry.speakerId !== authority.characterId ||
    input.generationUnit.generationUnitId !== authority.generationUnitId ||
    input.generationUnit.directorShotId !== authority.directorShotId ||
    !input.generationUnit.sourceAuthority.characterIds.includes(
      authority.characterId
    )
  ) {
    fail(
      "NATIVE_DIALOGUE_CHARACTER_MISMATCH",
      "Native dialogue speaker differs from frozen Character/Generation Unit binding"
    );
  }
  const { dialogueAuthorityId: _id, dialogueFingerprint, ...withoutIdentity } =
    authority;
  if (
    computeAiStoryNativeDialogueFingerprint(withoutIdentity) !==
    dialogueFingerprint
  ) {
    fail(
      "NATIVE_DIALOGUE_AUTHORITY_INVALID",
      "Native dialogue authority fingerprint mismatch"
    );
  }
}

export class CommercialVisibleDialogueProjectionError extends Error {
  constructor(
    readonly code: "NATIVE_DIALOGUE_REQUEST_UNSATISFIED",
    message: string,
  ) {
    super(message);
    this.name = "CommercialVisibleDialogueProjectionError";
  }
}

const LOCALE_DELIVERY_STYLE: Record<Locale, DeliveryStyle> = {
  "en-SG": "SINGAPORE_CONVERSATIONAL",
  "en-MY": "MALAYSIAN_CONVERSATIONAL",
  "ms-MY": "MALAYSIAN_MALAY_CONVERSATIONAL",
  "zh-SG": "MANDARIN_SG_CONVERSATIONAL",
  "zh-MY": "MANDARIN_MY_CONVERSATIONAL",
};

function isSpokenLocale(value: string): value is Locale {
  return (AI_STORY_AUDIO_LOCALES as readonly string[]).includes(value);
}

function deliveryStyleFor(dialogueStyle: string, locale: Locale): DeliveryStyle {
  if ((AI_STORY_DELIVERY_STYLES as readonly string[]).includes(dialogueStyle)) {
    return dialogueStyle as DeliveryStyle;
  }
  return LOCALE_DELIVERY_STYLE[locale];
}

function paceFor(
  pacing: AiStoryEpisodeIntentAuthority["pacing"],
): "SLOW" | "NATURAL" | "BRISK" {
  if (pacing === "RELAXED") return "SLOW";
  if (pacing === "FAST") return "BRISK";
  return "NATURAL";
}

function unsatisfied(message: string): never {
  throw new CommercialVisibleDialogueProjectionError(
    "NATIVE_DIALOGUE_REQUEST_UNSATISFIED",
    message,
  );
}

/**
 * Projects one frozen visible DIALOGUE line onto the existing native dialogue
 * compiler. Returns null only when this canonical Scene has no visible
 * DIALOGUE. Voice-over stays off this path.
 */
export function projectCommercialSceneVisibleDialogue(input: {
  readonly intent: AiStoryEpisodeIntentAuthority;
  readonly script: AiStoryScriptVersion;
  readonly directorPlan: AiStoryDirectorPlan;
  readonly motionPlan: AiStoryMotionPlan;
  readonly canonicalScene: AiStoryCanonicalScene;
}): AiStoryCharacterDialoguePerformanceAuthority | null {
  if (!input.intent.nativeCharacterDialogue) return null;
  if (input.script.status !== "FROZEN" || input.directorPlan.status !== "FROZEN" || input.motionPlan.status !== "FROZEN") {
    unsatisfied("Visible dialogue requires frozen Script, Director, and Motion authority");
  }
  if (input.script.scriptVersionId !== input.canonicalScene.scriptVersionId) {
    unsatisfied("Canonical Scene is not bound to the frozen Script");
  }
  const dialogueEntries = input.script.scenes.flatMap((scene) => {
    if (!input.canonicalScene.sourceScriptSceneIds.includes(scene.scriptSceneId)) return [];
    return scene.entries.flatMap((entry) =>
      entry.type === "DIALOGUE" ? [{ scene, entry }] : [],
    );
  });
  if (dialogueEntries.length === 0) return null;
  if (dialogueEntries.length > 1) {
    unsatisfied("A provider scene accepts exactly one visible dialogue line");
  }
  const { scene: scriptScene, entry } = dialogueEntries[0]!;
  if (!isSpokenLocale(entry.language) || entry.language !== input.intent.spokenLanguage) {
    unsatisfied("Frozen dialogue language must match the episode spoken locale");
  }
  const direction = input.directorPlan.sceneDirections.find((candidate) =>
    candidate.scriptSceneId === scriptScene.scriptSceneId &&
    candidate.canonicalSceneBinding?.sceneId === input.canonicalScene.sceneId,
  );
  const motion = input.motionPlan.sceneMotionPlans.find((candidate) =>
    candidate.directorSceneId === direction?.directorSceneId,
  );
  if (!direction?.canonicalSceneBinding || !motion) {
    unsatisfied("Visible dialogue has no frozen Director Shot and Motion binding");
  }
  const plan = compileAiStoryGenerationPlan({
    storyId: input.script.storyId,
    storyVersionId: input.script.storyVersionId,
    scriptVersionId: input.script.scriptVersionId,
    directorPlanId: input.directorPlan.directorPlanId,
    scene: {
      sceneId: input.canonicalScene.sceneId,
      sceneVersionId: input.canonicalScene.sceneVersionId,
      fingerprint: input.canonicalScene.fingerprint,
      locationBinding: { id: input.canonicalScene.locationBinding.id },
      castBindings: input.canonicalScene.castBindings.map((binding) => ({ id: binding.id })),
      productBindings: input.canonicalScene.productBindings.map((binding) => ({
        productAuthorityId: binding.productAuthorityId,
        sourceAssetId: binding.sourceAssetId,
        sourceAssetContentHash: binding.sourceAssetContentHash,
      })),
      sourceScriptEntryIds: input.canonicalScene.sourceScriptEntryIds,
      discontinuity: input.canonicalScene.discontinuity
        ? { kind: input.canonicalScene.discontinuity.kind }
        : null,
    },
    directorDirection: direction,
    motionScenePlan: motion,
  });
  const candidates = plan.units.filter((unit) =>
    unit.sourceAuthority.characterIds.includes(entry.speakerId) &&
    unit.inheritedContinuity.characterIds.includes(entry.speakerId),
  );
  const unit = candidates.find((candidate) => candidate.executionRequirement.characterPerformance) ?? candidates[0];
  if (!unit) {
    unsatisfied("Visible dialogue speaker is not bound to a Generation Unit for this Scene");
  }
  try {
    return compileAiStoryCharacterDialoguePerformanceAuthority({
      script: input.script,
      generationUnit: unit,
      scriptSceneId: scriptScene.scriptSceneId,
      dialogueEntryId: entry.entryId,
      boundCanonicalSceneId: input.canonicalScene.sceneId,
      primaryLocale: input.intent.spokenLanguage,
      secondaryLocales: [],
      codeSwitchPolicy: { mode: "DISABLED", allowedLocales: [] },
      deliveryStyle: deliveryStyleFor(input.intent.dialogueStyle, input.intent.spokenLanguage),
      performanceIntent: `Visible character dialogue. Delivery style authority: ${input.intent.dialogueStyle}. CHARACTER_DIALOGUE = PERFORMANCE, not READING.`,
      emotionIntent: entry.deliveryOrSubtext?.trim() || "Natural on-screen reaction",
      speechIntensity: "NATURAL",
      paceIntent: paceFor(input.intent.pacing),
      mustPreserve: [entry.line],
    });
  } catch (error) {
    if (error instanceof AiStoryNativeDialogueAuthorityError) {
      unsatisfied(error.message);
    }
    throw error;
  }
}
