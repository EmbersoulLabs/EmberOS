/**
 * Sprint 3 PR 3.4A — Seedance Adapter configuration.
 * Credentials load only inside Adapter infrastructure via typed AI provider env.
 */
import {
  AiProviderConfigError,
  getAiProviderConfig,
  loadAiProviderConfigFromEnv,
  redactAiProviderConfig,
  type AiProviderConfig,
  type AiProviderConfigRedacted,
} from "@ceo-agent/shared";
import {
  SEEDANCE_ADAPTER_VERSION,
  SEEDANCE_PROVIDER_ID,
} from "./seedance-capability";

export class SeedanceConfigError extends Error {
  readonly code = "SEEDANCE_CONFIG_INVALID";
  readonly status = 500;

  constructor(
    message: string,
    readonly details: readonly string[] = []
  ) {
    super(details.length ? `${message}: ${details.join("; ")}` : message);
    this.name = "SeedanceConfigError";
  }
}

export type SeedanceAdapterConfig = {
  readonly providerId: typeof SEEDANCE_PROVIDER_ID;
  readonly adapterVersion: typeof SEEDANCE_ADAPTER_VERSION;
  readonly enabled: true;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly defaultModel: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
};

export type SeedanceAdapterConfigRedacted = Omit<SeedanceAdapterConfig, "apiKey"> & {
  readonly apiKey: "[REDACTED]";
};

export function loadSeedanceAdapterConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  options?: { readonly requireEnabled?: boolean }
): SeedanceAdapterConfig {
  let config: AiProviderConfig;
  try {
    config =
      env === process.env
        ? getAiProviderConfig()
        : loadAiProviderConfigFromEnv(env as NodeJS.ProcessEnv);
  } catch (error) {
    if (error instanceof AiProviderConfigError) {
      throw new SeedanceConfigError(error.message, error.details);
    }
    throw error;
  }

  const seedance = config.providers.seedance;
  const requireEnabled = options?.requireEnabled !== false;
  const details: string[] = [];

  if (requireEnabled && !seedance.enabled) {
    details.push("AI_PROVIDER_SEEDANCE_ENABLED must be true");
  }
  if (!seedance.baseUrl) {
    details.push("AI_PROVIDER_SEEDANCE_BASE_URL is required");
  }
  if (!seedance.apiKey) {
    details.push("AI_PROVIDER_SEEDANCE_API_KEY is required");
  }
  if (!seedance.defaultModel) {
    details.push("AI_PROVIDER_SEEDANCE_DEFAULT_MODEL is required");
  }
  if (details.length > 0) {
    throw new SeedanceConfigError("Seedance Adapter configuration is invalid", details);
  }

  return {
    providerId: SEEDANCE_PROVIDER_ID,
    adapterVersion: SEEDANCE_ADAPTER_VERSION,
    enabled: true,
    baseUrl: seedance.baseUrl!.replace(/\/+$/, ""),
    apiKey: seedance.apiKey!,
    defaultModel: seedance.defaultModel!,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  };
}

export function redactSeedanceAdapterConfig(
  config: SeedanceAdapterConfig
): SeedanceAdapterConfigRedacted {
  return {
    providerId: config.providerId,
    adapterVersion: config.adapterVersion,
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    apiKey: "[REDACTED]",
    defaultModel: config.defaultModel,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  };
}

export function redactAiConfigForSeedanceLogs(
  config: AiProviderConfig = getAiProviderConfig()
): AiProviderConfigRedacted {
  return redactAiProviderConfig(config);
}
