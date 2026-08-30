import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { requireAuth, AuthError } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const R3_EXECUTION_PLAN_ID = "8831afe0-e22b-561e-ba8a-9087996a9113";
const moduleBootEpochMs = Date.now();
const instanceId = randomUUID();
let invocationCount = 0;

type DiagnosticMode = "no-db" | "select1" | "pk" | "five" | "one-five";

function connectionMetadata() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) return { configured: false } as const;
  const parsed = new URL(value);
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port || "5432";
  const sharedPooler = host.endsWith(".pooler.supabase.com");
  const dedicatedPooler = host.startsWith("db.") && port === "6543";
  const regionMatch = host.match(/^aws-\d+-([a-z0-9-]+)\.pooler\.supabase\.com$/);
  return {
    configured: true,
    mode: sharedPooler
      ? port === "6543" ? "TRANSACTION_POOLER" : "SESSION_POOLER"
      : dedicatedPooler ? "TRANSACTION_POOLER" : "DIRECT",
    provider: sharedPooler ? "SUPAVISOR_SHARED" : dedicatedPooler ? "PGBOUNCER_DEDICATED" : "POSTGRES_DIRECT",
    providerRegionId: regionMatch?.[1] ?? null,
    sslEnabled: parsed.searchParams.get("sslmode") !== "disable",
    port,
  } as const;
}

function percentile95Approx(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

export async function GET(request: NextRequest) {
  const functionEntry = performance.now();
  const ordinal = ++invocationCount;
  try {
    const authStarted = performance.now();
    await requireAuth();
    const authEnded = performance.now();
    const mode = request.nextUrl.searchParams.get("mode") as DiagnosticMode | null;
    if (!mode || !["no-db", "select1", "pk", "five", "one-five"].includes(mode)) {
      return NextResponse.json({ error: "Invalid diagnostic mode" }, { status: 400 });
    }

    const dbCallStarted = performance.now();
    let queryValuesMs: number[] = [];
    let rowCount = 0;
    let queryCount = 0;
    let getDbSyncMs = 0;

    if (mode !== "no-db") {
      const getDbStarted = performance.now();
      const db = getDb();
      getDbSyncMs = performance.now() - getDbStarted;
      const measure = async (operation: () => Promise<unknown>) => {
        const startedAt = performance.now();
        const result = await operation();
        queryValuesMs.push(performance.now() - startedAt);
        queryCount += 1;
        return result;
      };
      if (mode === "select1") {
        const result = await measure(() => db.execute(sql`select 1 as value`));
        rowCount = Array.isArray(result) ? result.length : 1;
      } else if (mode === "pk") {
        const result = await measure(() => db
          .select({ id: schema.aiStoryExecutionPlans.id })
          .from(schema.aiStoryExecutionPlans)
          .where(eq(schema.aiStoryExecutionPlans.id, R3_EXECUTION_PLAN_ID))
          .limit(1));
        rowCount = Array.isArray(result) ? result.length : 0;
      } else if (mode === "five") {
        for (let index = 0; index < 5; index += 1) {
          await measure(() => db.execute(sql`select 1 as value`));
        }
        rowCount = 5;
      } else {
        const result = await measure(() => db.execute(sql`
          select 1 as value_1, 1 as value_2, 1 as value_3,
            1 as value_4, 1 as value_5
        `));
        rowCount = Array.isArray(result) ? result.length : 1;
      }
    }

    const dbCallEnded = performance.now();
    const responseReady = performance.now();
    const response = NextResponse.json({
      diagnostic: "db-roundtrip-infra-baseline.v1",
      mode,
      releaseRevision: process.env.EMBEROS_RELEASE_REVISION?.trim() || process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "UNSET",
      runtimeRegion: process.env.VERCEL_REGION?.trim() || null,
      runtime: "nodejs-serverless",
      instanceId,
      invocationOrdinal: ordinal,
      moduleAgeMs: Date.now() - moduleBootEpochMs,
      connection: connectionMetadata(),
      pool: {
        implementation: "postgres-js",
        max: process.env.VERCEL === "1" ? 1 : 10,
        idleTimeoutSeconds: 20,
        connectionTimeoutSeconds: 15,
        operationDeadlineSeconds: 12,
        serverStatementTimeoutAuthority: "SUPAVISOR",
        moduleScoped: true,
      },
      timings: {
        authMs: Number((authEnded - authStarted).toFixed(3)),
        functionToDbCallStartMs: Number((dbCallStarted - functionEntry).toFixed(3)),
        getDbSyncMs: Number(getDbSyncMs.toFixed(3)),
        queryValuesMs: queryValuesMs.map((value) => Number(value.toFixed(3))),
        dbCallWallMs: Number((dbCallEnded - dbCallStarted).toFixed(3)),
        responseReadyMs: Number((responseReady - functionEntry).toFixed(3)),
        queryMedianMs: queryValuesMs.length
          ? Number([...queryValuesMs].sort((a, b) => a - b)[Math.floor(queryValuesMs.length / 2)]!.toFixed(3))
          : 0,
        queryP95ApproxMs: Number(percentile95Approx(queryValuesMs).toFixed(3)),
      },
      queryCount,
      rowCount,
      observability: {
        poolAcquireSeparatelyObservable: false,
        poolAcquireBoundedByOperationDeadline: true,
        dbServerExecutionSeparatelyObservable: false,
        networkReturnSeparatelyObservable: false,
      },
    });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("X-EmberOS-Diagnostic-Guard", "authenticated");
    return response;
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Diagnostic unavailable" }, { status: 500 });
  }
}
