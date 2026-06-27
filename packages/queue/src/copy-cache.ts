import { createClient } from "redis";
import type { CopyVariant } from "@ceo-agent/shared";

const CACHE_TTL_SEC = 60 * 60 * 24; // 24 h
const CACHE_VERSION = "v1";

let redisClient: ReturnType<typeof createClient> | null = null;

async function getRedis() {
  if (!redisClient) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    redisClient = createClient({ url });
    redisClient.on("error", (err: unknown) => {
      console.warn("[copy-cache] Redis error:", err);
    });
    await redisClient.connect();
  }
  return redisClient;
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(16).padStart(8, "0");
}

export function copyCacheKey(params: {
  campaignId: string;
  platforms: string[];
  brief: string;
}): string {
  const hash = simpleHash(params.brief);
  const plat = [...params.platforms].sort().join(",");
  return `copy:${CACHE_VERSION}:${params.campaignId}:${plat}:${hash}`;
}

export async function getCopyCache(key: string): Promise<CopyVariant[] | null> {
  try {
    const redis = await getRedis();
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as CopyVariant[];
  } catch {
    return null;
  }
}

export async function setCopyCache(key: string, variants: CopyVariant[]): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.set(key, JSON.stringify(variants), { EX: CACHE_TTL_SEC });
  } catch {
    // cache miss on write is acceptable
  }
}
