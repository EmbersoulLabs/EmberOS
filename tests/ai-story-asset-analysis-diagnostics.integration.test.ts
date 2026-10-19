import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_DB_INTEGRATION_TESTS === "1";
const describeIntegration = enabled ? describe : describe.skip;
const schemaName = `asset_analyzer_${randomUUID().replaceAll("-", "")}`;
const q = `"${schemaName}"`;
let sql: ReturnType<typeof postgres>;

describeIntegration("Asset Analyzer diagnostics predecessor migration", () => {
  beforeAll(async () => {
    sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`create schema ${q}`);
    await sql.unsafe(`
      create table ${q}.asset_analysis_attempts (
        attempt_id uuid primary key,
        org_id uuid not null,
        workspace_id uuid not null,
        asset_id uuid not null,
        content_hash text not null,
        analyzer_version text not null,
        schema_version text not null,
        status text not null check (status in ('SUCCEEDED', 'FAILED')),
        snapshot_id uuid,
        error_code text,
        started_at timestamptz not null,
        completed_at timestamptz not null,
        constraint asset_analysis_attempt_outcome_check check (
          (status='SUCCEEDED' and snapshot_id is not null and error_code is null)
          or (status='FAILED' and snapshot_id is null and error_code is not null)
        )
      )
    `);
    await sql.unsafe(`
      insert into ${q}.asset_analysis_attempts values
      ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','sha256:${"a".repeat(64)}','legacy.v1','schema.v1','FAILED',null,'ASSET_ANALYZER_INVOCATION_FAILED',now(),now())
    `);
  });

  afterAll(async () => {
    await sql?.unsafe(`drop schema if exists ${q} cascade`);
    await sql?.end();
  });

  it("upgrades historical rows idempotently and admits explicit UNKNOWN evidence", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "packages/db/sql/ai-story-asset-analysis-diagnostics-v1.sql"),
      "utf8"
    ).replaceAll("asset_analysis_attempts", `${q}.asset_analysis_attempts`);
    await sql.unsafe(source);
    await sql.unsafe(source);

    const [historical] = await sql.unsafe<Array<{ outcome_certainty: string; failure_stage: string }>>(
      `select outcome_certainty, failure_stage from ${q}.asset_analysis_attempts where error_code='ASSET_ANALYZER_INVOCATION_FAILED'`
    );
    expect(historical).toEqual({ outcome_certainty: "DEFINITE", failure_stage: "PROVIDER_REQUEST" });

    await sql.unsafe(`
      insert into ${q}.asset_analysis_attempts (
        attempt_id,org_id,workspace_id,asset_id,content_hash,analyzer_version,schema_version,
        status,snapshot_id,error_code,failure_stage,outcome_certainty,provider_request_id,
        provider_model_id,provider_usage,started_at,completed_at
      ) values (
        '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004',
        'sha256:${"b".repeat(64)}','semantic.v3','schema.v1','UNKNOWN',null,
        'ASSET_ANALYZER_PROVIDER_OUTCOME_UNKNOWN','PROVIDER_REQUEST','UNKNOWN','req_123',
        'gpt-4o',null,now(),now()
      )
    `);
    const [unknown] = await sql.unsafe<Array<{ status: string; provider_request_id: string }>>(
      `select status, provider_request_id from ${q}.asset_analysis_attempts where status='UNKNOWN'`
    );
    expect(unknown).toEqual({ status: "UNKNOWN", provider_request_id: "req_123" });
  });
});
