import Redis from "ioredis";
import {
  ProviderExecutorAuthoritySchema,
  type ProviderExecutorAuthority,
} from "@ceo-agent/shared";

const AUTHORITY_KEY_VERSION = "v1";
export const PROVIDER_EXECUTOR_AUTHORITY_TTL_SECONDS = 30;

let redisClient: Redis | null = null;

function getRedis(): Redis {
  if (!redisClient) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    redisClient = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    redisClient.on("error", (error: unknown) => {
      console.warn(
        "[provider-executor-authority] Redis unavailable:",
        error instanceof Error ? error.message : "unknown error"
      );
    });
  }
  return redisClient;
}

async function connectedRedis(): Promise<Redis> {
  const client = getRedis();
  if (client.status === "wait") await client.connect();
  return client;
}

function normalizeEnvironment(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "local";
  if (normalized === "main" || normalized === "production") return "production";
  if (normalized === "staging") return "staging";
  return normalized.replace(/[^a-z0-9_-]/g, "-");
}

/** Resolve the shared deployment boundary without reading any secret value. */
export function resolveProviderExecutorEnvironment(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string {
  return normalizeEnvironment(
    env.AI_PROVIDER_EXECUTOR_ENVIRONMENT ??
      env.RAILWAY_ENVIRONMENT_NAME ??
      env.VERCEL_GIT_COMMIT_REF ??
      env.VERCEL_ENV ??
      env.NODE_ENV
  );
}

export function providerExecutorAuthorityKey(environment: string): string {
  return `emberos:provider-executor-authority:${AUTHORITY_KEY_VERSION}:${normalizeEnvironment(environment)}`;
}

export async function publishProviderExecutorAuthority(
  input: ProviderExecutorAuthority
): Promise<void> {
  const authority = ProviderExecutorAuthoritySchema.parse(input);
  const ttl = Math.max(
    1,
    Math.min(
      PROVIDER_EXECUTOR_AUTHORITY_TTL_SECONDS,
      Math.ceil((Date.parse(authority.expiresAt) - Date.now()) / 1_000)
    )
  );
  const redis = await connectedRedis();
  await redis.set(
    providerExecutorAuthorityKey(authority.environment),
    JSON.stringify(authority),
    "EX",
    ttl
  );
}

export async function readProviderExecutorAuthority(
  environment = resolveProviderExecutorEnvironment()
): Promise<ProviderExecutorAuthority | null> {
  try {
    const redis = await connectedRedis();
    const raw = await redis.get(providerExecutorAuthorityKey(environment));
    if (!raw) return null;
    const authority = ProviderExecutorAuthoritySchema.parse(JSON.parse(raw));
    if (
      normalizeEnvironment(authority.environment) !== normalizeEnvironment(environment) ||
      Date.parse(authority.expiresAt) <= Date.now()
    ) {
      return null;
    }
    return authority;
  } catch {
    return null;
  }
}

export async function closeProviderExecutorAuthorityTransport(): Promise<void> {
  const client = redisClient;
  redisClient = null;
  if (client) await client.quit().catch(() => undefined);
}
