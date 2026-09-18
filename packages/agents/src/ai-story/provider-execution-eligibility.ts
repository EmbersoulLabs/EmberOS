/**
 * Provider execution eligibility for canonical Scene routing.
 *
 * A provider is routable only when it is enabled by server config,
 * executable by the provider runtime, capability-compatible, and
 * allowed by the frozen routing policy.
 *
 * Source-code presence is not eligibility. Client preference is not
 * availability. Secrets are never returned.
 */
import {
  AI_VIDEO_PROVIDER_IDS,
  getAiProviderConfig,
  isAiProviderReady,
  loadAiProviderConfigFromEnv,
  resetAiProviderConfigCache,
  type AiProviderConfig,
  type AiVideoProviderId,
  type ProviderExecutorCapabilityAuthority,
} from "@ceo-agent/shared";
import type { ProviderRoutingPolicy } from "../provider-router/contracts";

export const CANONICAL_VIDEO_PROVIDER_IDS = AI_VIDEO_PROVIDER_IDS;
export type CanonicalVideoProviderId = AiVideoProviderId;

export const NO_EXECUTABLE_PROVIDER_CODE = "NO_EXECUTABLE_PROVIDER" as const;

export type ProviderExecutionEligibility = {
  readonly providerId: CanonicalVideoProviderId;
  readonly enabled: boolean;
  readonly executable: boolean;
  readonly capabilityCompatible: boolean;
  readonly routingPolicyAllowed: boolean;
  readonly executorKind: "LOCAL_EXECUTOR" | "REMOTE_CANONICAL_WORKER_EXECUTOR";
  readonly modelSupported: boolean;
};

export type ProviderExecutionEligibilityInput = {
  readonly env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /**
   * Worker/runtime-registered provider ids. When omitted, executable follows
   * configuration readiness (enabled + required server config present).
   */
  readonly registeredProviderIds?: readonly string[];
  /**
   * Fresh non-secret capability facts published by a remote canonical Worker.
   * Presence of this field (including an empty list) disables local credential
   * inference and fails closed against the supplied Worker authority.
   */
  readonly executorAuthorities?: readonly ProviderExecutorCapabilityAuthority[];
  /** Explicit preferred ids. Invalid/disabled ids are dropped, never forged. */
  readonly preferredProviders?: readonly string[];
  readonly capabilityId?: string;
  readonly requestedModel?: string;
};

export function isProviderRoutable(
  eligibility: ProviderExecutionEligibility
): boolean {
  return (
    eligibility.enabled === true &&
    eligibility.executable === true &&
    eligibility.capabilityCompatible === true &&
    eligibility.routingPolicyAllowed === true
  );
}

export function loadCanonicalProviderConfig(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
): AiProviderConfig {
  if (!env || env === process.env) {
    return getAiProviderConfig();
  }
  return loadAiProviderConfigFromEnv(env);
}

export function resolveCanonicalVideoProviderEligibility(
  input: ProviderExecutionEligibilityInput = {}
): readonly ProviderExecutionEligibility[] {
  const config = loadCanonicalProviderConfig(input.env);
  const registered = input.registeredProviderIds
    ? new Set(input.registeredProviderIds)
    : null;
  const remoteAuthorities = input.executorAuthorities
    ? new Map(input.executorAuthorities.map((authority) => [authority.providerId, authority]))
    : null;
  const capabilityId = input.capabilityId ?? "animation-video-generation";
  const requestedModel = input.requestedModel?.trim();

  return CANONICAL_VIDEO_PROVIDER_IDS.map((providerId) => {
    const remoteAuthority = remoteAuthorities?.get(providerId);
    const enabled = remoteAuthorities
      ? remoteAuthority?.productEnabled === true
      : config.providers[providerId].enabled === true;
    const configured = isAiProviderReady(config, providerId);
    const executable = remoteAuthorities
      ? remoteAuthority?.executorRegistered === true &&
        remoteAuthority.executorReady === true
      : registered
        ? enabled && registered.has(providerId)
        : enabled && configured;
    const capabilityCompatible = remoteAuthorities
      ? remoteAuthority?.capabilityIds.includes(capabilityId) === true
      : capabilityId === "animation-video-generation";
    const modelSupported =
      !requestedModel ||
      (remoteAuthorities
        ? remoteAuthority?.supportedModels.includes(requestedModel) === true
        : config.providers[providerId].defaultModel === requestedModel);
    return {
      providerId,
      enabled,
      executable,
      capabilityCompatible,
      routingPolicyAllowed:
        enabled && executable && capabilityCompatible && modelSupported,
      executorKind: remoteAuthorities
        ? "REMOTE_CANONICAL_WORKER_EXECUTOR"
        : "LOCAL_EXECUTOR",
      modelSupported,
    };
  });
}

export function routableCanonicalVideoProviderIds(
  input: ProviderExecutionEligibilityInput = {}
): readonly CanonicalVideoProviderId[] {
  return resolveCanonicalVideoProviderEligibility(input)
    .filter(isProviderRoutable)
    .map((row) => row.providerId);
}

/**
 * Authority:
 *   explicit valid preferred provider
 *   → configured AI_DEFAULT_VIDEO_PROVIDER when eligible
 *   → remaining eligible providers (deterministic ranking)
 */
export function resolveCanonicalExecuteRoutingPolicy(
  input: ProviderExecutionEligibilityInput = {}
): ProviderRoutingPolicy {
  const config = loadCanonicalProviderConfig(input.env);
  const routable = routableCanonicalVideoProviderIds(input);
  const explicit = (input.preferredProviders ?? []).filter((id) =>
    routable.includes(id as CanonicalVideoProviderId)
  );
  const defaultVideo = config.defaults.video;
  const preferred =
    explicit.length > 0
      ? explicit
      : routable.includes(defaultVideo)
        ? [defaultVideo]
        : [];

  return {
    policyVersion: "1.0.0",
    preferredProviders: preferred,
    allowedProviders: [...routable],
    deniedProviders: CANONICAL_VIDEO_PROVIDER_IDS.filter(
      (id) => !routable.includes(id)
    ),
    requireTrainingOptOut: true,
  };
}

export function resetCanonicalProviderEligibilityCache(): void {
  resetAiProviderConfigCache();
}
