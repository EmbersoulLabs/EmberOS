import { z } from "zod";
import { AI_STORY_AUDIO_LOCALES } from "./ai-story-audio-plan";
import {
  AI_STORY_EPISODE_ASPECT_RATIOS,
  AI_STORY_EPISODE_PACING,
  AI_STORY_EPISODE_USER_TYPES,
} from "./ai-story-episode-first-ui";

export const AI_STORY_EPISODE_INTENT_CONTRACT_VERSION =
  "ai-story-episode-intent.v1" as const;
export const AI_STORY_VISUAL_TEXT_AUTHORITY_CONTRACT_VERSION =
  "ai-story-visual-text-authority.v1" as const;

/** Creative prose is context. It is not authority for dialogue, text, or identity. */
export const ORIGINAL_IDEA_USED_AS_AUTHORITY = false as const;

export const AI_STORY_VISUAL_TEXT_LANGUAGES = ["en", "ms", "zh-Hans"] as const;
export type AiStoryVisualTextLanguage =
  (typeof AI_STORY_VISUAL_TEXT_LANGUAGES)[number];

export const AI_STORY_DEFAULT_VISUAL_TEXT_LANGUAGES = [
  "en",
  "ms",
  "zh-Hans",
] as const satisfies readonly AiStoryVisualTextLanguage[];

export const AI_STORY_VISUAL_TEXT_RENDER_POLICIES = [
  "PRESERVE_SOURCE",
  "DETERMINISTIC_OVERLAY",
  "PROVIDER_NON_LEGIBLE",
  "PROVIDER_CONSTRAINED",
] as const;
export type AiStoryVisualTextRenderPolicy =
  (typeof AI_STORY_VISUAL_TEXT_RENDER_POLICIES)[number];

export const AI_STORY_VISUAL_TEXT_SURFACE_KINDS = [
  "MENU",
  "SIGNAGE",
  "STORE_NAME",
  "PRICE",
  "CTA",
  "PRODUCT_LABEL",
  "DECORATIVE",
] as const;

export const AI_STORY_VISUAL_TEXT_ORIGINS = [
  "SOURCE_PRESERVED",
  "PROVIDER_GENERATED",
  "EMBEROS_OVERLAY",
] as const;

/** Assembly does not track a moving menu. Non-legible policy does not require tracking. */
export const MOVING_SURFACE_TEXT_TRACKING_CAPABILITY = "UNAVAILABLE" as const;

export const AI_STORY_VISUAL_TEXT_ALLOWED_SCRIPTS = [
  "LATIN",
  "HAN",
  "COMMON",
  "INHERITED",
] as const;

const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Id = z.string().uuid();

export const AiStoryEpisodeIntentInputSchema = z
  .object({
    episodeType: z.enum(AI_STORY_EPISODE_USER_TYPES),
    requestedDurationSec: z.number().int().min(4).max(180),
    aspectRatio: z.enum(AI_STORY_EPISODE_ASPECT_RATIOS),
    spokenLanguage: z.enum(AI_STORY_AUDIO_LOCALES),
    dialogueStyle: z.string().trim().min(1).max(200),
    nativeCharacterDialogue: z.boolean(),
    pacing: z.enum(AI_STORY_EPISODE_PACING),
    cta: z.string().trim().min(1).max(500).nullable(),
    visualTextLanguages: z
      .array(z.enum(AI_STORY_VISUAL_TEXT_LANGUAGES))
      .min(1)
      .default([...AI_STORY_DEFAULT_VISUAL_TEXT_LANGUAGES]),
    visualTextPolicy: z
      .object({
        criticalSurfacePolicy: z.enum(AI_STORY_VISUAL_TEXT_RENDER_POLICIES),
      })
      .strict()
      .default({ criticalSurfacePolicy: "PROVIDER_NON_LEGIBLE" }),
  })
  .strict();

export const AiStoryEpisodeIntentAuthoritySchema = AiStoryEpisodeIntentInputSchema.extend({
  contractVersion: z.literal(AI_STORY_EPISODE_INTENT_CONTRACT_VERSION),
  acceptedAt: z.string().datetime(),
}).strict();

export type AiStoryEpisodeIntentInput = z.infer<typeof AiStoryEpisodeIntentInputSchema>;
export type AiStoryEpisodeIntentAuthority = z.infer<
  typeof AiStoryEpisodeIntentAuthoritySchema
>;

