import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string | number> = {
    web: "ok",
  };

  const dbUrl = process.env.DATABASE_URL?.trim();
  const redisUrl = process.env.REDIS_URL?.trim();

  checks.supabase = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ? "configured" : "missing";
  checks.database = dbUrl ? "configured" : "missing";
  checks.redis = redisUrl ? "configured" : "missing";

  // Queue depth — non-fatal: if Redis is unreachable we still return 200 for web health
  const queue: Record<string, number | string> = {};
  if (redisUrl) {
    try {
      const { getRenderQueueCounts, agentQueue } = await import("@ceo-agent/queue");
      const [renderCounts, agentCounts] = await Promise.all([
        getRenderQueueCounts(),
        agentQueue().getJobCounts("waiting", "active", "delayed", "failed"),
      ]);
      queue.render_waiting = renderCounts.waiting ?? 0;
      queue.render_active = renderCounts.active ?? 0;
      queue.render_failed = renderCounts.failed ?? 0;
      queue.agent_waiting = agentCounts.waiting ?? 0;
      queue.agent_active = agentCounts.active ?? 0;
    } catch {
      queue.error = "unreachable";
    }
  }

  const ready =
    checks.supabase === "configured" &&
    checks.database === "configured" &&
    checks.redis === "configured";

  return NextResponse.json(
    {
      ok: ready,
      service: "emberos-web",
      version: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
      checks,
      queue,
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 }
  );
}
