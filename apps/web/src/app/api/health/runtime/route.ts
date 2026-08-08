import { NextResponse } from "next/server";
import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import {
  getBullmqPrefix,
  getRenderQueueCounts,
  agentQueue,
  assetAnalysisQueue,
} from "@ceo-agent/queue";
import { getDb } from "@ceo-agent/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

function heartbeatKey() {
  const prefix = getBullmqPrefix();
  return `${prefix ? `${prefix}:` : ""}emberos:worker:heartbeat`;
}

export async function GET() {
  // This route is used as a strict local/E2E readiness gate. Production only
  // exposes process liveness; it must not exercise or describe privileged
  // dependencies to unauthenticated callers.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: true, service: "emberos-web" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const checks: Record<string, string> = { web: "ok" };
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const redisUrl = process.env.REDIS_URL?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "campaign-assets";

  if (!databaseUrl || !redisUrl || !supabaseUrl || !serviceRole) {
    return NextResponse.json({ ok: false, checks, error: "Required runtime environment is incomplete" }, { status: 503 });
  }

  const db = getDb();
  const redis = new Redis(redisUrl, { connectTimeout: 10_000, maxRetriesPerRequest: 1 });
  try {
    await db.execute(sql`select 1`);
    checks.database = "ok";
    await redis.ping();
    checks.redis = "ok";
    const heartbeat = await redis.get(heartbeatKey());
    checks.worker = heartbeat ? "ok" : "missing";
    let workerCapabilities: string[] = [];
    if (heartbeat) {
      try {
        const parsed = JSON.parse(heartbeat) as { capabilities?: unknown };
        workerCapabilities = Array.isArray(parsed.capabilities)
          ? parsed.capabilities.filter((item): item is string => typeof item === "string")
          : [];
      } catch {
        workerCapabilities = [];
      }
    }

    const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    const { data: buckets, error: storageError } = await supabase.storage.listBuckets();
    if (storageError) throw new Error(`Storage: ${storageError.message}`);
    checks.supabase = "ok";
    checks.storage = buckets.some((item) => item.name === bucket) ? "ok" : `missing bucket ${bucket}`;

    await Promise.all([
      getRenderQueueCounts(),
      agentQueue().getJobCounts("waiting", "active", "delayed", "failed"),
      assetAnalysisQueue().getJobCounts("waiting", "active", "delayed", "failed"),
    ]);
    checks.queue = "ok";
    checks.assetAnalysisConsumer = workerCapabilities.includes("asset-analysis")
      ? "ok"
      : "missing";
  } catch (error) {
    checks.error = error instanceof Error ? error.message : "Runtime dependency failed";
  } finally {
    redis.disconnect();
  }

  const ok = ["database", "redis", "worker", "supabase", "storage", "queue", "assetAnalysisConsumer"].every((key) => checks[key] === "ok");
  return NextResponse.json({ ok, service: "emberos-local-runtime", checks, timestamp: new Date().toISOString() }, { status: ok ? 200 : 503 });
}
