import { LOCAL_GPU_BASE_URL, LOCAL_GPU_DEFAULT_AGENCY_ENABLED, LocalGpuEnvironmentSchema, type LocalGpuEnvironment } from "@ceo-agent/shared/server";

export type LocalGpuConfig = {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly environment: LocalGpuEnvironment | null;
  readonly agencyEnabled: boolean;
  readonly signingSecret: string | null;
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

export function loadLocalGpuConfigFromEnv(env: EnvMap = {}): LocalGpuConfig {
  const enabled = readBool(env, "LOCAL_GPU_PROVIDER_ENABLED", false);
  if (readBool(env, "AGENCY_LOCAL_GPU_ENABLED", LOCAL_GPU_DEFAULT_AGENCY_ENABLED)) {
    throw new Error("LOCAL_GPU_AGENCY_DISABLED");
  }
  const baseUrl = (readRaw(env, "LOCAL_GPU_BASE_URL") ?? LOCAL_GPU_BASE_URL).replace(/\/+$/, "");
  const environmentRaw = readRaw(env, "LOCAL_GPU_ENVIRONMENT");
  const signingSecret = readRaw(env, "LOCAL_GPU_SIGNING_SECRET") ?? null;
  if (!enabled) {
    return {
      enabled: false,
      baseUrl,
      environment: environmentRaw ? LocalGpuEnvironmentSchema.parse(environmentRaw) : null,
      agencyEnabled: false,
      signingSecret: null,
    };
  }
  if (!environmentRaw) throw new Error("LOCAL_GPU_ENVIRONMENT_REQUIRED");
  if (!signingSecret) throw new Error("LOCAL_GPU_SIGNING_SECRET_REQUIRED");
  return {
    enabled: true,
    baseUrl,
    environment: LocalGpuEnvironmentSchema.parse(environmentRaw),
    agencyEnabled: false,
    signingSecret,
  };
}

export function redactLocalGpuConfig(config: LocalGpuConfig): { enabled: boolean; baseUrl: string; environment: LocalGpuEnvironment | null; agencyEnabled: boolean; signingSecret: "unset" | "[REDACTED]" } {
  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    environment: config.environment,
    agencyEnabled: config.agencyEnabled,
    signingSecret: config.signingSecret ? "[REDACTED]" : "unset",
  };
}
