import Redis from "ioredis";
import { getBullmqPrefix } from "@ceo-agent/queue";

const HEARTBEAT_TTL_SECONDS = 15;
const HEARTBEAT_INTERVAL_MS = 5_000;

export function workerHeartbeatKey(): string {
  const prefix = getBullmqPrefix();
  return `${prefix ? `${prefix}:` : ""}emberos:worker:heartbeat`;
}

export async function startRuntimeHeartbeat(): Promise<() => Promise<void>> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) throw new Error("REDIS_URL is required for the worker runtime");

  const redis = new Redis(redisUrl, { connectTimeout: 10_000, maxRetriesPerRequest: 1 });
  await redis.ping();
  const key = workerHeartbeatKey();
  const write = () => redis.set(key, JSON.stringify({ pid: process.pid, at: Date.now() }), "EX", HEARTBEAT_TTL_SECONDS);
  await write();
  const timer = setInterval(() => void write().catch((error) => {
    console.error("[worker] heartbeat failed:", error instanceof Error ? error.message : error);
  }), HEARTBEAT_INTERVAL_MS);
  timer.unref();
  console.log(`[worker] runtime heartbeat ready key=${key}`);

  return async () => {
    clearInterval(timer);
    await redis.del(key).catch(() => 0);
    redis.disconnect();
  };
}
