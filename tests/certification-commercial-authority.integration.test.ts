import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const url = getIntegrationDbUrl();
const describeIntegration = RUN_DB_INTEGRATION && url ? describe : describe.skip;
const migration = readFileSync(
  resolve(process.cwd(), "packages/db/sql/certification-commercial-authority-v1.sql"),
  "utf8"
);
const schemaName = `cert_commercial_${randomUUID().replaceAll("-", "")}`;

describeIntegration("certification commercial authority predecessor migration", () => {
  let sql: Sql;
  let contender: Sql;

  beforeAll(async () => {
    sql = createIntegrationSql();
    contender = postgres(url!, { max: 1, prepare: false });
    await sql.unsafe(`
      CREATE SCHEMA ${schemaName};
      SET search_path TO ${schemaName}, public;
      CREATE TABLE organizations(id uuid PRIMARY KEY);
      CREATE TABLE workspaces(id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id));
    `);
  });

  afterAll(async () => {
    if (sql) await sql.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    if (contender) await contender.end();
    if (sql) await sql.end();
  });

  it("runs the real migration with no final-state precreation", async () => {
    const before = await sql<{ table_name: string | null }[]>`
      SELECT to_regclass(${`${schemaName}.certification_commercial_scopes`})::text AS table_name
    `;
    expect(before[0]?.table_name).toBeNull();
    await sql.unsafe(`SET search_path TO ${schemaName}, public; ${migration}`);

    const objects = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = ${schemaName}
        AND table_name LIKE 'certification_commercial_%'
      ORDER BY table_name
    `;
    expect(objects.map((row) => row.table_name)).toEqual([
      "certification_commercial_events",
      "certification_commercial_reservations",
      "certification_commercial_scopes",
    ]);
    const rls = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=${schemaName} AND c.relname IN (
        'certification_commercial_scopes','provider_usd_pricing_rules',
        'certification_commercial_reservations','certification_commercial_events'
      ) ORDER BY c.relname
    `;
    expect(rls).toHaveLength(4);
    expect(rls.every((row) => row.relrowsecurity)).toBe(true);
  });

  it("atomically prevents final-slot quota and budget oversubscription", async () => {
    const orgId = randomUUID();
    const workspaceId = randomUUID();
    const scopeId = randomUUID();
    const priceId = randomUUID();
    await sql.unsafe(`SET search_path TO ${schemaName}, public`);
    await sql`INSERT INTO organizations(id) VALUES (${orgId})`;
    await sql`INSERT INTO workspaces(id,org_id) VALUES (${workspaceId},${orgId})`;
    await sql.unsafe(`
      INSERT INTO certification_commercial_scopes(
        certification_scope_id,environment,org_id,workspace_id,capability_key,status,
        max_provider_cost_usd,max_provider_submissions,spent_provider_cost_usd,
        reserved_provider_cost_usd,consumed_provider_submissions,reserved_provider_submissions,
        created_by,reason,created_at,integrity_hash,contract_version,scope_body
      ) VALUES (
        '${scopeId}','STAGING','${orgId}','${workspaceId}','ai_story.execute','ACTIVE',
        1.00,1,0,0,0,0,'${randomUUID()}','test',now(),'hash-scope','1','{}'
      );
      INSERT INTO provider_usd_pricing_rules(
        provider_usd_pricing_rule_id,provider_key,model_id,generation_mode,duration_seconds,
        aspect_ratio,resolution,input_video_included,output_width_pixels,output_height_pixels,
        output_frame_rate,currency,usd_per_million_tokens,cost_basis,source_url,version,
        effective_from,created_by,created_at,integrity_hash,contract_version,pricing_body
      ) VALUES (
        '${priceId}','BYTEPLUS_MODELARK','dreamina-seedance-2-0-260128','TEXT_TO_VIDEO',5,
        '16:9','480p',false,864,480,24,'USD',7,'OFFICIAL_TOKEN_RATE_ESTIMATE',
        'https://docs.byteplus.com/docs/ModelArk/1099320','v1',now(),'${randomUUID()}',now(),
        'hash-price','1','{}'
      );
    `);

    const claim = (client: Sql, identity: string) => client.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schemaName}, public`);
      const rows = await tx<{ consumed: number; reserved: number; spent: string; held: string }[]>`
        SELECT consumed_provider_submissions AS consumed,
               reserved_provider_submissions AS reserved,
               spent_provider_cost_usd::text AS spent,
               reserved_provider_cost_usd::text AS held
        FROM certification_commercial_scopes
        WHERE certification_scope_id=${scopeId} FOR UPDATE
      `;
      const current = rows[0]!;
      if (current.consumed + current.reserved + 1 > 1 || Number(current.spent) + Number(current.held) + 1 > 1) {
        throw new Error("CERTIFICATION_LIMIT_EXCEEDED");
      }
      await tx.unsafe(`
        INSERT INTO certification_commercial_reservations(
          certification_reservation_id,certification_scope_id,provider_usd_pricing_rule_id,
          org_id,workspace_id,execution_identity,reserved_cost_usd,status,created_at,submitted_at,
          integrity_hash,contract_version,reservation_body
        ) VALUES ('${randomUUID()}','${scopeId}','${priceId}','${orgId}','${workspaceId}',
          '${identity}',1.00,'SUBMITTED',now(),now(),'hash-${identity}','1','{}');
      `);
      await tx`UPDATE certification_commercial_scopes
        SET consumed_provider_submissions=consumed_provider_submissions+1,
            reserved_provider_cost_usd=reserved_provider_cost_usd+1
        WHERE certification_scope_id=${scopeId}`;
      return identity;
    });

    const outcomes = await Promise.allSettled([
      claim(sql, "execution-a"),
      claim(contender, "execution-b"),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const [state] = await sql<{ consumed: number; held: string }[]>`
      SELECT consumed_provider_submissions AS consumed,
             reserved_provider_cost_usd::text AS held
      FROM certification_commercial_scopes WHERE certification_scope_id=${scopeId}
    `;
    expect(state).toMatchObject({ consumed: 1, held: "1.00" });
  });
});