export function acceptAiStoryEpisodeIntent(
  input: AiStoryEpisodeIntentInput,
  acceptedAt: string,
): AiStoryEpisodeIntentAuthority {
  return AiStoryEpisodeIntentAuthoritySchema.parse({
    ...AiStoryEpisodeIntentInputSchema.parse(input),
    contractVersion: AI_STORY_EPISODE_INTENT_CONTRACT_VERSION,
    acceptedAt,
  });
}

export const AiStoryVisualTextAuthoritySchema = z
  .object({
    contractVersion: z.literal(AI_STORY_VISUAL_TEXT_AUTHORITY_CONTRACT_VERSION),
    storyId: Id,
    storyVersionId: Id,
    sceneId: Id.nullable(),
    surfaceKind: z.enum(AI_STORY_VISUAL_TEXT_SURFACE_KINDS),
    renderPolicy: z.enum(AI_STORY_VISUAL_TEXT_RENDER_POLICIES),
    language: z.enum(AI_STORY_VISUAL_TEXT_LANGUAGES).nullable(),
    exactText: z.string().trim().min(1).max(500).optional(),
    critical: z.boolean(),
    origin: z.enum(AI_STORY_VISUAL_TEXT_ORIGINS),
    authorityFingerprint: Hash,
  })
  .strict();
export type AiStoryVisualTextAuthority = z.infer<
  typeof AiStoryVisualTextAuthoritySchema
>;

const SCRIPT_PATTERNS = [
  ["LATIN", /\p{Script=Latin}/u],
  ["HAN", /\p{Script=Han}/u],
  ["COMMON", /\p{Script=Common}/u],
  ["INHERITED", /\p{Script=Inherited}/u],
] as const;

export type VisualTextScriptClassification = {
  readonly allowed: boolean;
  readonly scripts: readonly string[];
  readonly unauthorizedScripts: readonly string[];
};

/** Positive allow-list: Latin, Han, Common, and Inherited. Every other script is unauthorized. */
export function classifyVisualTextScripts(text: string): VisualTextScriptClassification {
  const scripts = new Set<string>();
  const unauthorized = new Set<string>();
  for (const char of text) {
    const match = SCRIPT_PATTERNS.find(([, pattern]) => pattern.test(char));
    if (match) {
      scripts.add(match[0]);
      continue;
    }
    unauthorized.add(unicodeScriptLabel(char));
  }
  return {
    allowed: unauthorized.size === 0,
    scripts: [...scripts].sort(),
    unauthorizedScripts: [...unauthorized].sort(),
  };
}

function unicodeScriptLabel(char: string): string {
  const probes = [
    "Thai",
    "Devanagari",
    "Tamil",
    "Arabic",
    "Khmer",
    "Bengali",
    "Cyrillic",
    "Hangul",
    "Hiragana",
    "Katakana",
    "Hebrew",
    "Greek",
    "Myanmar",
    "Lao",
  ] as const;
  for (const name of probes) {
    if (new RegExp(`\\p{Script=${name}}`, "u").test(char)) return name.toUpperCase();
  }
  return "OTHER";
}

export function productI2vCharacterReferenceComposition(input: {
  readonly generationMode: "TEXT_TO_VIDEO" | "FIRST_FRAME_IMAGE_TO_VIDEO";
  readonly characterConsistencyMode:
    | "SOFT_DESCRIPTION_BASED"
    | "DNA_PLUS_SYNTHETIC_ANCHOR"
    | null;
}): "ALLOW_DESCRIPTION" | "ALLOW_REFERENCE_FREE" | "PRODUCT_I2V_CHARACTER_REFERENCE_COMPOSITION_BLOCKER" {
  if (
    input.generationMode === "FIRST_FRAME_IMAGE_TO_VIDEO" &&
    input.characterConsistencyMode === "DNA_PLUS_SYNTHETIC_ANCHOR"
  ) {
    return "PRODUCT_I2V_CHARACTER_REFERENCE_COMPOSITION_BLOCKER";
  }
  if (input.characterConsistencyMode === "SOFT_DESCRIPTION_BASED") return "ALLOW_DESCRIPTION";
  return "ALLOW_REFERENCE_FREE";
}

export function resolveMovingSurfaceTextTracking(
  policy: AiStoryVisualTextRenderPolicy,
): "NOT_REQUIRED" | "BLOCKER" {
  if (policy === "DETERMINISTIC_OVERLAY") return "BLOCKER";
  return "NOT_REQUIRED";
}

