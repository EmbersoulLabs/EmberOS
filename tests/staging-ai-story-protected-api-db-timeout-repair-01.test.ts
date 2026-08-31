import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  DatabaseDependencyTimeoutError,
  closeDb,
  getDb,
  withDbDeadline,
} from "../packages/db/src/client";
import { handleApiError } from "../apps/web/src/lib/auth";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("Staging protected API database dependency deadline", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalVercel = process.env.VERCEL;

  afterEach(async () => {
    await closeDb();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  });

  it("bounds a pool-queued operation and discards the occupied client", async () => {
    process.env.DATABASE_URL = "postgres://user:password@127.0.0.1:5432/test";
    process.env.VERCEL = "1";

    await expect(withDbDeadline(
      getDb(),
      async () => await new Promise<never>(() => undefined),
      15,
    )).rejects.toMatchObject({
      name: "DatabaseDependencyTimeoutError",
      code: "DATABASE_DEPENDENCY_TIMEOUT",
      timeoutMs: 15,
    });

    await expect(withDbDeadline(getDb(), async () => "fresh-client", 50))
      .resolves.toBe("fresh-client");
  });

  it("bounds the three concurrent protected read chains and query return", () => {
    const client = read("packages/db/src/client.ts");
    expect(client).toContain("SERVERLESS_DB_MAX_CONNECTIONS = 3");
    expect(client).toContain("isServerless ? SERVERLESS_DB_MAX_CONNECTIONS : 10");
    expect(client).toContain("connect_timeout: connectTimeout");
    expect(client).toContain("SERVERLESS_DB_OPERATION_TIMEOUT_MS = 12_000");
    expect(client).toContain("await staleClient.end({ timeout: 0 })");
    expect(client).toContain("Promise.race([operation(database), deadline])");
  });

  it("applies the bounded dependency chain to every certified protected GET", () => {
    const routes = [
      "apps/web/src/app/api/me/route.ts",
      "apps/web/src/app/api/workspaces/route.ts",
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/route.ts",
      "apps/web/src/app/api/campaigns/[id]/characters/route.ts",
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/supporting-cast/route.ts",
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/runtime/route.ts",
    ];
    for (const route of routes) {
      expect(read(route), route).toContain("withDbDeadline");
    }
  });

  it("keeps the runtime projection fan-out within the three-connection Web pool", () => {
    const projection = read("packages/agents/src/ai-story/derive-product-runtime-projection.ts");
    expect(projection).toContain("const [review, assembly, compactAuthorities]");
    expect(projection).toContain("const authFact = await observe");
    expect(projection).toContain("const fsr = await observe");
    expect(projection).toContain("const compilation = await observe");
    expect(projection).not.toContain("const [review, assembly, authFact, fsr, compilation]");
  });

  it("maps dependency timeout to bounded JSON HTTP 503 handling", async () => {
    expect(new DatabaseDependencyTimeoutError(12_000).code)
      .toBe("DATABASE_DEPENDENCY_TIMEOUT");
    expect(read("apps/web/src/lib/auth.ts"))
      .toContain("DATABASE_DEPENDENCY_TIMEOUT: 503");
    const response = handleApiError(new DatabaseDependencyTimeoutError(12_000));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Database dependency did not complete within 12000ms",
      code: "DATABASE_DEPENDENCY_TIMEOUT",
    });
  });
});
