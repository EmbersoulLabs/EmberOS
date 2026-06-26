export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSec: number };

export type RateLimitBucket = { count: number; resetAt: number };

/** Fixed-window in-memory limiter (fallback when Redis unavailable). */
export function checkMemoryRateLimit(
  buckets: Map<string, RateLimitBucket>,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { allowed: true };
}

/** Per-route HTTP rate limits (requests per window). */
export const API_RATE_LIMITS = {
  campaignRun: { limit: 10, windowMs: 60_000 },
  uploadUrl: { limit: 30, windowMs: 60_000 },
  export: { limit: 20, windowMs: 60_000 },
  portalDecide: { limit: 15, windowMs: 60_000 },
} as const;

export type ApiRateLimitScope = keyof typeof API_RATE_LIMITS;
