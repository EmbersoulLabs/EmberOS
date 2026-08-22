import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import {
  RUN_DB_INTEGRATION,
  assertIsolatedTestDatabase,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION ? describe : describe.skip;
const url = getIntegrationDbUrl();

describeIntegration("ephemeral PostgreSQL integration authority", () => {
  let sql: Sql;
  let contention: Sql;

  beforeAll(async () => {
    if (!url) throw new Error("isolated DATABASE_URL is required");
    assertIsolatedTestDatabase(url);
    sql = createIntegrationSql();
    contention = postgres(url, { max: 1, prepare: false });
    await sql.unsafe(`
      create table if not exists emberos_ci_authority_probe (
        id integer primary key,
        value text not null unique
      )
    `);
    await sql`delete from emberos_ci_authority_probe`;
  });

  afterAll(async () => {
    if (sql) await sql`drop table if exists emberos_ci_authority_probe`;
    if (contention) await contention.end();
    if (sql) await sql.end();
  });

  it("uses the explicit ephemeral test identity and complete approval schema", async () => {
    const [identity] = await sql<{ database: string }[]>`select current_database() as database`;
    expect(identity?.database).toBe("emberos_test");
    const required = [
      "workspaces",
      "workspace_members",
      "campaigns",
      "ai_stories",
      "ai_story_versions",
      "ai_story_execution_plans",
      "ai_story_scene_executions",
      "provider_attempts",
      "ai_story_scene_results",
      "ai_story_durable_scene_media_attestations",
      "ai_story_generated_scene_reviews",
      "ai_story_scene_release_states",
    ];
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any(${required})
    `;
    expect(new Set(rows.map((row) => row.table_name))).toEqual(new Set(required));
  });

  it("commits, rolls back, enforces uniqueness and supports on conflict", async () => {
    await sql.begin(async (tx) => {
      await tx`insert into emberos_ci_authority_probe (id, value) values (1, 'commit')`;
    });
    await expect(sql`select 1 from emberos_ci_authority_probe where id = 1`).resolves.toHaveLength(1);

    await expect(
      sql.begin(async (tx) => {
        await tx`insert into emberos_ci_authority_probe (id, value) values (2, 'rollback')`;
        throw new Error("forced rollback");
      })
    ).rejects.toThrow("forced rollback");
    await expect(sql`select 1 from emberos_ci_authority_probe where id = 2`).resolves.toHaveLength(0);

    await expect(sql`insert into emberos_ci_authority_probe (id, value) values (3, 'commit')`).rejects.toBeTruthy();
    await sql`insert into emberos_ci_authority_probe (id, value) values (1, 'ignored') on conflict (id) do nothing`;
    await expect(sql`select 1 from emberos_ci_authority_probe where id = 1`).resolves.toHaveLength(1);
  });

  it("enforces statement and row-lock timeouts and recovers afterward", async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '50ms'");
        await tx.unsafe("select pg_sleep(0.2)");
      })
    ).rejects.toBeTruthy();

    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const owner = sql.begin(async (tx) => {
      await tx`select * from emberos_ci_authority_probe where id = 1 for update`;
      await held;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(
      contention.begin(async (tx) => {
        await tx.unsafe("set local lock_timeout = '50ms'");
        await tx`update emberos_ci_authority_probe set value = 'blocked' where id = 1`;
      })
    ).rejects.toBeTruthy();
    release();
    await owner;
    await expect(sql`select 1`).resolves.toHaveLength(1);
  });

  it("observes a max-one client pool", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const owner = sql.begin(async () => { await held; });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = sql`select 1`;
    const raced = await Promise.race([
      second.then(() => "unexpected-second-connection"),
      new Promise<string>((resolve) => setTimeout(() => resolve("blocked-by-max-one"), 75)),
    ]);
    expect(raced).toBe("blocked-by-max-one");
    release();
    await owner;
    await second;
  });
});
