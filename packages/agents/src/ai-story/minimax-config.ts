/**
 * Sprint 3 PR 3.4B — MiniMax Adapter configuration.
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
  MINIMAX_ADAPTER_VERSION,
  MINIMAX_PROVIDER_ID,
} from "./minimax-capability";

export class MinimaxConfigError extends Error {
  readonly code = "MINIMAX_CONFIG_INVALID";
  readonly status = 500;

  constructor(
    message: string,
    readonly details: readonly string[] = []
  ) {
    super(details.length ? `${message}: ${details.join("; ")}` : message);
    this.name = "MinimaxConfigError";
  }
}

export type MinimaxAdapterConfig = {
  readonly providerId: typeof MINIMAX_PROVIDER_ID;
  readonly adapterVersion: typeof MINIMAX_ADAPTER_VERSION;
  readonly enabled: true;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly defaultModel: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
};

export type MinimaxAdapterConfigRedacted = Omit<MinimaxAdapterConfig, "apiKey"> & {
  readonly apiKey: "[REDACTED]";
};

export function loadMinimaxAdapterConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  options?: { readonly requireEnabled?: boolean }
): MinimaxAdapterConfig {
  let config: AiProviderConfig;
  try {
    config =
      env === process.env
        ? getAiProviderConfig()
        : loadAiProviderConfigFromEnv(env as NodeJS.ProcessEnv);
  } catch (error) {
    if (error instanceof AiProviderConfigError) {
      throw new MinimaxConfigError(error.message, error.details);
    }
    throw error;
  }

  const minimax = config.providers.minimax;
  const requireEnabled = options?.requireEnabled !== false;
  const details: string[] = [];

  if (requireEnabled && !minimax.enabled) {
    details.push("AI_PROVIDER_MINIMAX_ENABLED must be true");
  }
  if (!minimax.baseUrl) {
    details.push("AI_PROVIDER_MINIMAX_BASE_URL is required");
  }
  if (!minimax.apiKey) {
    details.push("AI_PROVIDER_MINIMAX_API_KEY is required");
  }
  if (!minimax.defaultModel) {
    details.push("AI_PROVIDER_MINIMAX_DEFAULT_MODEL is required");
  }
  if (details.length > 0) {
    throw new MinimaxConfigError("MiniMax Adapter configuration is invalid", details);
  }

  return {
    providerId: MINIMAX_PROVIDER_ID,
    adapterVersion: MINIMAX_ADAPTER_VERSION,
    enabled: true,
    baseUrl: minimax.baseUrl!.replace(/\/+$/, ""),
    apiKey: minimax.apiKey!,
    defaultModel: minimax.defaultModel!,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  };
}

export function redactMinimaxAdapterConfig(
  config: MinimaxAdapterConfig
): MinimaxAdapterConfigRedacted {
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

export function redactAiConfigForMinimaxLogs(
  config: AiProviderConfig = getAiProviderConfig()
): AiProviderConfigRedacted {
  return redactAiProviderConfig(config);
}
