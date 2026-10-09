import {
  LOCAL_GPU_BASE_URL,
  LOCAL_GPU_DEFAULT_AGENCY_ENABLED,
  LocalGpuEnvironmentSchema,
  type LocalGpuEnvironment,
} from "@ceo-agent/shared";

export type LocalGpuConfig = {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly environment: LocalGpuEnvironment | null;
  readonly agencyEnabled: boolean;
  readonly signingSecret: string | null;
};

export type LocalGpuConfigRedacted = Omit<LocalGpuConfig, "signingSecret"> & {
  readonly signingSecret: "unset" | "[REDACTED]";
};

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
  throw new Error(`LOCAL_GPU_CONFIG_INVALID:${key}`);
}

export function loadLocalGpuConfigFromEnv(env: EnvMap = process.env): LocalGpuConfig {
  const enabled = readBool(env, "LOCAL_GPU_PROVIDER_ENABLED", false);
  const agencyEnabled = readBool(env, "AGENCY_LOCAL_GPU_ENABLED", LOCAL_GPU_DEFAULT_AGENCY_ENABLED);
  const baseUrl = (readRaw(env, "LOCAL_GPU_BASE_URL") ?? LOCAL_GPU_BASE_URL).replace(/\/+$/, "");
  const environmentRaw = readRaw(env, "LOCAL_GPU_ENVIRONMENT");
  const signingSecret = readRaw(env, "LOCAL_GPU_SIGNING_SECRET") ?? null;
  if (!enabled) {
    return {
      enabled,
      baseUrl,
      environment: environmentRaw ? LocalGpuEnvironmentSchema.parse(environmentRaw) : null,
      agencyEnabled,
      signingSecret,
    };
  }
  if (!environmentRaw) throw new Error("LOCAL_GPU_ENVIRONMENT_REQUIRED");
  if (!signingSecret) throw new Error("LOCAL_GPU_SIGNING_SECRET_REQUIRED");
  return {
    enabled,
    baseUrl,
    environment: LocalGpuEnvironmentSchema.parse(environmentRaw),
    agencyEnabled,
    signingSecret,
  };
}

export function redactLocalGpuConfig(config: LocalGpuConfig): LocalGpuConfigRedacted {
  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    environment: config.environment,
    agencyEnabled: config.agencyEnabled,
    signingSecret: config.signingSecret ? "[REDACTED]" : "unset",
  };
}
