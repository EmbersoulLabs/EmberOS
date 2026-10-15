/**
 * Provider-neutral Character Voice DNA.
 *
 * Voice DNA owns who a reusable Character sounds like. Dialogue Performance
 * owns how one line is performed. Audio Plan owns placement and mix.
 * Descriptive mode pins semantic voice continuity and does not claim an
 * identical waveform. Capability and reference bindings do not put provider
 * or model ids in this contract.
 */
import { z } from "zod";
import {
  AI_STORY_AUDIO_LOCALES,
  AI_STORY_DELIVERY_STYLES,
  AiStoryCodeSwitchPolicySchema,
} from "./ai-story-audio-plan";

export const AI_STORY_CHARACTER_VOICE_DNA_VERSION =
  "ai-story-character-voice-dna.v1" as const;

export const AI_STORY_VOICE_DNA_CONSISTENCY_MODES = [
  "DESCRIPTIVE_VOICE_DNA",
  "CAPABILITY_VOICE_BINDING",
  "REFERENCE_AUDIO_IDENTITY",
] as const;

export const AI_STORY_VOICE_DNA_STATUSES = ["APPROVED", "FROZEN"] as const;
export const AI_STORY_VOICE_PRESENTATIONS = ["FEMININE", "MASCULINE", "NEUTRAL"] as const;
export const AI_STORY_VOICE_AGE_PRESENTATIONS = ["YOUNG_ADULT", "ADULT", "MATURE"] as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1).max(500);

export class AiStoryCharacterVoiceDnaError extends Error {
  readonly code:
    | "VOICE_DNA_CHARACTER_VERSION_MISMATCH"
    | "VOICE_DNA_CAPABILITY_MISMATCH"
    | "VOICE_DNA_PRESENTATION_MISMATCH"
    | "VOICE_DNA_LOCALE_MISMATCH"
    | "VOICE_DNA_CODE_SWITCH_MISMATCH"
    | "VOICE_DNA_REFERENCE_AUDIO_REJECTED"
    | "VOICE_DNA_SPEAKER_MISMATCH"
    | "VOICE_DNA_REQUIRED"
    | "VOICE_DNA_BINDING_MISMATCH"
    | "VOICE_DNA_INVALID";

  constructor(code: AiStoryCharacterVoiceDnaError["code"], message: string) {
    super(message);
    this.name = "AiStoryCharacterVoiceDnaError";
    this.code = code;
  }
}

export const AiStoryVoicePresentationSchema = z.object({
  genderPresentation: z.enum(AI_STORY_VOICE_PRESENTATIONS),
  ageRangePresentation: z.enum(AI_STORY_VOICE_AGE_PRESENTATIONS),
}).strict();

export const AiStoryVoiceAcousticProfileSchema = z.object({
  register: z.enum(["LOW", "MID", "HIGH"]),
  pitchIntent: z.enum(["LOW", "MEDIUM", "HIGH"]),
  resonance: z.enum(["WARM", "NEUTRAL", "BRIGHT"]),
  brightness: z.enum(["DARK", "NATURAL", "BRIGHT"]),
  breathiness: z.enum(["LOW", "NATURAL", "AIRY"]),
  texture: Text,
}).strict();

export const AiStoryVoiceSpeechProfileSchema = z.object({
  cadence: Text,
  defaultPace: z.enum(["SLOW", "MEASURED", "NATURAL", "BRISK"]),
  pauseStyle: z.enum(["MINIMAL", "NATURAL", "DELIBERATE"]),
  emphasisStyle: z.enum(["EVEN", "EXPRESSIVE", "PUNCHY"]),
  articulation: z.enum(["RELAXED", "CLEAR", "PRECISE"]),
  energy: z.enum(["SOFT", "NATURAL", "HIGH"]),
}).strict();

export const AiStoryVoiceAccentProfileSchema = z.object({
  locale: z.enum(AI_STORY_AUDIO_LOCALES),
  regionalIntent: Text,
  prohibitedStylizations: z.array(Text),
}).strict();

