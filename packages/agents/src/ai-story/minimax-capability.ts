/**
 * Sprint 3 PR 3.4B — MiniMax capability declaration.
 * Documents only capabilities supported by the configured MiniMax Video V2
 * HTTP contract used by EmberOS (async generation + lookup).
 *
 * Callbacks exist in the Provider API (`callback_url`) but EmberOS V1 does not
 * implement callback verification or public callback endpoints — declare unsupported.
 *
 * Provider-native idempotency is NOT documented on MiniMax Video V2 create.
 * EmberOS deterministic replay remains through canonical RuntimeAuthorization,
 * scheduling, Provider Execution, Dispatch, Worker Attempt, and Worker Execution
 * Result identities — not through Provider-native dedupe.
 */
import type { ProviderCapabilityDeclaration } from "../provider-adapters/contracts";

export const MINIMAX_PROVIDER_ID = "minimax" as const;
export const MINIMAX_ADAPTER_VERSION = "1.0.0" as const;
export const MINIMAX_CAPABILITY_ID = "animation-video-generation" as const;

/** MiniMax Video V2 does not expose documented Provider-native idempotency. */
export const MINIMAX_NATIVE_IDEMPOTENCY_SUPPORTED = false as const;

/** Supported durations (seconds) per MiniMax Video V2 create contract. */
export const MINIMAX_SUPPORTED_DURATIONS_SEC = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
] as const;

/**
 * Supported aspect ratios for text-to-video (ratio required; not adaptive).
 * Image/reference modes may use adaptive at the Provider; EmberOS V1 maps
 * concrete ratios from the canonical payload when present.
 */
export const MINIMAX_SUPPORTED_ASPECT_RATIOS = [
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
] as const;

/** Supported output resolution labels (Adapter-owned; MiniMax wire: 768P | 2K). */
export const MINIMAX_SUPPORTED_RESOLUTIONS = ["768P", "2K"] as const;

/** Maximum reference images accepted per submission (official limit). */
export const MINIMAX_MAX_REFERENCE_IMAGES = 9 as const;

/**
 * Callback support for this Adapter version.
 * Provider may accept callback_url, but EmberOS V1 does not implement callbacks.
 */
export const MINIMAX_CALLBACKS_SUPPORTED = false as const;

export type MinimaxCapabilityDetails = {
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
  /** Output audio generation is not claimed for V1 mapping. */
  readonly audioSupport: false;
  readonly firstLastFrameSupport: true;
  readonly concurrencyClass: "provider-rate-limited";
};

const BASE_MINIMAX_CAPABILITY = Object.freeze({
  providerId: MINIMAX_PROVIDER_ID,
  adapterVersion: MINIMAX_ADAPTER_VERSION,
  capabilityId: MINIMAX_CAPABILITY_ID,
  capabilityVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requestSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  resultSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requiredProviderFeatures: ["LOOKUP"],
  nativeIdempotency: MINIMAX_NATIVE_IDEMPOTENCY_SUPPORTED,
  lookup: true,
  cancellation: false,
  callbacks: MINIMAX_CALLBACKS_SUPPORTED,
  streaming: false,
  routing: {
    costClass: "MEDIUM",
    estimatedCostUsd: 0.4,
    latencyClass: "SLOW",
    qualityClass: "HIGH",
    reliabilityClass: "HIGH",
    regions: ["global"],
    modelFamilies: ["minimax", "MiniMax-H3"],
    sensitiveDataAllowed: false,
    externalProcessing: true,
    trainingOptOut: true,
    zeroRetention: false,
    maximumRetentionDays: 7,
    enterpriseControls: false,
  },
} satisfies ProviderCapabilityDeclaration);

export function buildMinimaxCapabilityDeclaration(input?: {
  readonly defaultModel?: string | null;
  readonly region?: string;
}): ProviderCapabilityDeclaration {
  const region = input?.region?.trim() || "global";
  const model = input?.defaultModel?.trim();
  return Object.freeze({
    ...BASE_MINIMAX_CAPABILITY,
    routing: {
      ...BASE_MINIMAX_CAPABILITY.routing,
      regions: [region],
      modelFamilies: model
        ? ["minimax", "MiniMax-H3", model]
        : [...BASE_MINIMAX_CAPABILITY.routing.modelFamilies],
    },
  });
}

export function minimaxCapabilityDetails(input?: {
  readonly defaultModel?: string | null;
}): MinimaxCapabilityDetails {
  const model = input?.defaultModel?.trim() || "MiniMax-H3";
  return {
    textToVideo: true,
    imageToVideo: true,
    supportedDurationsSec: [...MINIMAX_SUPPORTED_DURATIONS_SEC],
    supportedAspectRatios: [...MINIMAX_SUPPORTED_ASPECT_RATIOS],
    supportedResolutions: [...MINIMAX_SUPPORTED_RESOLUTIONS],
    maxReferenceImages: MINIMAX_MAX_REFERENCE_IMAGES,
    asynchronousJobs: true,
    polling: true,
    callbacks: false,
    nativeIdempotency: false,
    modelIdentifiers: [model],
    audioSupport: false,
    firstLastFrameSupport: true,
    concurrencyClass: "provider-rate-limited",
  };
}
