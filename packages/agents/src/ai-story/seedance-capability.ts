/**
 * Sprint 3 PR 3.4A — Seedance capability declaration.
 * Documents only capabilities supported by the configured Seedance HTTP contract
 * used by EmberOS (async generation + lookup). Callbacks are unavailable.
 *
 * Provider-native idempotency is NOT supported on ModelArk V1 (no documented
 * idempotency key/header). EmberOS deterministic replay remains through canonical
 * RuntimeAuthorization, scheduling, Provider Execution, Dispatch, Worker Attempt,
 * and Worker Execution Result identities — not through Provider-native dedupe.
 */
import type { ProviderCapabilityDeclaration } from "../provider-adapters/contracts";
import {
  AI_STORY_SEEDANCE_NATIVE_AUDIO_CAPABILITY_VERSION,
  SEEDANCE_NATIVE_AUDIO_API,
  SEEDANCE_NATIVE_AUDIO_MAX_DURATION_SEC,
  SEEDANCE_NATIVE_AUDIO_MIN_DURATION_SEC,
  SEEDANCE_NATIVE_AUDIO_MODEL,
  SEEDANCE_NATIVE_AUDIO_OFFICIAL_DOCUMENTATION,
  SEEDANCE_NATIVE_AUDIO_OUTPUT_CONTAINER,
  SEEDANCE_NATIVE_AUDIO_PROVIDER,
  SEEDANCE_NATIVE_AUDIO_REQUEST_PARAMETER,
  AiStorySeedanceNativeAudioCapabilitySchema,
  type AiStorySeedanceNativeAudioCapability,
} from "@ceo-agent/shared";

export const SEEDANCE_PROVIDER_ID = "seedance" as const;
export const SEEDANCE_ADAPTER_VERSION = "1.0.0" as const;
export const SEEDANCE_CAPABILITY_ID = "animation-video-generation" as const;

/** ModelArk V1 does not expose documented Provider-native idempotency. */
export const SEEDANCE_NATIVE_IDEMPOTENCY_SUPPORTED = false as const;

/** Supported durations (seconds) for controlled Seedance mapping. */
export const SEEDANCE_SUPPORTED_DURATIONS_SEC = [4, 5, 6, 8, 10, 12] as const;

/** Supported aspect ratios claimed by this Adapter version. */
export const SEEDANCE_SUPPORTED_ASPECT_RATIOS = ["9:16", "16:9", "1:1"] as const;

/** Supported output resolution labels (Adapter-owned; not product UI). */
export const SEEDANCE_SUPPORTED_RESOLUTIONS = ["480p", "720p", "1080p"] as const;

/** Maximum reference images accepted per submission. */
export const SEEDANCE_MAX_REFERENCE_IMAGES = 4 as const;
export const SEEDANCE_NATIVE_AUDIO_MODELS = [
  "dreamina-seedance-2-0-260128",
] as const;
export const SEEDANCE_NATIVE_AUDIO_SUPPORTED_DURATIONS_SEC = [
  4, 5, 6, 8, 10, 12, 15,
] as const;

/**
 * Exact model authority for the bounded EmberOS first-frame mapping. BytePlus
 * documents first-frame I2V for this deployed model. First/last-frame remains
 * outside the EmberOS-certified capability envelope.
 */
export const SEEDANCE_FIRST_FRAME_I2V_MODELS = [
  "dreamina-seedance-2-0-260128",
] as const;

export const SEEDANCE_PRODUCT_CONTINUITY_LEVEL =
  "PROBABILISTIC_STRONG_GROUNDING" as const;
export const SEEDANCE_SELECTED_PRODUCT_GROUNDED_MODE =
  "FIRST_FRAME_I2V" as const;

export function seedanceSupportsFirstFrameI2v(model: string): boolean {
  return (SEEDANCE_FIRST_FRAME_I2V_MODELS as readonly string[]).includes(
    model.trim()
  );
}

/**
 * Callback support for this Adapter version.
 * Seedance HTTP contract used here is polling-only; do not fabricate callbacks.
 */
export const SEEDANCE_CALLBACKS_SUPPORTED = false as const;