export const AiStoryCharacterVoiceDnaSchema = z.object({
  voiceDnaId: Id,
  contractVersion: z.literal(AI_STORY_CHARACTER_VOICE_DNA_VERSION),
  status: z.enum(AI_STORY_VOICE_DNA_STATUSES),
  orgId: Id,
  workspaceId: Id,
  reusableCharacterId: Id,
  reusableCharacterVersionId: Id,
  characterIdentityFingerprint: Hash,
  primaryLocale: z.enum(AI_STORY_AUDIO_LOCALES),
  allowedSecondaryLocales: z.array(z.enum(AI_STORY_AUDIO_LOCALES)),
  codeSwitchPolicy: AiStoryCodeSwitchPolicySchema,
  voicePresentation: AiStoryVoicePresentationSchema,
  acousticProfile: AiStoryVoiceAcousticProfileSchema,
  speechProfile: AiStoryVoiceSpeechProfileSchema,
  accentProfile: AiStoryVoiceAccentProfileSchema,
  defaultDeliveryStyle: z.enum(AI_STORY_DELIVERY_STYLES),
  mustPreserve: z.array(Text),
  mustAvoid: z.array(Text),
  consistencyMode: z.enum(AI_STORY_VOICE_DNA_CONSISTENCY_MODES),
  semanticVoiceContinuity: z.literal("PINNED"),
  exactAcousticVoiceContinuity: z.literal("NOT_CLAIMED"),
  voiceCapabilityId: Id.optional(),
  referenceAudioAssetId: Id.optional(),
  referenceAudioContentHash: Hash.optional(),
  voiceDnaFingerprint: Hash,
}).strict().superRefine((value, ctx) => {
  if (value.accentProfile.locale !== value.primaryLocale) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Accent locale must match the Voice DNA primary locale",
    });
  }
  if (value.consistencyMode === "DESCRIPTIVE_VOICE_DNA") {
    if (value.voiceCapabilityId || value.referenceAudioAssetId || value.referenceAudioContentHash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Descriptive Voice DNA cannot bind a capability or reference audio asset",
      });
    }
  }
  if (value.consistencyMode === "CAPABILITY_VOICE_BINDING" && !value.voiceCapabilityId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Capability-bound Voice DNA requires voiceCapabilityId",
    });
  }
  if (
    value.consistencyMode === "CAPABILITY_VOICE_BINDING" &&
    (value.referenceAudioAssetId || value.referenceAudioContentHash)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Capability-bound Voice DNA cannot bind reference audio",
    });
  }
  if (value.consistencyMode === "REFERENCE_AUDIO_IDENTITY") {
    if (!value.referenceAudioAssetId || !value.referenceAudioContentHash || value.voiceCapabilityId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reference-audio Voice DNA requires an approved asset id and content hash",
      });
    }
  }
  if (value.codeSwitchPolicy.mode === "DISABLED" && value.allowedSecondaryLocales.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Disabled code-switch Voice DNA cannot allow secondary locales",
    });
  }
  if (
    value.codeSwitchPolicy.mode !== "DISABLED" &&
    value.codeSwitchPolicy.allowedLocales.some(
      (locale) => locale !== value.primaryLocale && !value.allowedSecondaryLocales.includes(locale)
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Code-switch locales must be the primary locale or an allowed secondary locale",
    });
  }
});

export type AiStoryCharacterVoiceDna = z.infer<typeof AiStoryCharacterVoiceDnaSchema>;

export type VoiceDnaBuildInput = {
  status: AiStoryCharacterVoiceDna["status"];
  orgId: string;
  workspaceId: string;
  reusableCharacterId: string;
  reusableCharacterVersionId: string;
  characterIdentityFingerprint: string;
  primaryLocale: AiStoryCharacterVoiceDna["primaryLocale"];
  allowedSecondaryLocales: AiStoryCharacterVoiceDna["allowedSecondaryLocales"];
  codeSwitchPolicy: AiStoryCharacterVoiceDna["codeSwitchPolicy"];
  voicePresentation: AiStoryCharacterVoiceDna["voicePresentation"];
  acousticProfile: AiStoryCharacterVoiceDna["acousticProfile"];
  speechProfile: AiStoryCharacterVoiceDna["speechProfile"];
  accentProfile: AiStoryCharacterVoiceDna["accentProfile"];
  defaultDeliveryStyle: AiStoryCharacterVoiceDna["defaultDeliveryStyle"];
  mustPreserve: string[];
  mustAvoid: string[];
  consistencyMode: AiStoryCharacterVoiceDna["consistencyMode"];
  voiceCapabilityId?: string;
  referenceAudioAssetId?: string;
  referenceAudioContentHash?: string;
};

export type VoiceDnaSemanticBody = Omit<
  AiStoryCharacterVoiceDna,
  "voiceDnaId" | "voiceDnaFingerprint"
>;

const PRESENTATION_LABEL = {
  FEMININE: "feminine presentation",
  MASCULINE: "masculine presentation",
  NEUTRAL: "neutral presentation",
  YOUNG_ADULT: "young adult",
  ADULT: "adult",
  MATURE: "mature",
} as const;

