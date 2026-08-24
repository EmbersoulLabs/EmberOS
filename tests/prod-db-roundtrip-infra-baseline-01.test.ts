import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "apps/web/src/app/api/admin/internal/db-roundtrip-baseline/route.ts",
  "utf8"
).replace(/\r\n/g, "\n");
const clientSource = readFileSync("packages/db/src/client.ts", "utf8").replace(/\r\n/g, "\n");
const pageSource = readFileSync(
  "apps/web/src/app/diagnostics/db-roundtrip-baseline/page.tsx",
  "utf8"
).replace(/\r\n/g, "\n");

describe("production DB round-trip infrastructure baseline", () => {
  it("keeps the diagnostic surface authenticated and read-only", () => {
    expect(source).toContain("await requireAuth()");
    expect(source).toContain('X-EmberOS-Diagnostic-Guard", "authenticated"');
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(source).not.toContain("DATABASE_URL:");
    expect(source).not.toContain("parsed.password");
  });

  it("implements the exact bounded baseline query shapes", () => {
    expect(source).toContain("select 1 as value");
    expect(source).toContain("select 1 as value_1, 1 as value_2, 1 as value_3");
    expect(source).toContain("for (let index = 0; index < 5; index += 1)");
    expect(source).toContain("select({ id: schema.aiStoryExecutionPlans.id })");
    expect(source).toContain("R3_EXECUTION_PLAN_ID");
  });

  it("reports unavailable driver phase separation without fabricating metrics", () => {
    expect(source).toContain("poolAcquireSeparatelyObservable: false");
    expect(source).toContain("dbServerExecutionSeparatelyObservable: false");
    expect(source).toContain("networkReturnSeparatelyObservable: false");
  });

  it("retains one module-scoped postgres-js pool with serverless max one", () => {
    expect(clientSource).toContain("let client: ReturnType<typeof postgres> | null = null");
    expect(clientSource).toContain("let db: ReturnType<typeof drizzle<typeof schema>> | null = null");
    expect(clientSource).toContain("isServerless ? 1 : 10");
    expect(clientSource).toContain("idle_timeout: 20");
    expect(clientSource).toContain("connect_timeout: connectTimeout");
  });

  it("exposes results only through an unlinked authenticated page wrapper", () => {
    expect(pageSource).toContain("runDbRoundtripBaseline(request)");
    expect(pageSource).toContain('export const dynamic = "force-dynamic"');
    expect(pageSource).not.toContain("fetch(");
  });
});