export type SeedanceCapabilityDetails = {
  readonly textToVideo: true;
  readonly imageToVideo: true;
  readonly supportedDurationsSec: readonly number[];
  readonly supportedAspectRatios: readonly string[];
  readonly supportedResolutions: readonly string[];
  readonly maxReferenceImages: number;
  readonly asynchronousJobs: true;
  readonly polling: true;
  readonly callbacks: false;
  readonly nativeIdempotency: false;
  readonly modelIdentifiers: readonly string[];
  /** Historical V1 aggregate capability; native AV is versioned separately. */
  readonly audioSupport: false;
  readonly nativeAudioSupport: boolean;
  readonly nativeDialogueSupport: boolean;
  readonly visibleCharacterDialogueSupport: boolean;
  readonly referenceImageWithAudioSupport: boolean;
  readonly dialogueLipSyncSupport:
    | "HUMAN_REVIEW_REQUIRED"
    | "UNSUPPORTED";
  readonly supportedAudioLocales: readonly (
    | "en-SG"
    | "en-MY"
    | "ms-MY"
    | "zh-SG"
    | "zh-MY"
  )[];
  readonly supportedCodeSwitchBehavior: "UNVERIFIED" | "UNSUPPORTED";
  readonly maxNativeAudioDurationSec: 15 | null;
  readonly nativeAudioOutputContainer: "video/mp4" | null;
  readonly legacyVideoOnlyGenerateAudio: false;
  readonly referenceImageT2vSupport: true;
  readonly firstFrameI2vSupport: boolean;
  readonly firstLastFrameSupport: boolean;
  readonly multiImageReferenceSupport: true;
  readonly deterministicExactProductLock: false;
  readonly productContinuityLevel: typeof SEEDANCE_PRODUCT_CONTINUITY_LEVEL;
  readonly concurrencyClass: "provider-rate-limited";
};

const BASE_SEEDANCE_CAPABILITY = Object.freeze({
  providerId: SEEDANCE_PROVIDER_ID,
  adapterVersion: SEEDANCE_ADAPTER_VERSION,
  capabilityId: SEEDANCE_CAPABILITY_ID,
  capabilityVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requestSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  resultSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requiredProviderFeatures: ["LOOKUP"],
  nativeIdempotency: SEEDANCE_NATIVE_IDEMPOTENCY_SUPPORTED,
  lookup: true,
  cancellation: false,
  callbacks: SEEDANCE_CALLBACKS_SUPPORTED,
  streaming: false,
  routing: {
    costClass: "MEDIUM",
    estimatedCostUsd: 0.35,
    latencyClass: "SLOW",
    qualityClass: "HIGH",
    reliabilityClass: "HIGH",
    regions: ["ap-southeast"],
    modelFamilies: ["seedance", "dreamina-seedance"],
    sensitiveDataAllowed: false,
    externalProcessing: true,
    trainingOptOut: true,
    zeroRetention: false,
    maximumRetentionDays: 30,
    enterpriseControls: false,
  },
} satisfies ProviderCapabilityDeclaration);

export function buildSeedanceCapabilityDeclaration(input?: {
  readonly defaultModel?: string | null;
  readonly region?: string;
}): ProviderCapabilityDeclaration {
  const region = input?.region?.trim() || "ap-southeast";
  const model = input?.defaultModel?.trim();
  return Object.freeze({
    ...BASE_SEEDANCE_CAPABILITY,
    routing: {
      ...BASE_SEEDANCE_CAPABILITY.routing,
      regions: [region],
      modelFamilies: model
        ? ["seedance", "dreamina-seedance", model]
        : [...BASE_SEEDANCE_CAPABILITY.routing.modelFamilies],
    },
  });
}