export function voiceDnaSemanticBody(input: VoiceDnaBuildInput): VoiceDnaSemanticBody {
  return {
    contractVersion: AI_STORY_CHARACTER_VOICE_DNA_VERSION,
    status: input.status,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    reusableCharacterId: input.reusableCharacterId,
    reusableCharacterVersionId: input.reusableCharacterVersionId,
    characterIdentityFingerprint: input.characterIdentityFingerprint,
    primaryLocale: input.primaryLocale,
    allowedSecondaryLocales: [...input.allowedSecondaryLocales],
    codeSwitchPolicy: input.codeSwitchPolicy,
    voicePresentation: input.voicePresentation,
    acousticProfile: input.acousticProfile,
    speechProfile: input.speechProfile,
    accentProfile: {
      ...input.accentProfile,
      prohibitedStylizations: [...input.accentProfile.prohibitedStylizations],
    },
    defaultDeliveryStyle: input.defaultDeliveryStyle,
    mustPreserve: [...input.mustPreserve],
    mustAvoid: [...input.mustAvoid],
    consistencyMode: input.consistencyMode,
    semanticVoiceContinuity: "PINNED",
    exactAcousticVoiceContinuity: "NOT_CLAIMED",
    ...(input.consistencyMode === "CAPABILITY_VOICE_BINDING" && input.voiceCapabilityId
      ? { voiceCapabilityId: input.voiceCapabilityId }
      : {}),
    ...(input.consistencyMode === "REFERENCE_AUDIO_IDENTITY" &&
    input.referenceAudioAssetId &&
    input.referenceAudioContentHash
      ? {
          referenceAudioAssetId: input.referenceAudioAssetId,
          referenceAudioContentHash: input.referenceAudioContentHash,
        }
      : {}),
  };
}

export function projectVoiceDnaNativePerformanceInstruction(
  dna: Pick<
    AiStoryCharacterVoiceDna,
    | "voicePresentation"
    | "acousticProfile"
    | "speechProfile"
    | "accentProfile"
    | "primaryLocale"
    | "defaultDeliveryStyle"
    | "mustAvoid"
    | "consistencyMode"
  >
): string {
  const identity = [
    "Character voice identity:",
    PRESENTATION_LABEL[dna.voicePresentation.ageRangePresentation],
    PRESENTATION_LABEL[dna.voicePresentation.genderPresentation],
    `${dna.acousticProfile.resonance.toLowerCase()} ${dna.acousticProfile.register.toLowerCase()} register`,
    `${dna.acousticProfile.brightness.toLowerCase()} resonance`,
    `${dna.acousticProfile.breathiness.toLowerCase()} breathiness`,
    dna.acousticProfile.texture,
    `${dna.primaryLocale} cadence`,
    dna.speechProfile.cadence,
    `${dna.speechProfile.defaultPace.toLowerCase()} pacing`,
    `${dna.defaultDeliveryStyle} delivery`,
    ...dna.mustAvoid.map((item) => `no ${item}`),
  ].join(", ");
  if (dna.consistencyMode === "DESCRIPTIVE_VOICE_DNA") {
    return `${identity}. Semantic voice continuity is pinned. Exact acoustic continuity is not guaranteed.`;
  }
  if (dna.consistencyMode === "CAPABILITY_VOICE_BINDING") {
    return `${identity}. Stable voice capability pinned. Exact acoustic waveform continuity is not claimed.`;
  }
  return `${identity}. Reference audio authority pinned. Execution support pending capability.`;
}

export function describeVoiceIdentity(dna: AiStoryCharacterVoiceDna | null): {
  voiceIdentity: string;
  primaryLanguage: string;
  deliveryIdentity: string;
  voicePresentation: string;
  consistencyMode: string;
  status: string;
  continuityStatement: string;
} {
  if (!dna) {
    return {
      voiceIdentity: "Not pinned",
      primaryLanguage: "—",
      deliveryIdentity: "—",
      voicePresentation: "—",
      consistencyMode: "—",
      status: "NOT_PINNED",
      continuityStatement: "No Character voice identity is pinned. Another Character's voice is not inherited.",
    };
  }
  const continuityStatement =
    dna.consistencyMode === "DESCRIPTIVE_VOICE_DNA"
      ? "Semantic voice continuity. Exact acoustic continuity not guaranteed."
      : dna.consistencyMode === "CAPABILITY_VOICE_BINDING"
        ? "Stable voice capability pinned."
        : "Reference audio authority pinned. Execution support pending capability.";
  return {
    voiceIdentity: dna.consistencyMode,
    primaryLanguage: dna.primaryLocale,
    deliveryIdentity: dna.defaultDeliveryStyle,
    voicePresentation: `${PRESENTATION_LABEL[dna.voicePresentation.ageRangePresentation]}, ${PRESENTATION_LABEL[dna.voicePresentation.genderPresentation]}`,
    consistencyMode: dna.consistencyMode,
    status: dna.status,
    continuityStatement,
  };
}

