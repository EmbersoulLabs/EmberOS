/**
 * Future-ready capability declarations for providers not yet wired with API keys.
 * These are NOT registered as executable adapters until credentials + HTTP paths exist.
 * Router remains capability-driven and vendor-agnostic in product UI.
 * Marketing-image generation is out of scope for AI Story Execution (video only).
 */
import type { ProviderCapabilityDeclaration } from "./contracts";

export const FUTURE_PROVIDER_CAPABILITY_IDS = [
  "animation-video-generation",
] as const;

export const FUTURE_PROVIDER_IDS = [
  "runway",
  "kling",
  "veo",
  "comfyui",
] as const;

export function futureProviderCapabilityStub(
  providerId: (typeof FUTURE_PROVIDER_IDS)[number],
  capabilityId: (typeof FUTURE_PROVIDER_CAPABILITY_IDS)[number]
): ProviderCapabilityDeclaration {
  const declaration: ProviderCapabilityDeclaration = {
    providerId,
    adapterVersion: "0.0.0-future",
    capabilityId,
    capabilityVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
    requestSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
    resultSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
    requiredProviderFeatures: [],
    nativeIdempotency: false,
    lookup: true,
    cancellation: false,
    callbacks: false,
    streaming: false,
    routing: {
      costClass: "HIGH",
      latencyClass: "SLOW",
      qualityClass: "PREMIUM",
      reliabilityClass: "STANDARD",
      regions: [],
      modelFamilies: [providerId],
      sensitiveDataAllowed: false,
      externalProcessing: true,
      trainingOptOut: true,
      zeroRetention: false,
      enterpriseControls: false,
    },
  };
  return Object.freeze(declaration);
}
