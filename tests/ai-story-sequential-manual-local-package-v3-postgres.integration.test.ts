import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertIsolatedTestDatabase,
  getIntegrationDbUrl,
  RUN_DB_INTEGRATION,
} from "./helpers/db-integration";

if (process.env.CI === "true" && (!RUN_DB_INTEGRATION || !getIntegrationDbUrl())) {
  throw new Error("SEQUENTIAL_LOCAL_V3_POSTGRES_REQUIRED_IN_CI");
}

const suite = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

suite("Sequential Manual Local V3 PostgreSQL syntax", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "packages/db/sql/ai-story-sequential-manual-local-package-v3.sql",
    ),
    "utf8",
  );
  const databaseUrl = getIntegrationDbUrl();
  const sql = databaseUrl ? postgres(databaseUrl, { max: 1, prepare: false }) : null;

  beforeAll(() => {
    if (!databaseUrl || !sql) throw new Error("POSTGRES_REQUIRED");
    assertIsolatedTestDatabase(databaseUrl);
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("parses the exact declared and referenced Runtime Authorization alias", async () => {
    if (!sql) throw new Error("POSTGRES_REQUIRED");
    const declaration = source.match(
      /JOIN\s+ai_story_runtime_authorized_facts\s+("[^"]+"|[a-z_][a-z0-9_]*)/i,
    )?.[1];
    const reference = source.match(
      /AND\s+("[^"]+"|[a-z_][a-z0-9_]*)\.execution_plan_id\s*=\s*release\.execution_plan_id/i,
    )?.[1];
    expect(declaration).toBeDefined();
    expect(reference).toBe(declaration);

    const safeIdentifier = /^"[a-z_][a-z0-9_]*"$|^[a-z_][a-z0-9_]*$/i;
    if (!declaration || !reference
      || !safeIdentifier.test(declaration) || !safeIdentifier.test(reference)) {
      throw new Error("RUNTIME_AUTHORIZATION_ALIAS_NOT_SAFE");
    }

    const [row] = await sql.unsafe<{ execution_plan_id: number }[]>(
      `SELECT ${reference}.execution_plan_id
       FROM (VALUES (1)) AS ${declaration}(execution_plan_id)`,
    );
    expect(row?.execution_plan_id).toBe(1);
  });
});
