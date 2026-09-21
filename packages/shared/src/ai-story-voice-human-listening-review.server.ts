import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "./canonical-integrity";
import {
  AI_STORY_VOICE_LISTENING_SAMPLE_PLAN_VERSION,
  AiStoryVoiceListeningExecutionPreviewSchema,
  AiStoryVoiceListeningLocaleSchema,
  AiStoryVoiceListeningSamplePlanSchema,
  type AiStoryVoiceHumanListeningCertification,
  type AiStoryVoiceListeningExecutionPreview,
  type AiStoryVoiceListeningSamplePlan,
} from "./ai-story-voice-human-listening-review";
import type { z } from "zod";

export const OPENAI_SPEECH_OFFICIAL_GUIDE_URL =
  "https://platform.openai.com/docs/guides/text-to-speech" as const;
export const OPENAI_GPT_4O_MINI_TTS_MODEL_URL =
  "https://platform.openai.com/docs/models/gpt-4o-mini-tts" as const;
export const OPENAI_API_PRICING_URL =
  "https://openai.com/api/pricing/" as const;

export const CURRENT_IMPLEMENTATION_PROVIDER = "openai" as const;
export const CURRENT_IMPLEMENTATION_MODEL = "tts-1-hd" as const;
export const CURRENT_PROVIDER_STATUS =
  "SUPPORTED_OLDER_MODEL_NOT_OFFICIALLY_LABELLED_LEGACY" as const;
export const CURRENT_RECOMMENDED_PROVIDER_MODEL =
  "gpt-4o-mini-tts" as const;
export const MODEL_MIGRATION_RECOMMENDED = true as const;
export const MIGRATION_REQUIRED = true as const;
export const MIGRATION_SCOPE =
  "CAPABILITY_DRIVEN_ADAPTER_MODEL_AND_INSTRUCTIONS_UPDATE" as const;
export const MODEL_MIGRATION_REASON =
  "Official OpenAI guidance identifies gpt-4o-mini-tts as its newest and most reliable TTS model with prompt control over accent, emotion, intonation, speed, and tone; tts-1-hd remains listed but lacks that instruction surface." as const;

export const PROPOSED_LISTENING_PROVIDER = "openai" as const;
export const PROPOSED_LISTENING_MODEL = "gpt-4o-mini-tts" as const;
export const PROPOSED_LISTENING_VOICE = "marin" as const;
export const PROPOSED_LISTENING_OUTPUT_FORMAT = "wav" as const;
export const PROPOSED_MAXIMUM_AUDIO_MINUTES = 1 as const;
export const OFFICIAL_ESTIMATED_AUDIO_COST_PER_MINUTE_USD = 0.017 as const;
export const PROPOSED_ESTIMATED_MAXIMUM_COST_USD = 0.02 as const;

type ListeningLocale = z.infer<typeof AiStoryVoiceListeningLocaleSchema>;

const SAMPLE_DEFINITIONS: ReadonlyArray<{
  locale: ListeningLocale;
  text: string;
  purpose: string;
  instructions: string;
  blocked: boolean;
}> = [
  {
    locale: "en-SG",
    text: "Your flowers are arriving this afternoon, right on time for the surprise.",
    purpose:
      "Singapore English neutral conversational commercial narration: clarity, pacing, local acceptability, and avoidance of theatrical US/UK delivery.",
    instructions:
      "Speak in clear, natural Singapore English with a warm neutral commercial tone. Do not add or rewrite any words.",
    blocked: false,
  },
  {
    locale: "en-MY",
    text: "Your flowers are arriving this afternoon, right on time for the surprise.",
    purpose:
      "Malaysian English matched-content comparison: clarity, pacing, local acceptability, and avoidance of a forced accent.",
    instructions:
      "Speak in clear, natural Malaysian English with a warm neutral commercial tone. Do not add or rewrite any words.",
    blocked: false,
  },
  {
    locale: "zh-SG",
    text: "您的花将在今天下午送达，正好赶上这份惊喜。",
    purpose:
      "Singapore Mandarin commercial narration: pronunciation, lexical tone accuracy, pacing, and local commercial naturalness.",
    instructions:
      "Use clear, natural Mandarin appropriate for a Singapore audience, with warm neutral commercial delivery. Preserve the exact text.",
    blocked: false,
  },
  {
    locale: "zh-MY",
    text: "您的花会在今天下午送到，正好赶上这份惊喜。",
    purpose:
      "Malaysian Mandarin commercial narration: pronunciation, tone accuracy, pacing, and acceptability without dialect invention.",
    instructions:
      "Use clear, natural Mandarin appropriate for a Malaysian Chinese audience, with warm neutral commercial delivery. Preserve the exact text.",
    blocked: false,
  },
  {
    locale: "ms-MY",
    text: "Bunga anda akan tiba petang ini, tepat pada masanya untuk kejutan itu.",
    purpose:
      "Malaysian Malay narration: pronunciation, stress, rhythm, intelligibility, and commercial usability.",
    instructions:
      "Speak in clear, natural Bahasa Melayu for a Malaysian audience, with warm neutral commercial delivery. Do not add or rewrite any words.",
    blocked: false,
  },
  {
    locale: "CODE_SWITCH",
    text: "Tak apa, later I settle.",
    purpose:
      "Realistic Script-authorized English and Malay code-switch quality; blocked because the current certified voice capability declares no code-switch pair.",
    instructions:
      "Preserve the exact Script-authorized English and Malay wording.",
    blocked: true,
  },
] as const;

