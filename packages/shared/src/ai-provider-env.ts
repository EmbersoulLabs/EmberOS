/**
 * AI Provider Environment Foundation — typed config only.
 *
 * Architecture target:
 *   Environment → Config → Provider Registry → Provider Router
 *
 * This module is Config only. It does not register adapters, route requests,
 * call external APIs, or touch billing/credits/entitlements.
 *
 * No provider or business logic should read process.env for AI providers;
 * load via loadAiProviderConfig() / getAiProviderConfig() instead.
 */
import { z } from "zod";

export const AI_PROVIDER_IDS = ["openai", "seedance", "minimax", "fal"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_PROVIDER_ROUTING_MODES = ["fixed"] as const;
export type AiProviderRoutingMode = (typeof AI_PROVIDER_ROUTING_MODES)[number];

export const AI_TEXT_PROVIDER_IDS = ["openai"] as const;
export const AI_VIDEO_PROVIDER_IDS = ["seedance", "minimax"] as const;
export const AI_UPSCALE_PROVIDER_IDS = ["fal"] as const;

export type AiTextProviderId = (typeof AI_TEXT_PROVIDER_IDS)[number];
export type AiVideoProviderId = (typeof AI_VIDEO_PROVIDER_IDS)[number];
export type AiUpscaleProviderId = (typeof AI_UPSCALE_PROVIDER_IDS)[number];

/** Env keys owned by this foundation (never NEXT_PUBLIC / VITE). */
export const AI_PROVIDER_ENV_KEYS = {
  ROUTING_MODE: "AI_PROVIDER_ROUTING_MODE",
  DEFAULT_TEXT_PROVIDER: "AI_DEFAULT_TEXT_PROVIDER",
  DEFAULT_VIDEO_PROVIDER: "AI_DEFAULT_VIDEO_PROVIDER",
  DEFAULT_UPSCALE_PROVIDER: "AI_DEFAULT_UPSCALE_PROVIDER",
  COST_TRACKING_ENABLED: "AI_COST_TRACKING_ENABLED",
  USAGE_LOG_ENABLED: "AI_USAGE_LOG_ENABLED",
  TIMEOUT_MS: "AI_PROVIDER_TIMEOUT_MS",
  MAX_RETRIES: "AI_PROVIDER_MAX_RETRIES",
  OPENAI_ENABLED: "AI_PROVIDER_OPENAI_ENABLED",
  OPENAI_BASE_URL: "AI_PROVIDER_OPENAI_BASE_URL",
  OPENAI_API_KEY: "AI_PROVIDER_OPENAI_API_KEY",
  OPENAI_DEFAULT_MODEL: "AI_PROVIDER_OPENAI_DEFAULT_MODEL",
  SEEDANCE_ENABLED: "AI_PROVIDER_SEEDANCE_ENABLED",
  SEEDANCE_BASE_URL: "AI_PROVIDER_SEEDANCE_BASE_URL",
  SEEDANCE_API_KEY: "AI_PROVIDER_SEEDANCE_API_KEY",
  SEEDANCE_DEFAULT_MODEL: "AI_PROVIDER_SEEDANCE_DEFAULT_MODEL",
  MINIMAX_ENABLED: "AI_PROVIDER_MINIMAX_ENABLED",
  MINIMAX_BASE_URL: "AI_PROVIDER_MINIMAX_BASE_URL",
  MINIMAX_API_KEY: "AI_PROVIDER_MINIMAX_API_KEY",
  MINIMAX_DEFAULT_MODEL: "AI_PROVIDER_MINIMAX_DEFAULT_MODEL",
  FAL_ENABLED: "AI_PROVIDER_FAL_ENABLED",
  FAL_BASE_URL: "AI_PROVIDER_FAL_BASE_URL",
  FAL_API_KEY: "AI_PROVIDER_FAL_API_KEY",
  FAL_DEFAULT_MODEL: "AI_PROVIDER_FAL_DEFAULT_MODEL",
} as const;

export const AI_PROVIDER_ENV_DEFAULTS = {
  ROUTING_MODE: "fixed" as AiProviderRoutingMode,
  DEFAULT_TEXT_PROVIDER: "openai" as AiTextProviderId,
  DEFAULT_VIDEO_PROVIDER: "seedance" as AiVideoProviderId,
  DEFAULT_UPSCALE_PROVIDER: "fal" as AiUpscaleProviderId,
  COST_TRACKING_ENABLED: true,
  USAGE_LOG_ENABLED: true,
  TIMEOUT_MS: 600_000,
  MAX_RETRIES: 3,
  OPENAI_BASE_URL: "https://api.openai.com/v1",
  OPENAI_DEFAULT_MODEL: "gpt-5.5",
  SEEDANCE_BASE_URL: "https://ark.ap-southeast.bytepluses.com",
  SEEDANCE_DEFAULT_MODEL: "dreamina-seedance-2-0-260128",
  FAL_BASE_URL: "https://queue.fal.run",
  FAL_DEFAULT_MODEL: "fal-ai/topaz/upscale/video",
} as const;

const ProviderEntrySchema = z.object({
  id: z.enum(AI_PROVIDER_IDS),
  enabled: z.boolean(),
  baseUrl: z.string().nullable(),
  apiKey: z.string().nullable(),
  defaultModel: z.string().nullable(),
});

export type AiProviderEntry = z.infer<typeof ProviderEntrySchema>;

export const AiProviderConfigSchema = z.object({
  routingMode: z.enum(AI_PROVIDER_ROUTING_MODES),
  defaults: z.object({
    text: z.enum(AI_TEXT_PROVIDER_IDS),
    video: z.enum(AI_VIDEO_PROVIDER_IDS),
    upscale: z.enum(AI_UPSCALE_PROVIDER_IDS),
  }),
  costTrackingEnabled: z.boolean(),
  usageLogEnabled: z.boolean(),
  timeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().nonnegative(),
  providers: z.object({
    openai: ProviderEntrySchema,
    seedance: ProviderEntrySchema,
    minimax: ProviderEntrySchema,
    fal: ProviderEntrySchema,
  }),
});

export type AiProviderConfig = z.infer<typeof AiProviderConfigSchema>;

/** Safe for logs / diagnostics — secrets never included. */
export type AiProviderConfigRedacted = Omit<AiProviderConfig, "providers"> & {
  providers: Record<
    AiProviderId,
    Omit<AiProviderEntry, "apiKey"> & { apiKey: "unset" | "[REDACTED]" }
  >;
};

export class AiProviderConfigError extends Error {
  readonly code = "AI_PROVIDER_CONFIG_INVALID";
  constructor(
    message: string,
    readonly details: readonly string[] = []
  ) {
    super(details.length ? `${message}: ${details.join("; ")}` : message);
    this.name = "AiProviderConfigError";
  }
}

type EnvMap = Record<string, string | undefined>;

function readRaw(env: EnvMap, key: string): string | undefined {
  const value = env[key];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readBool(env: EnvMap, key: string, fallback: boolean): boolean {
  const raw = readRaw(env, key);
  if (raw === undefined) return fallback;
  if (["1", "true", "yes", "on"].includes(raw.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(raw.toLowerCase())) return false;
  throw new AiProviderConfigError(`Invalid boolean for ${key}`, [
    `expected true/false, got "${raw}"`,
  ]);
}

function readInt(env: EnvMap, key: string, fallback: number): number {
  const raw = readRaw(env, key);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new AiProviderConfigError(`Invalid integer for ${key}`, [
      `expected integer, got "${raw}"`,
    ]);
  }
  return n;
}

function parseProviderEntry(
  env: EnvMap,
  id: AiProviderId,
  keys: {
    enabled: string;
    baseUrl: string;
    apiKey: string;
    defaultModel: string;
  },
  defaults: { baseUrl?: string; defaultModel?: string }
): AiProviderEntry {
  return {
    id,
    enabled: readBool(env, keys.enabled, false),
    baseUrl: readRaw(env, keys.baseUrl) ?? defaults.baseUrl ?? null,
    apiKey: readRaw(env, keys.apiKey) ?? null,
    defaultModel: readRaw(env, keys.defaultModel) ?? defaults.defaultModel ?? null,
  };
}

/**
 * Parse environment into a typed config object (no external I/O).
 * Does not mutate process.env.
 */
export function loadAiProviderConfigFromEnv(
  env: EnvMap = process.env
): AiProviderConfig {
  const routingModeRaw =
    readRaw(env, AI_PROVIDER_ENV_KEYS.ROUTING_MODE) ??
    AI_PROVIDER_ENV_DEFAULTS.ROUTING_MODE;
  const textDefaultRaw =
    readRaw(env, AI_PROVIDER_ENV_KEYS.DEFAULT_TEXT_PROVIDER) ??
    AI_PROVIDER_ENV_DEFAULTS.DEFAULT_TEXT_PROVIDER;
  const videoDefaultRaw =
    readRaw(env, AI_PROVIDER_ENV_KEYS.DEFAULT_VIDEO_PROVIDER) ??
    AI_PROVIDER_ENV_DEFAULTS.DEFAULT_VIDEO_PROVIDER;
  const upscaleDefaultRaw =
    readRaw(env, AI_PROVIDER_ENV_KEYS.DEFAULT_UPSCALE_PROVIDER) ??
    AI_PROVIDER_ENV_DEFAULTS.DEFAULT_UPSCALE_PROVIDER;

  const draft: AiProviderConfig = {
    routingMode: routingModeRaw as AiProviderRoutingMode,
    defaults: {
      text: textDefaultRaw as AiTextProviderId,
      video: videoDefaultRaw as AiVideoProviderId,
      upscale: upscaleDefaultRaw as AiUpscaleProviderId,
    },
    costTrackingEnabled: readBool(
      env,
      AI_PROVIDER_ENV_KEYS.COST_TRACKING_ENABLED,
      AI_PROVIDER_ENV_DEFAULTS.COST_TRACKING_ENABLED
    ),
    usageLogEnabled: readBool(
      env,
      AI_PROVIDER_ENV_KEYS.USAGE_LOG_ENABLED,
      AI_PROVIDER_ENV_DEFAULTS.USAGE_LOG_ENABLED
    ),
    timeoutMs: readInt(
      env,
      AI_PROVIDER_ENV_KEYS.TIMEOUT_MS,
      AI_PROVIDER_ENV_DEFAULTS.TIMEOUT_MS
    ),
    maxRetries: readInt(
      env,
      AI_PROVIDER_ENV_KEYS.MAX_RETRIES,
      AI_PROVIDER_ENV_DEFAULTS.MAX_RETRIES
    ),
    providers: {
      openai: parseProviderEntry(
        env,
        "openai",
        {
          enabled: AI_PROVIDER_ENV_KEYS.OPENAI_ENABLED,
          baseUrl: AI_PROVIDER_ENV_KEYS.OPENAI_BASE_URL,
          apiKey: AI_PROVIDER_ENV_KEYS.OPENAI_API_KEY,
          defaultModel: AI_PROVIDER_ENV_KEYS.OPENAI_DEFAULT_MODEL,
        },
        {
          baseUrl: AI_PROVIDER_ENV_DEFAULTS.OPENAI_BASE_URL,
          defaultModel: AI_PROVIDER_ENV_DEFAULTS.OPENAI_DEFAULT_MODEL,
        }
      ),
      seedance: parseProviderEntry(
        env,
        "seedance",
        {
          enabled: AI_PROVIDER_ENV_KEYS.SEEDANCE_ENABLED,
          baseUrl: AI_PROVIDER_ENV_KEYS.SEEDANCE_BASE_URL,
          apiKey: AI_PROVIDER_ENV_KEYS.SEEDANCE_API_KEY,
          defaultModel: AI_PROVIDER_ENV_KEYS.SEEDANCE_DEFAULT_MODEL,
        },
        {
          baseUrl: AI_PROVIDER_ENV_DEFAULTS.SEEDANCE_BASE_URL,
          defaultModel: AI_PROVIDER_ENV_DEFAULTS.SEEDANCE_DEFAULT_MODEL,
        }
      ),
      minimax: parseProviderEntry(
        env,
        "minimax",
        {
          enabled: AI_PROVIDER_ENV_KEYS.MINIMAX_ENABLED,
          baseUrl: AI_PROVIDER_ENV_KEYS.MINIMAX_BASE_URL,
          apiKey: AI_PROVIDER_ENV_KEYS.MINIMAX_API_KEY,
          defaultModel: AI_PROVIDER_ENV_KEYS.MINIMAX_DEFAULT_MODEL,
        },
        {}
      ),
      fal: parseProviderEntry(
        env,
        "fal",
        {
          enabled: AI_PROVIDER_ENV_KEYS.FAL_ENABLED,
          baseUrl: AI_PROVIDER_ENV_KEYS.FAL_BASE_URL,
          apiKey: AI_PROVIDER_ENV_KEYS.FAL_API_KEY,
          defaultModel: AI_PROVIDER_ENV_KEYS.FAL_DEFAULT_MODEL,
        },
        {
          baseUrl: AI_PROVIDER_ENV_DEFAULTS.FAL_BASE_URL,
          defaultModel: AI_PROVIDER_ENV_DEFAULTS.FAL_DEFAULT_MODEL,
        }
      ),
    },
  };

  return validateAiProviderConfig(draft);
}

/**
 * Fail-fast validation. Throws AiProviderConfigError on invalid config.
 */
export function validateAiProviderConfig(config: AiProviderConfig): AiProviderConfig {
  const issues: string[] = [];

  const schemaResult = AiProviderConfigSchema.safeParse(config);
  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      issues.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    throw new AiProviderConfigError("AI provider config schema invalid", issues);
  }

  if (!AI_PROVIDER_ROUTING_MODES.includes(config.routingMode)) {
    issues.push(
      `${AI_PROVIDER_ENV_KEYS.ROUTING_MODE} must be one of: ${AI_PROVIDER_ROUTING_MODES.join(", ")}`
    );
  }

  if (config.timeoutMs <= 0) {
    issues.push(`${AI_PROVIDER_ENV_KEYS.TIMEOUT_MS} must be a positive integer`);
  }
  if (config.maxRetries < 0) {
    issues.push(`${AI_PROVIDER_ENV_KEYS.MAX_RETRIES} must be >= 0`);
  }

  if (!AI_TEXT_PROVIDER_IDS.includes(config.defaults.text)) {
    issues.push(
      `${AI_PROVIDER_ENV_KEYS.DEFAULT_TEXT_PROVIDER} must be one of: ${AI_TEXT_PROVIDER_IDS.join(", ")}`
    );
  }
  if (!AI_VIDEO_PROVIDER_IDS.includes(config.defaults.video)) {
    issues.push(
      `${AI_PROVIDER_ENV_KEYS.DEFAULT_VIDEO_PROVIDER} must be one of: ${AI_VIDEO_PROVIDER_IDS.join(", ")}`
    );
  }
  if (!AI_UPSCALE_PROVIDER_IDS.includes(config.defaults.upscale)) {
    issues.push(
      `${AI_PROVIDER_ENV_KEYS.DEFAULT_UPSCALE_PROVIDER} must be one of: ${AI_UPSCALE_PROVIDER_IDS.join(", ")}`
    );
  }

  for (const entry of Object.values(config.providers)) {
    if (!entry.enabled) continue;
    if (!entry.apiKey) {
      issues.push(`${entry.id}: API key is required when enabled`);
    }
    if (!entry.baseUrl) {
      issues.push(`${entry.id}: base URL is required when enabled`);
    } else if (!looksLikeHttpUrl(entry.baseUrl)) {
      issues.push(`${entry.id}: base URL must be an absolute http(s) URL`);
    }
    if (!entry.defaultModel) {
      issues.push(`${entry.id}: default model is required when enabled`);
    }
  }

  if (issues.length > 0) {
    throw new AiProviderConfigError("AI provider config validation failed", issues);
  }

  return schemaResult.data;
}

function looksLikeHttpUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Redact secrets for logging — never print API keys. */
export function redactAiProviderConfig(config: AiProviderConfig): AiProviderConfigRedacted {
  const redactEntry = (
    entry: AiProviderEntry
  ): AiProviderConfigRedacted["providers"][AiProviderId] => ({
    id: entry.id,
    enabled: entry.enabled,
    baseUrl: entry.baseUrl,
    defaultModel: entry.defaultModel,
    apiKey: entry.apiKey ? "[REDACTED]" : "unset",
  });

  return {
    routingMode: config.routingMode,
    defaults: { ...config.defaults },
    costTrackingEnabled: config.costTrackingEnabled,
    usageLogEnabled: config.usageLogEnabled,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    providers: {
      openai: redactEntry(config.providers.openai),
      seedance: redactEntry(config.providers.seedance),
      minimax: redactEntry(config.providers.minimax),
      fal: redactEntry(config.providers.fal),
    },
  };
}

let cachedConfig: AiProviderConfig | null = null;

/**
 * Startup fail-fast accessor. Loads once from process.env unless reset.
 * Call resetAiProviderConfigCache() in tests.
 */
export function getAiProviderConfig(env: EnvMap = process.env): AiProviderConfig {
  if (cachedConfig && env === process.env) return cachedConfig;
  const loaded = loadAiProviderConfigFromEnv(env);
  if (env === process.env) cachedConfig = loaded;
  return loaded;
}

export function resetAiProviderConfigCache(): void {
  cachedConfig = null;
}

/** True when a provider is enabled and fully configured (post-validation). */
export function isAiProviderReady(
  config: AiProviderConfig,
  id: AiProviderId
): boolean {
  const entry = config.providers[id];
  return Boolean(
    entry.enabled && entry.apiKey && entry.baseUrl && entry.defaultModel
  );
}
