import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import {
  assertExecutionPlanOwnershipChainInSingleQuery,
  closeDb,
  getExecutionPlanReviewPlanAuthority,
  getDb,
} from "@ceo-agent/db";
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

  it("certifies trivial-query and primary-key round-trip baselines", async () => {
    await sql`
      insert into emberos_ci_authority_probe (id, value)
      values (99, 'roundtrip-baseline')
      on conflict (id) do update set value = excluded.value
    `;
    const measure = async (operation: () => Promise<unknown>) => {
      const startedAt = performance.now();
      await operation();
      return performance.now() - startedAt;
    };
    const select1ValuesMs: number[] = [];
    const pkLookupValuesMs: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      select1ValuesMs.push(await measure(() => sql`select 1 as value`));
    }
    for (let index = 0; index < 5; index += 1) {
      pkLookupValuesMs.push(await measure(() => sql`
        select id from emberos_ci_authority_probe where id = 99
      `));
    }
    const oneQueryMs = await measure(() => sql`
      select 1 as value_1, 1 as value_2, 1 as value_3, 1 as value_4, 1 as value_5
    `);
    const fiveQueryValuesMs: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      fiveQueryValuesMs.push(await measure(() => sql`select 1 as value`));
    }
    const [explainRow] = await sql.unsafe<Array<{ "QUERY PLAN": unknown }>>(
      "explain (analyze, format json) select 1 as value"
    );
    console.info("prod_db_roundtrip_ci_baseline", JSON.stringify({
      select1ValuesMs: select1ValuesMs.map((value) => Number(value.toFixed(3))),
      pkLookupValuesMs: pkLookupValuesMs.map((value) => Number(value.toFixed(3))),
      oneQueryMs: Number(oneQueryMs.toFixed(3)),
      fiveQueryValuesMs: fiveQueryValuesMs.map((value) => Number(value.toFixed(3))),
      fiveQueryTotalMs: Number(fiveQueryValuesMs.reduce((sum, value) => sum + value, 0).toFixed(3)),
      queryPlan: explainRow?.["QUERY PLAN"],
    }));
    expect(select1ValuesMs).toHaveLength(5);
    expect(pkLookupValuesMs).toHaveLength(5);
    expect(JSON.stringify(explainRow?.["QUERY PLAN"])).toContain("Execution Time");
  });

  it("certifies the compact ownership proof standalone and captures its SQL plan", async () => {
    const authority = {
      id: "71000000-0000-4000-8000-000000000006",
      orgId: "71000000-0000-4000-8000-000000000001",
      workspaceId: "71000000-0000-4000-8000-000000000002",
      campaignId: "71000000-0000-4000-8000-000000000003",
      storyId: "71000000-0000-4000-8000-000000000004",
      storyVersionId: "71000000-0000-4000-8000-000000000005",
      animationPackageId: "71000000-0000-4000-8000-000000000007",
    } as const;
    try {
      await sql`insert into organizations (id, name, slug) values (${authority.orgId}, 'Ownership probe', 'ownership-probe')`;
      await sql`insert into workspaces (id, org_id, name, slug) values (${authority.workspaceId}, ${authority.orgId}, 'Ownership probe', 'ownership-probe')`;
      await sql`insert into campaigns (id, org_id, workspace_id, name) values (${authority.campaignId}, ${authority.orgId}, ${authority.workspaceId}, 'Ownership probe')`;
      await sql`insert into ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea) values (${authority.storyId}, ${authority.orgId}, ${authority.workspaceId}, ${authority.campaignId}, 'Ownership probe', 'Ownership probe')`;
      await sql`insert into ai_story_versions (id, story_id, version_number, structured_content, frozen_at) values (${authority.storyVersionId}, ${authority.storyId}, 1, ${sql.json({})}, now())`;
      await sql`insert into ai_story_animation_packages (id, org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload) values (${authority.animationPackageId}, ${authority.orgId}, ${authority.workspaceId}, ${authority.campaignId}, ${authority.storyId}, ${authority.storyVersionId}, 'ready_for_execution', ${sql.json({ scenePlan: [] })})`;
      const compiledPlan = {
        scenes: [{ id: "scene-1", compiledPayload: "x".repeat(512 * 1024) }],
      };
      await sql`
        insert into ai_story_execution_plans (
          id, org_id, workspace_id, campaign_id, story_id, story_version_id,
          animation_package_id, status, contract_version, compilation_hash,
          deterministic_fingerprint, plan, compiled_at
        ) values (
          ${authority.id}, ${authority.orgId}, ${authority.workspaceId},
          ${authority.campaignId}, ${authority.storyId}, ${authority.storyVersionId},
          ${authority.animationPackageId}, 'PLANNED', 'ci-v1', 'ci-plan-hash',
          'ci-plan-read-fingerprint', ${sql.json(compiledPlan)}, now()
        )
      `;

      const startedAt = performance.now();
      await assertExecutionPlanOwnershipChainInSingleQuery(authority, getDb());
      const standaloneMs = performance.now() - startedAt;

      const [explainRow] = await sql.unsafe<Array<{ "QUERY PLAN": unknown }>>(`
        explain (analyze, buffers, format json)
        select (
          exists (select 1 from organizations o where o.id = '${authority.orgId}'::uuid)
          and exists (select 1 from workspaces w where w.id = '${authority.workspaceId}'::uuid and w.org_id = '${authority.orgId}'::uuid)
          and exists (select 1 from campaigns c where c.id = '${authority.campaignId}'::uuid and c.workspace_id = '${authority.workspaceId}'::uuid and c.org_id = '${authority.orgId}'::uuid)
          and exists (select 1 from ai_stories s where s.id = '${authority.storyId}'::uuid and s.campaign_id = '${authority.campaignId}'::uuid and s.workspace_id = '${authority.workspaceId}'::uuid and s.org_id = '${authority.orgId}'::uuid)
          and exists (select 1 from ai_story_versions v where v.id = '${authority.storyVersionId}'::uuid and v.story_id = '${authority.storyId}'::uuid)
          and exists (select 1 from ai_story_animation_packages p where p.id = '${authority.animationPackageId}'::uuid and p.story_id = '${authority.storyId}'::uuid and p.story_version_id = '${authority.storyVersionId}'::uuid and p.campaign_id = '${authority.campaignId}'::uuid and p.workspace_id = '${authority.workspaceId}'::uuid and p.org_id = '${authority.orgId}'::uuid)
        ) as valid
      `);
      const queryPlan = explainRow?.["QUERY PLAN"];
      console.info("ai_story_ownership_query_ci_timing", JSON.stringify({
        standaloneMs: Number(standaloneMs.toFixed(3)),
        queryCount: 1,
        roundTripCount: 1,
        queryPlan,
      }));
      expect(standaloneMs).toBeLessThan(250);
      expect(JSON.stringify(queryPlan)).toContain("Execution Time");

      const preStartedAt = performance.now();
      const preRows = await sql`
        select * from ai_story_execution_plans
        where id = ${authority.id}
        limit 1
      `;
      const preFixStandaloneMs = performance.now() - preStartedAt;
      const preFixResponseBytesApprox = new TextEncoder().encode(JSON.stringify(preRows)).byteLength;

      const postStartedAt = performance.now();
      const postRows = await sql`
        select id, org_id, workspace_id, campaign_id, story_id,
          story_version_id, animation_package_id, status
        from ai_story_execution_plans
        where id = ${authority.id}
        limit 1
      `;
      const postFixStandaloneMs = performance.now() - postStartedAt;
      const postFixResponseBytesApprox = new TextEncoder().encode(JSON.stringify(postRows)).byteLength;
      const productionProjection = await getExecutionPlanReviewPlanAuthority(authority.id, getDb());

      const [planReadExplainRow] = await sql.unsafe<Array<{ "QUERY PLAN": unknown }>>(`
        explain (analyze, buffers, format json)
        select id, org_id, workspace_id, campaign_id, story_id,
          story_version_id, animation_package_id, status
        from ai_story_execution_plans
        where id = '${authority.id}'::uuid
        limit 1
      `);
      const planReadQueryPlan = planReadExplainRow?.["QUERY PLAN"];
      console.info("ai_story_review_plan_read_ci_timing", JSON.stringify({
        preFixStandaloneMs: Number(preFixStandaloneMs.toFixed(3)),
        postFixStandaloneMs: Number(postFixStandaloneMs.toFixed(3)),
        preFixQueryCount: 1,
        postFixQueryCount: 1,
        preFixRoundTripCount: 1,
        postFixRoundTripCount: 1,
        preFixRowCount: preRows.length,
        postFixRowCount: postRows.length,
        preFixResponseBytesApprox,
        postFixResponseBytesApprox,
        queryPlan: planReadQueryPlan,
      }));
      expect(productionProjection).toEqual({
        id: authority.id,
        orgId: authority.orgId,
        workspaceId: authority.workspaceId,
        campaignId: authority.campaignId,
        storyId: authority.storyId,
        storyVersionId: authority.storyVersionId,
        animationPackageId: authority.animationPackageId,
        status: "PLANNED",
      });
      expect(postFixStandaloneMs).toBeLessThan(250);
      expect(postFixResponseBytesApprox).toBeLessThan(preFixResponseBytesApprox / 10);
      expect(JSON.stringify(planReadQueryPlan)).toContain("Execution Time");
    } finally {
      await closeDb();
      await sql`delete from ai_story_execution_plans where id = ${authority.id}`;
      await sql`delete from ai_story_animation_packages where id = ${authority.animationPackageId}`;
      await sql`delete from ai_story_versions where id = ${authority.storyVersionId}`;
      await sql`delete from ai_stories where id = ${authority.storyId}`;
      await sql`delete from campaigns where id = ${authority.campaignId}`;
      await sql`delete from workspaces where id = ${authority.workspaceId}`;
      await sql`delete from organizations where id = ${authority.orgId}`;
    }
  });
});
