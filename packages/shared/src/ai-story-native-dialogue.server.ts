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
import type { AiStoryScriptVersion } from "./ai-story-script";
import type {
  AiStoryCodeSwitchPolicySchema,
  AI_STORY_AUDIO_LOCALES,
  AI_STORY_DELIVERY_STYLES,
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
      | "NATIVE_DIALOGUE_CHARACTER_MISMATCH",
    message: string
  ) {
    super(message);
    this.name = "AiStoryNativeDialogueAuthorityError";
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
  if (
    input.generationUnit.sceneId !== scene.scriptSceneId ||
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