export function assertVoiceDnaMatchesCharacterVersion(
  dna: Pick<AiStoryCharacterVoiceDna, "reusableCharacterId" | "reusableCharacterVersionId" | "characterIdentityFingerprint">,
  version: {
    reusableCharacterId: string;
    reusableCharacterVersionId: string;
    identityFingerprint: string;
  }
): void {
  if (
    dna.reusableCharacterId !== version.reusableCharacterId ||
    dna.reusableCharacterVersionId !== version.reusableCharacterVersionId ||
    dna.characterIdentityFingerprint !== version.identityFingerprint
  ) {
    throw new AiStoryCharacterVoiceDnaError(
      "VOICE_DNA_CHARACTER_VERSION_MISMATCH",
      "Voice DNA is pinned to a different Reusable Character version"
    );
  }
}

export function assertSpeakerOwnsVoiceDna(
  speakerReusableCharacterId: string,
  dna: Pick<AiStoryCharacterVoiceDna, "reusableCharacterId">
): void {
  if (speakerReusableCharacterId !== dna.reusableCharacterId) {
    throw new AiStoryCharacterVoiceDnaError(
      "VOICE_DNA_SPEAKER_MISMATCH",
      "A speaking Character cannot inherit another Character's Voice DNA"
    );
  }
}

export function assertVoiceContinuityPinned(binding: {
  voiceDnaId?: string;
  voiceDnaFingerprint?: string;
}): void {
  if (!binding.voiceDnaId || !binding.voiceDnaFingerprint) {
    throw new AiStoryCharacterVoiceDnaError(
      "VOICE_DNA_REQUIRED",
      "Required persistent-character voice identity is not pinned"
    );
  }
}

export function resolvePinnedVoiceDna<T extends { voiceDnaId: string }>(
  binding: { voiceDnaId?: string },
  authorities: readonly T[]
): T | null {
  if (!binding.voiceDnaId) return null;
  return authorities.find((authority) => authority.voiceDnaId === binding.voiceDnaId) ?? null;
}

export function assertVoiceDnaDialogueLocale(input: {
  voiceDna: Pick<
    AiStoryCharacterVoiceDna,
    "primaryLocale" | "allowedSecondaryLocales" | "codeSwitchPolicy"
  >;
  primaryLocale: AiStoryCharacterVoiceDna["primaryLocale"];
  secondaryLocales: readonly AiStoryCharacterVoiceDna["primaryLocale"][];
  codeSwitchPolicy: AiStoryCharacterVoiceDna["codeSwitchPolicy"];
}): void {
  const allowed = new Set([
    input.voiceDna.primaryLocale,
    ...input.voiceDna.allowedSecondaryLocales,
  ]);
  if (!allowed.has(input.primaryLocale) || input.primaryLocale !== input.voiceDna.primaryLocale) {
    throw new AiStoryCharacterVoiceDnaError(
      "VOICE_DNA_LOCALE_MISMATCH",
      "Dialogue locale is outside the Voice DNA spoken-locale identity"
    );
  }
  for (const locale of input.secondaryLocales) {
    if (!input.voiceDna.allowedSecondaryLocales.includes(locale)) {
      throw new AiStoryCharacterVoiceDnaError(
        "VOICE_DNA_LOCALE_MISMATCH",
        "Dialogue secondary locale is not authorized by Voice DNA"
      );
    }
  }
  if (
    input.voiceDna.codeSwitchPolicy.mode === "DISABLED" &&
    (input.secondaryLocales.length > 0 || input.codeSwitchPolicy.mode !== "DISABLED")
  ) {
    throw new AiStoryCharacterVoiceDnaError(
      "VOICE_DNA_CODE_SWITCH_MISMATCH",
      "Voice DNA does not authorize code-switching"
    );
  }
  for (const locale of input.codeSwitchPolicy.allowedLocales) {
    if (!allowed.has(locale)) {
      throw new AiStoryCharacterVoiceDnaError(
        "VOICE_DNA_CODE_SWITCH_MISMATCH",
        "Code-switch locale is not authorized by Voice DNA"
      );
    }
  }
}