export function buildVisualTextProviderConstraint(
  intent: Pick<AiStoryEpisodeIntentAuthority, "visualTextLanguages" | "visualTextPolicy">,
): string {
  return [
    "Visual text restriction:",
    `Authorized visual text languages: ${intent.visualTextLanguages.join(", ")}.`,
    "Readable provider-generated writing may use only Latin and Han scripts, plus digits, currency marks, and punctuation.",
    "Do not invent readable text in any other script.",
    intent.visualTextPolicy.criticalSurfacePolicy === "PROVIDER_NON_LEGIBLE"
      ? "Menu, price, and signage surfaces must stay soft, small, or otherwise non-legible. Do not invent a readable menu, price, or product claim."
      : "Render only exact authorized text. Do not invent prices or product claims.",
  ].join(" ");
}

export type CharacterContinuityScene = {
  readonly sceneId: string;
  readonly characterIds: readonly string[];
  readonly backgroundOnly?: boolean;
  readonly characterDnaFingerprint: string | null;
  readonly reusableCharacterId: string | null;
  readonly reusableCharacterVersionId: string | null;
  readonly campaignCharacterId: string | null;
  readonly campaignCharacterVersionId: string | null;
  readonly identityFingerprint: string | null;
};

export function recurringCharacterIds(
  scenes: readonly CharacterContinuityScene[],
): string[] {
  const counts = new Map<string, number>();
  for (const scene of scenes) {
    if (scene.backgroundOnly) continue;
    for (const characterId of new Set(scene.characterIds)) {
      counts.set(characterId, (counts.get(characterId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([characterId]) => characterId)
    .sort();
}

export function evaluateCharacterContinuity(input: {
  readonly scenes: readonly CharacterContinuityScene[];
  readonly nativeDialogueRequiresVisibleSpeaker?: boolean;
  readonly speakingCharacterIds?: readonly string[];
}): {
  readonly status: "PASS" | "BLOCK";
  readonly reasonCode: "PASS" | "CHARACTER_CONTINUITY_AUTHORITY_REQUIRED";
  readonly requiredCharacterIds: readonly string[];
} {
  const recurring = recurringCharacterIds(input.scenes);
  const speaking = input.nativeDialogueRequiresVisibleSpeaker
    ? [...new Set(input.speakingCharacterIds ?? [])]
    : [];
  const required = [...new Set([...recurring, ...speaking])].sort();
  const blocked = input.scenes.some((scene) => {
    const needed = scene.characterIds.some((id) => required.includes(id));
    if (!needed || scene.backgroundOnly) return false;
    return scene.characterDnaFingerprint === null;
  });
  const fingerprints = new Map<string, string>();
  for (const scene of input.scenes) {
    for (const characterId of scene.characterIds) {
      if (!required.includes(characterId) || !scene.characterDnaFingerprint) continue;
      const previous = fingerprints.get(characterId);
      if (previous && previous !== scene.characterDnaFingerprint) return {
        status: "BLOCK",
        reasonCode: "CHARACTER_CONTINUITY_AUTHORITY_REQUIRED",
        requiredCharacterIds: required,
      };
      fingerprints.set(characterId, scene.characterDnaFingerprint);
    }
  }
  if (blocked) {
    return {
      status: "BLOCK",
      reasonCode: "CHARACTER_CONTINUITY_AUTHORITY_REQUIRED",
      requiredCharacterIds: required,
    };
  }
  return { status: "PASS", reasonCode: "PASS", requiredCharacterIds: required };
}

export type FrozenDialogueEntry = {
  readonly type: "DIALOGUE" | "VO" | "ACTION";
  readonly speakerId?: string;
  readonly line?: string;
  readonly language?: string;
};

export function evaluateNativeDialogueIntent(input: {
  readonly requested: boolean;
  readonly entries: readonly FrozenDialogueEntry[];
  readonly speakerBound?: boolean;
  readonly nativeAvUnitValid?: boolean;
  readonly dialogueAuthorityValid?: boolean;
  readonly audioModeValid?: boolean;
}): {
  readonly status: "PASS" | "BLOCK";
  readonly reasonCode: "PASS" | "NATIVE_DIALOGUE_REQUEST_UNSATISFIED";
  readonly dialogueCount: number;
} {
  const dialogue = input.entries.filter((entry) => entry.type === "DIALOGUE");
  if (!input.requested) {
    return { status: "PASS", reasonCode: "PASS", dialogueCount: dialogue.length };
  }
  const satisfied =
    dialogue.length > 0 &&
    dialogue.every((entry) => Boolean(entry.speakerId && entry.line && entry.language)) &&
    input.speakerBound !== false &&
    input.nativeAvUnitValid !== false &&
    input.dialogueAuthorityValid !== false &&
    input.audioModeValid !== false;
  return satisfied
    ? { status: "PASS", reasonCode: "PASS", dialogueCount: dialogue.length }
    : {
        status: "BLOCK",
        reasonCode: "NATIVE_DIALOGUE_REQUEST_UNSATISFIED",
        dialogueCount: dialogue.length,
      };
}

export function evaluateVisualTextPolicy(input: {
  readonly surfaceRequired: boolean;
  readonly authorityPresent: boolean;
  readonly criticalReadableWithoutAuthority: boolean;
}): {
  readonly status: "PASS" | "BLOCK";
  readonly reasonCode: "PASS" | "VISUAL_TEXT_AUTHORITY_REQUIRED";
} {
  if (!input.surfaceRequired) return { status: "PASS", reasonCode: "PASS" };
  if (!input.authorityPresent || input.criticalReadableWithoutAuthority) {
    return { status: "BLOCK", reasonCode: "VISUAL_TEXT_AUTHORITY_REQUIRED" };
  }
  return { status: "PASS", reasonCode: "PASS" };
}

export type VisualTextObservation = {
  readonly readable: boolean;
  readonly text: string;
  readonly criticalSurface: boolean;
  readonly renderPolicy: AiStoryVisualTextRenderPolicy;
  readonly origin: (typeof AI_STORY_VISUAL_TEXT_ORIGINS)[number];
};

export function evaluateVisualTextLanguageGate(observation: VisualTextObservation): {
  readonly status: "PASS" | "WARN" | "BLOCK";
  readonly reasonCode:
    | "PASS"
    | "VISUAL_TEXT_UNREADABLE"
    | "UNAUTHORIZED_VISUAL_TEXT_SCRIPT"
    | "VISUAL_TEXT_AUTHORITY_REQUIRED";
} {
  if (!observation.readable) {
    if (observation.renderPolicy === "PROVIDER_NON_LEGIBLE" && !observation.criticalSurface) {
      return { status: "PASS", reasonCode: "PASS" };
    }
    if (observation.renderPolicy === "PROVIDER_NON_LEGIBLE") {
      return { status: "PASS", reasonCode: "PASS" };
    }
    return { status: "WARN", reasonCode: "VISUAL_TEXT_UNREADABLE" };
  }
  const classification = classifyVisualTextScripts(observation.text);
  if (!classification.allowed) {
    return { status: "BLOCK", reasonCode: "UNAUTHORIZED_VISUAL_TEXT_SCRIPT" };
  }
  if (
    observation.criticalSurface &&
    observation.origin === "PROVIDER_GENERATED" &&
    observation.renderPolicy !== "PROVIDER_CONSTRAINED"
  ) {
    return { status: "BLOCK", reasonCode: "VISUAL_TEXT_AUTHORITY_REQUIRED" };
  }
  return { status: "PASS", reasonCode: "PASS" };
}

export type CommercialEpisodeRepairEvidence = {
  readonly characterContinuityRequired: boolean;
  readonly characterDnaAuthorityPresent: boolean;
  readonly characterIdentityMismatch: boolean;
  readonly nativeCharacterDialogue: boolean;
  readonly frozenDialogueCount: number;
  readonly nativeDialogueSpeakerValid: boolean;
  readonly nativeAvUnitValid: boolean;
  readonly dialogueAuthorityValid: boolean;
  readonly sceneAudioModeValid: boolean;
  readonly visualTextSurfaceRequired: boolean;
  readonly visualTextAuthorityPresent: boolean;
  readonly criticalReadableTextWithoutAuthority: boolean;
};

export function commercialEpisodeRepairGateEvidence(
  evidence: CommercialEpisodeRepairEvidence | null | undefined,
): {
  readonly character: readonly { code: string; evidence: string }[];
  readonly nativeDialogue: readonly { code: string; evidence: string }[];
  readonly visualText: readonly { code: string; evidence: string }[];
} {
  if (!evidence) return { character: [], nativeDialogue: [], visualText: [] };
  return {
    character:
      evidence.characterContinuityRequired &&
      (!evidence.characterDnaAuthorityPresent || evidence.characterIdentityMismatch)
        ? [{
            code: "CHARACTER_CONTINUITY_AUTHORITY_REQUIRED",
            evidence: "Recurring character continuity requires one exact Character DNA authority",
          }]
        : [],
    nativeDialogue: evaluateNativeDialogueIntent({
      requested: evidence.nativeCharacterDialogue,
      entries: Array.from({ length: evidence.frozenDialogueCount }, () => ({
        type: "DIALOGUE" as const,
        speakerId: evidence.nativeDialogueSpeakerValid ? "speaker" : undefined,
        line: "line",
        language: "en-MY",
      })),
      speakerBound: evidence.nativeDialogueSpeakerValid,
      nativeAvUnitValid: evidence.nativeAvUnitValid,
      dialogueAuthorityValid: evidence.dialogueAuthorityValid,
      audioModeValid: evidence.sceneAudioModeValid,
    }).status === "BLOCK"
      ? [{
          code: "NATIVE_DIALOGUE_REQUEST_UNSATISFIED",
          evidence: "Native character dialogue requires frozen visible dialogue authority",
        }]
      : [],
    visualText: evaluateVisualTextPolicy({
      surfaceRequired: evidence.visualTextSurfaceRequired,
      authorityPresent: evidence.visualTextAuthorityPresent,
      criticalReadableWithoutAuthority: evidence.criticalReadableTextWithoutAuthority,
    }).status === "BLOCK"
      ? [{
          code: "VISUAL_TEXT_AUTHORITY_REQUIRED",
          evidence: "Critical visual text requires explicit authority",
        }]
      : [],
  };
}

/** Test-only menu copy. Real episodes use Business or Product menu authority. */
export const TAPAO_JOM_VISUAL_TEXT_FIXTURE = {
  en: ["Nasi Lemak", "Office Meal", "Drinks"],
  ms: ["Nasi Lemak", "Hidangan Pejabat", "Minuman"],
  "zh-Hans": ["椰浆饭", "公司餐", "饮料"],
} as const;

export type GenerateReviewDiagnosticScene = {
  readonly order: number;
  readonly generationMode: "TEXT_TO_VIDEO" | "FIRST_FRAME_IMAGE_TO_VIDEO";
  readonly characterPresent: boolean;
  readonly characterId: string | null;
  readonly characterDnaFingerprint: string | null;
  readonly productAuthorityPresent: boolean;
  readonly productFirstFramePresent: boolean;
  readonly audioMode: "VIDEO_ONLY" | "NATIVE_AUDIO_VIDEO";
  readonly dialogueEntryIds: readonly string[];
  readonly generateAudio: boolean;
  readonly visualTextSurfaces: readonly string[];
  readonly visualTextLanguages: readonly string[];
  readonly visualTextPolicy: string | null;
  readonly visualTextCritical: boolean;
};

export function buildCommercialEpisodeGenerateReviewDiagnostics(input: {
  readonly episodeIntent: AiStoryEpisodeIntentAuthority | null;
  readonly characters: readonly {
    readonly characterId: string;
    readonly versionId: string;
    readonly dnaFingerprint: string | null;
    readonly consistencyMode: "SOFT_DESCRIPTION_BASED" | "DNA_PLUS_SYNTHETIC_ANCHOR" | null;
  }[];
  readonly scenes: readonly GenerateReviewDiagnosticScene[];
  readonly includeInternalIds: boolean;
}) {
  const intent = input.episodeIntent;
  const recurring = input.characters.filter((character) => character.dnaFingerprint);
  return {
    episodeIntentPresent: Boolean(intent),
    nativeCharacterDialogue: intent?.nativeCharacterDialogue ?? false,
    visualTextLanguages: intent?.visualTextLanguages ?? [],
    recurringCharacterCount: recurring.length,
    characters: input.characters.map((character) => ({
      consistencyMode: character.consistencyMode,
      ...(input.includeInternalIds
        ? {
            characterId: character.characterId,
            versionId: character.versionId,
            dnaFingerprint: character.dnaFingerprint,
          }
        : {}),
    })),
    scenes: input.scenes.map((scene) => ({
      order: scene.order,
      generationMode: scene.generationMode,
      characterPresent: scene.characterPresent,
      productAuthorityPresent: scene.productAuthorityPresent,
      productFirstFramePresent: scene.productFirstFramePresent,
      audioMode: scene.audioMode,
      generateAudio: scene.generateAudio,
      dialogueCount: scene.dialogueEntryIds.length,
      visualTextSurfaces: scene.visualTextSurfaces,
      visualTextLanguages: scene.visualTextLanguages,
      visualTextPolicy: scene.visualTextPolicy,
      visualTextCritical: scene.visualTextCritical,
      ...(input.includeInternalIds
        ? {
            characterId: scene.characterId,
            characterDnaFingerprint: scene.characterDnaFingerprint,
            dialogueEntryIds: scene.dialogueEntryIds,
          }
        : {}),
    })),
    movingSurfaceTextTracking: intent
      ? resolveMovingSurfaceTextTracking(intent.visualTextPolicy.criticalSurfacePolicy)
      : "NOT_REQUIRED" as const,
    originalIdeaUsedAsAuthority: ORIGINAL_IDEA_USED_AS_AUTHORITY,
  };
}
