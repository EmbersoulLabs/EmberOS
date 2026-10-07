import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RUN_DB_INTEGRATION, assertIsolatedTestDatabase, getIntegrationDbUrl } from "./helpers/db-integration";

const migration = readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-episode-projected-authority-contract-v1.sql"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "docs/releases/ai-story-v1-production-migration-manifest.json"), "utf8"));

describe("episode projected contract migration", () => {
  it("whitelists authored and projected versions without rewriting historical SQL", () => {
    expect(migration).toContain("'ai-story-director-plan.v1'");
    expect(migration).toContain("'ai-story-director-plan.episode-projected.v1'");
    expect(migration).toContain("'ai-story-motion-plan.v1'");
    expect(migration).toContain("'ai-story-motion-plan.episode-projected.v1'");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS ai_story_director_plan_contract_check");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS ai_story_director_plan_versions_contract_version_check");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS ai_story_motion_plan_contract_check");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS ai_story_motion_plan_versions_contract_version_check");
    expect(migration).not.toMatch(/\bUPDATE\b|\bDELETE\s+FROM\b|\bDROP\s+TABLE\b/i);
    expect(readFileSync("packages/db/sql/ai-story-director-plan-v1.sql", "utf8")).toContain("contract_version='ai-story-director-plan.v1'");
    expect(readFileSync("packages/db/sql/ai-story-motion-plan-v1.sql", "utf8")).toContain("contract_version='ai-story-motion-plan.v1'");
    const entry = manifest.entries.find((item: { file: string }) => item.file === "packages/db/sql/ai-story-episode-projected-authority-contract-v1.sql");
    if (!entry) throw new Error("EPISODE_PROJECTED_MANIFEST_ENTRY_REQUIRED");
    expect(entry.order).toBe(25);
    expect(createHash("sha256").update(migration.replace(/\r\n/g, "\n")).digest("hex")).toBe(entry.sha256);
  });
});

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

describeIntegration("episode projected contract migration on postgres", () => {
  let admin: ReturnType<typeof postgres>;
  let sql: ReturnType<typeof postgres>;
  let databaseName = "";

  beforeAll(async () => {
    const urlValue = getIntegrationDbUrl();
    if (!urlValue) throw new Error("ISOLATED_POSTGRES_REQUIRED");
    assertIsolatedTestDatabase(urlValue);
    const url = new URL(urlValue);
    if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("LOCAL_POSTGRES_REQUIRED");
    databaseName = `emberos_projected_${randomUUID().replaceAll("-", "")}_test`;
    admin = postgres(urlValue, { max: 1, prepare: false });
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    url.pathname = `/${databaseName}`;
    sql = postgres(url.toString(), { max: 1, prepare: false });
  });

  afterAll(async () => {
    await sql?.end();
    if (admin && databaseName) await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin?.end();
  });

  it("converges duplicate historical checks and preserves authored rows", async () => {
    await sql.unsafe(`create table ai_story_director_plan_versions (director_plan_id uuid primary key, contract_version text not null, director_plan jsonb not null)`);
    await sql.unsafe(`alter table ai_story_director_plan_versions add constraint ai_story_director_plan_contract_check check (contract_version = 'ai-story-director-plan.v1')`);
    await sql.unsafe(`alter table ai_story_director_plan_versions add constraint ai_story_director_plan_versions_contract_version_check check (contract_version = 'ai-story-director-plan.v1')`);
    await sql.unsafe(`create table ai_story_motion_plan_versions (motion_plan_id uuid primary key, contract_version text not null, motion_plan jsonb not null)`);
    await sql.unsafe(`alter table ai_story_motion_plan_versions add constraint ai_story_motion_plan_contract_check check (contract_version = 'ai-story-motion-plan.v1')`);
    const directorId = "99999999-9999-4999-8999-999999999999";
    await sql`insert into ai_story_director_plan_versions values (${directorId}::uuid, 'ai-story-director-plan.v1', '{"contractVersion":"ai-story-director-plan.v1"}'::jsonb)`;
    const before = await sql`select contract_version, director_plan::text as director_plan from ai_story_director_plan_versions`;
    await sql.unsafe(migration);
    const after = await sql`select contract_version, director_plan::text as director_plan from ai_story_director_plan_versions`;
    expect(after).toEqual(before);
    const checks = await sql`select c.relname as table_name, k.conname from pg_constraint k join pg_class c on c.oid = k.conrelid where c.relname in ('ai_story_director_plan_versions','ai_story_motion_plan_versions') and pg_get_constraintdef(k.oid) like '%contract_version%' order by 1, 2`;
    expect(checks.map((row) => `${row.table_name}:${row.conname}`)).toEqual([
      "ai_story_director_plan_versions:ai_story_director_plan_contract_version_check",
      "ai_story_motion_plan_versions:ai_story_motion_plan_contract_version_check",
    ]);
    await sql`insert into ai_story_motion_plan_versions values (${directorId}::uuid, 'ai-story-motion-plan.episode-projected.v1', '{"ok":true}'::jsonb)`;
    await expect(sql`insert into ai_story_director_plan_versions values ('88888888-8888-4888-8888-888888888888'::uuid, 'ai-story-director-plan.evil', '{}'::jsonb)`).rejects.toThrow();
  });
});