export function seedanceCapabilityDetails(input?: {
  readonly defaultModel?: string | null;
}): SeedanceCapabilityDetails {
  const model = input?.defaultModel?.trim() || "dreamina-seedance-2-0-260128";
  const nativeAudio = seedanceSupportsNativeAudio(model);
  return {
    textToVideo: true,
    imageToVideo: true,
    supportedDurationsSec: [...SEEDANCE_SUPPORTED_DURATIONS_SEC],
    supportedAspectRatios: [...SEEDANCE_SUPPORTED_ASPECT_RATIOS],
    supportedResolutions: [...SEEDANCE_SUPPORTED_RESOLUTIONS],
    maxReferenceImages: SEEDANCE_MAX_REFERENCE_IMAGES,
    asynchronousJobs: true,
    polling: true,
    callbacks: false,
    nativeIdempotency: false,
    modelIdentifiers: [model],
    audioSupport: false,
    nativeAudioSupport: nativeAudio,
    nativeDialogueSupport: nativeAudio,
    visibleCharacterDialogueSupport: nativeAudio,
    referenceImageWithAudioSupport: nativeAudio,
    dialogueLipSyncSupport: nativeAudio
      ? "HUMAN_REVIEW_REQUIRED"
      : "UNSUPPORTED",
    supportedAudioLocales: nativeAudio
      ? ["en-SG", "en-MY", "ms-MY", "zh-SG", "zh-MY"]
      : [],
    supportedCodeSwitchBehavior: nativeAudio
      ? "UNVERIFIED"
      : "UNSUPPORTED",
    maxNativeAudioDurationSec: nativeAudio ? 15 : null,
    nativeAudioOutputContainer: nativeAudio ? "video/mp4" : null,
    legacyVideoOnlyGenerateAudio: false,
    referenceImageT2vSupport: true,
    firstFrameI2vSupport: seedanceSupportsFirstFrameI2v(model),
    firstLastFrameSupport: false,
    multiImageReferenceSupport: true,
    deterministicExactProductLock: false,
    productContinuityLevel: SEEDANCE_PRODUCT_CONTINUITY_LEVEL,
    concurrencyClass: "provider-rate-limited",
  };
}

export function seedanceSupportsNativeAudio(model: string): boolean {
  return (SEEDANCE_NATIVE_AUDIO_MODELS as readonly string[]).includes(
    model.trim()
  );
}

export function buildSeedanceNativeAudioCapability(input?: {
  readonly realProviderCertification?:
    | "NOT_RUN"
    | "TECHNICAL_PASS_HUMAN_REVIEW_REQUIRED"
    | "PASS"
    | "FAIL";
}): AiStorySeedanceNativeAudioCapability {
  return AiStorySeedanceNativeAudioCapabilitySchema.parse({
    capabilityVersion: AI_STORY_SEEDANCE_NATIVE_AUDIO_CAPABILITY_VERSION,
    providerId: SEEDANCE_NATIVE_AUDIO_PROVIDER,
    modelId: SEEDANCE_NATIVE_AUDIO_MODEL,
    endpoint: SEEDANCE_NATIVE_AUDIO_API,
    region: "ap-southeast",
    requestParameter: SEEDANCE_NATIVE_AUDIO_REQUEST_PARAMETER,
    nativeAudioSupport: true,
    nativeDialogueSupport: true,
    visibleCharacterDialogueSupport: true,
    referenceImageWithAudioSupport: true,
    dialogueLipSyncSupport: "HUMAN_REVIEW_REQUIRED",
    localeRequestSupport: ["en-SG", "en-MY", "ms-MY", "zh-SG", "zh-MY"],
    localeNaturalnessCertification: "HUMAN_REVIEW_REQUIRED",
    codeSwitchBehavior: "UNVERIFIED",
    minDurationSec: SEEDANCE_NATIVE_AUDIO_MIN_DURATION_SEC,
    maxDurationSec: SEEDANCE_NATIVE_AUDIO_MAX_DURATION_SEC,
    outputContainer: SEEDANCE_NATIVE_AUDIO_OUTPUT_CONTAINER,
    officialDocumentation: [...SEEDANCE_NATIVE_AUDIO_OFFICIAL_DOCUMENTATION],
    accessRestrictions: [
      "Model must be activated for the BytePlus account before execution",
      "BytePlus documentation recommends account balance above USD 30, an eligible savings plan, or an available Seedance 2.0 resource pack",
      "Provider asset URLs must remain accessible for task execution",
    ],
    realProviderCertification: input?.realProviderCertification ??
      "TECHNICAL_PASS_HUMAN_REVIEW_REQUIRED",
  });
}