function capabilityFor(definition: (typeof SAMPLE_DEFINITIONS)[number]) {
  const generationSettings = {
    instructions: definition.instructions,
    speed: 1,
    noTextRewrite: true,
  };
  return {
    provider: PROPOSED_LISTENING_PROVIDER,
    model: PROPOSED_LISTENING_MODEL,
    voice: PROPOSED_LISTENING_VOICE,
    locale: definition.locale,
    deliveryStyle: "STANDARD_NEUTRAL",
    outputFormat: PROPOSED_LISTENING_OUTPUT_FORMAT,
    generationSettings,
    generationSettingsFingerprint:
      sha256CanonicalIntegrityHash(generationSettings),
  } as const;
}

export function computeAiStoryVoiceListeningRequestFingerprint(input: {
  capability: ReturnType<typeof capabilityFor>;
  exactScriptText: string;
}): string {
  return sha256CanonicalIntegrityHash({
    planVersion: AI_STORY_VOICE_LISTENING_SAMPLE_PLAN_VERSION,
    capability: input.capability,
    exactScriptText: input.exactScriptText,
  });
}

export function buildProposedSgMyVoiceListeningSamples(): AiStoryVoiceListeningSamplePlan[] {
  return SAMPLE_DEFINITIONS.map((definition) => {
    const capability = capabilityFor(definition);
    const requestFingerprint =
      computeAiStoryVoiceListeningRequestFingerprint({
        capability,
        exactScriptText: definition.text,
      });
    return AiStoryVoiceListeningSamplePlanSchema.parse({
      sampleId: deterministicUuidFromFingerprint(
        "ai-story-voice-listening-sample",
        requestFingerprint
      ),
      planVersion: AI_STORY_VOICE_LISTENING_SAMPLE_PLAN_VERSION,
      capability,
      exactScriptText: definition.text,
      characterCount: Array.from(definition.text).length,
      purpose: definition.purpose,
      expectedPaidCallCount: definition.blocked ? 0 : 1,
      status: definition.blocked
        ? "CAPABILITY_BLOCKED"
        : "PLANNED_AWAITING_AUTHORIZATION",
      blockedReason: definition.blocked
        ? "CODE_SWITCH_PROVIDER_CAPABILITY_UNSUPPORTED"
        : null,
      requestFingerprint,
      outputContentHash: null,
      outputDurationMs: null,
    });
  });
}

export function buildProposedSgMyVoiceListeningExecutionPreview(): AiStoryVoiceListeningExecutionPreview {
  const samples = buildProposedSgMyVoiceListeningSamples();
  const payable = samples.filter(
    (sample) => sample.status === "PLANNED_AWAITING_AUTHORIZATION"
  );
  return AiStoryVoiceListeningExecutionPreviewSchema.parse({
    provider: PROPOSED_LISTENING_PROVIDER,
    model: PROPOSED_LISTENING_MODEL,
    voice: PROPOSED_LISTENING_VOICE,
    samples,
    paidSampleCount: payable.length,
    totalCharacters: payable.reduce(
      (total, sample) => total + sample.characterCount,
      0
    ),
    estimatedMaximumCostUsd: PROPOSED_ESTIMATED_MAXIMUM_COST_USD,
    outputFormat: PROPOSED_LISTENING_OUTPUT_FORMAT,
    productionMutation: false,
    commercialReservation: false,
    videoProviderCalls: 0,
    authorizationStatus:
      "WAITING_FOR_EXPLICIT_PAID_TTS_AUTHORIZATION",
  });
}

export function deriveVoiceListeningCertificationResult(
  localeResults: AiStoryVoiceHumanListeningCertification["localeResults"]
): AiStoryVoiceHumanListeningCertification["resultState"] {
  const required = [
    localeResults["en-SG"],
    localeResults["en-MY"],
    localeResults["zh-SG"],
    localeResults["zh-MY"],
    localeResults["ms-MY"],
  ];
  if (required.every((result) => result === "FAIL")) {
    return "REJECTED_PROVIDER_MODEL";
  }
  if (
    required.every((result) => result === "PASS") &&
    localeResults.CODE_SWITCH === "PASS"
  ) {
    return "CERTIFIED_FOR_SELECTED_LOCALES";
  }
  return "PARTIALLY_CERTIFIED";
}
