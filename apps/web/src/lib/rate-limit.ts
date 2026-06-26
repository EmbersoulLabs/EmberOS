import {
  API_RATE_LIMITS,
  checkMemoryRateLimit,
  type ApiRateLimitScope,
  type RateLimitResult,
} from "@ceo-agent/shared";
import { apiError } from "@/lib/api";

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

let redisClient: import("ioredis").default | null = null;
let redisInitFailed = false;

async function getRedis(): Promise<import("ioredis").default | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url || redisInitFailed) return null;
  if (redisClient) return redisClient;

  try {
    const { default: Redis } = await import("ioredis");
    redisClient = new Redis(url, {
      connectTimeout: 5_000,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    await redisClient.connect();
    return redisClient;
  } catch {
    redisInitFailed = true;
    return null;
  }
}

async function checkRedisRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult | null> {
  const redis = await getRedis();
  if (!redis) return null;

  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  const windowId = Math.floor(Date.now() / windowMs);
  const redisKey = `ratelimit:${key}:${windowId}`;

  try {
    const count = await redis.incr(redisKey);
    if (count === 1) await redis.expire(redisKey, windowSec);
    if (count > limit) {
      const ttl = await redis.ttl(redisKey);
      return {
        allowed: false,
        retryAfterSec: Math.max(1, ttl > 0 ? ttl : windowSec),
      };
    }
    return { allowed: true };
  } catch {
    return null;
  }
}

export async function checkRateLimit(
  scope: ApiRateLimitScope,
  subject: string
): Promise<RateLimitResult> {
  const { limit, windowMs } = API_RATE_LIMITS[scope];
  const key = `${scope}:${subject}`;

  const redisResult = await checkRedisRateLimit(key, limit, windowMs);
  if (redisResult) return redisResult;

  return checkMemoryRateLimit(memoryBuckets, key, limit, windowMs);
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

/** Returns a 429 response when limited, otherwise null. */
export async function enforceRateLimit(
  request: Request,
  scope: ApiRateLimitScope,
  subject: string
): Promise<Response | null> {
  const result = await checkRateLimit(scope, subject);
  if (!result.allowed) {
    return apiError(
      `Rate limit exceeded. Retry in ${result.retryAfterSec}s`,
      "RATE_LIMIT",
      429
    );
  }
  return null;
}