export function assertVoiceDnaCapabilityMatch(
  dna: AiStoryCharacterVoiceDna,
  capability: {
    voiceCapabilityId: string;
    supportedGenderPresentations: readonly AiStoryCharacterVoiceDna["voicePresentation"]["genderPresentation"][];
    supportedAgeRangePresentations: readonly AiStoryCharacterVoiceDna["voicePresentation"]["ageRangePresentation"][];
  }
): void {
  if (dna.consistencyMode !== "CAPABILITY_VOICE_BINDING" || !dna.voiceCapabilityId) {
    throw new AiStoryCharacterVoiceDnaError(
      "VOICE_DNA_CAPABILITY_MISMATCH",
      "TTS compile requires a capability-bound Voice DNA"
    );
  }
  if (dna.voiceCapabilityId !== capability.voiceCapabilityId) {
    throw new AiStoryCharacterVoiceDnaError(
      "VOICE_DNA_CAPABILITY_MISMATCH",
      "TTS voice capability does not match the Voice DNA binding"
    );
  }
  if (
    capability.supportedGenderPresentations.length > 0 &&
    !capability.supportedGenderPresentations.includes(dna.voicePresentation.genderPresentation)
  ) {
    throw new AiStoryCharacterVoiceDnaError(
      "VOICE_DNA_PRESENTATION_MISMATCH",
      "Voice capability presentation does not match Voice DNA"
    );
  }
  if (
    capability.supportedAgeRangePresentations.length > 0 &&
    !capability.supportedAgeRangePresentations.includes(dna.voicePresentation.ageRangePresentation)
  ) {
    throw new AiStoryCharacterVoiceDnaError(
      "VOICE_DNA_PRESENTATION_MISMATCH",
      "Voice capability age presentation does not match Voice DNA"
    );
  }
}

export type ReferenceAudioAssetFact = {
  assetId: string;
  orgId: string;
  workspaceId: string;
  mediaType: string;
  status: string;
  contentHash: string;
  deleted: boolean;
};

export function assertReferenceAudioIdentity(
  dna: AiStoryCharacterVoiceDna,
  asset: ReferenceAudioAssetFact | null
): void {
  if (dna.consistencyMode !== "REFERENCE_AUDIO_IDENTITY") {
    throw new AiStoryCharacterVoiceDnaError(
      "VOICE_DNA_REFERENCE_AUDIO_REJECTED",
      "Reference audio validation requires reference-audio Voice DNA"
    );
  }
  if (!asset) {
    throw new AiStoryCharacterVoiceDnaError(
      "VOICE_DNA_REFERENCE_AUDIO_REJECTED",
      "Reference audio must be an approved asset, not a URL"
    );
  }
  const audio = asset.mediaType.toLowerCase().startsWith("audio/");
  const ready = asset.status.toLowerCase() === "ready";
  if (
    asset.deleted ||
    !audio ||
    !ready ||
    asset.orgId !== dna.orgId ||
    asset.workspaceId !== dna.workspaceId ||
    asset.assetId !== dna.referenceAudioAssetId ||
    asset.contentHash !== dna.referenceAudioContentHash
  ) {
    throw new AiStoryCharacterVoiceDnaError(
      "VOICE_DNA_REFERENCE_AUDIO_REJECTED",
      "Reference audio asset does not match the Voice DNA workspace, readiness, or content hash"
    );
  }
}

export function assertDialogueVoiceDnaBinding(input: {
  voiceDna: AiStoryCharacterVoiceDna;
  voiceDnaId?: string;
  voiceDnaFingerprint?: string;
  episodeBinding?: {
    voiceDnaId?: string;
    voiceDnaFingerprint?: string;
    reusableCharacterId: string;
    reusableCharacterVersionId: string;
    identityFingerprint: string;
  };
}): void {
  if (
    input.voiceDnaId !== input.voiceDna.voiceDnaId ||
    input.voiceDnaFingerprint !== input.voiceDna.voiceDnaFingerprint
  ) {
    throw new AiStoryCharacterVoiceDnaError(
      "VOICE_DNA_BINDING_MISMATCH",
      "Dialogue Performance authority is not bound to the exact Voice DNA"
    );
  }
  if (!input.episodeBinding) return;
  if (
    input.episodeBinding.voiceDnaId !== input.voiceDna.voiceDnaId ||
    input.episodeBinding.voiceDnaFingerprint !== input.voiceDna.voiceDnaFingerprint
  ) {
    throw new AiStoryCharacterVoiceDnaError(
      "VOICE_DNA_BINDING_MISMATCH",
      "Episode Character binding is not pinned to the exact Voice DNA"
    );
  }
  assertVoiceDnaMatchesCharacterVersion(input.voiceDna, {
    reusableCharacterId: input.episodeBinding.reusableCharacterId,
    reusableCharacterVersionId: input.episodeBinding.reusableCharacterVersionId,
    identityFingerprint: input.episodeBinding.identityFingerprint,
  });
}
