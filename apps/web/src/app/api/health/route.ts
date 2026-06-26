import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = {
    web: "ok",
  };

  const dbUrl = process.env.DATABASE_URL?.trim();
  const redisUrl = process.env.REDIS_URL?.trim();

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    checks.supabase = "missing";
  } else {
    checks.supabase = "configured";
  }

  checks.database = dbUrl ? "configured" : "missing";
  checks.redis = redisUrl ? "configured" : "missing";

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
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 }
  );
}
