import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RUN_DB_INTEGRATION,
  assertIsolatedTestDatabase,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION ? describe : describe.skip;
const adminUrl = getIntegrationDbUrl();
const migration = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../packages/db/sql/ai-story-local-gpu-audio-evidence-v1.sql"),
  "utf8",
);

const orgId = "10000000-0000-4000-8000-000000000001";
const workspaceA = "10000000-0000-4000-8000-00000000000a";
const workspaceB = "10000000-0000-4000-8000-00000000000b";
const userA = "10000000-0000-4000-8000-0000000000a1";
const userB = "10000000-0000-4000-8000-0000000000b1";
const planA = "10000000-0000-4000-8000-0000000000c1";
const planB = "10000000-0000-4000-8000-0000000000c2";
const sceneA = "10000000-0000-4000-8000-0000000000d1";
const sceneB = "10000000-0000-4000-8000-0000000000d2";
const assetA = "10000000-0000-4000-8000-0000000000e1";
const assetB = "10000000-0000-4000-8000-0000000000e2";
const resultA = "10000000-0000-4000-8000-0000000000f1";
const resultB = "10000000-0000-4000-8000-0000000000f2";
const evidenceA = "10000000-0000-4000-8000-0000000000aa";
const evidenceB = "10000000-0000-4000-8000-0000000000bb";
const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const fingerprintA = `sha256:${"c".repeat(64)}`;
const fingerprintB = `sha256:${"d".repeat(64)}`;
const fingerprintConflict = `sha256:${"e".repeat(64)}`;

function fact(input: {
  evidenceId: string;
  workspaceId: string;
  planId: string;
  sceneId: string;
  resultId: string;
  assetId: string;
  contentHash: string;
  fingerprint: string;
  hasAudio?: boolean;
}) {
  const hasAudio = input.hasAudio ?? true;
  return {
    audioEvidenceId: input.evidenceId,
    orgId,
    workspaceId: input.workspaceId,
    executionPlanId: input.planId,
    sceneExecutionId: input.sceneId,
    generationResultId: input.resultId,
    assetId: input.assetId,
    contentHash: input.contentHash,
    hasAudio,
    speechContent: hasAudio ? "HUMAN_REVIEW_REQUIRED" : "NOT_APPLICABLE",
    evidenceFingerprint: input.fingerprint,
  };
}

describeIntegration("LOCAL_GPU audio evidence database security", () => {
  let admin: Sql;
  let sql: Sql;
  let databaseName = "";

  beforeAll(async () => {
    if (!adminUrl) throw new Error("isolated DATABASE_URL is required");
    assertIsolatedTestDatabase(adminUrl);
    const identity = new URL(adminUrl);
    if (!["localhost", "127.0.0.1", "::1"].includes(identity.hostname)) {
      throw new Error("TEST_DB_ISOLATION_UNPROVEN");
    }
    databaseName = `local_gpu_audio_security_${randomBytes(6).toString("hex")}`;
    admin = postgres(adminUrl, { max: 1, prepare: false });
    await admin.unsafe(`CREATE DATABASE ${databaseName}`);
    identity.pathname = `/${databaseName}`;
    sql = postgres(identity.toString(), { max: 1, prepare: false });
    await sql.unsafe(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'local_gpu_audio_no_bypass') THEN CREATE ROLE local_gpu_audio_no_bypass NOLOGIN NOBYPASSRLS; END IF;
      END $$;
      ALTER ROLE service_role NOLOGIN BYPASSRLS;
      ALTER ROLE local_gpu_audio_no_bypass NOLOGIN NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
      CREATE TABLE organizations (id uuid PRIMARY KEY);
      CREATE TABLE workspaces (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations (id));
      CREATE TABLE workspace_members (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        user_id uuid,
        role text NOT NULL
      );
      CREATE TABLE assets (
        id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL
      );
      CREATE TABLE ai_story_execution_plans (id uuid PRIMARY KEY);
      CREATE TABLE ai_story_scene_executions (id uuid PRIMARY KEY);
      CREATE TABLE ai_story_generation_results (
        generation_result_id uuid PRIMARY KEY,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        execution_plan_id uuid NOT NULL,
        scene_execution_id uuid NOT NULL,
        asset_id uuid NOT NULL,
        content_hash text NOT NULL
      );
      CREATE TABLE manual_local_sentinel (id integer PRIMARY KEY, note text NOT NULL);
      CREATE TABLE post_qc_sentinel (id integer PRIMARY KEY, note text NOT NULL);
      INSERT INTO manual_local_sentinel VALUES (1, 'manual-local-unchanged');
      INSERT INTO post_qc_sentinel VALUES (1, 'post-qc-unchanged');
      INSERT INTO organizations VALUES ('${orgId}');
      INSERT INTO workspaces VALUES ('${workspaceA}', '${orgId}'), ('${workspaceB}', '${orgId}');
      INSERT INTO workspace_members VALUES
        ('${randomUUID()}', '${orgId}', '${workspaceA}', '${userA}', 'admin'),
        ('${randomUUID()}', '${orgId}', '${workspaceB}', '${userB}', 'admin');
      INSERT INTO assets VALUES
        ('${assetA}', '${orgId}', '${workspaceA}'),
        ('${assetB}', '${orgId}', '${workspaceB}');
      INSERT INTO ai_story_execution_plans VALUES ('${planA}'), ('${planB}');
      INSERT INTO ai_story_scene_executions VALUES ('${sceneA}'), ('${sceneB}');
      INSERT INTO ai_story_generation_results VALUES
        ('${resultA}', '${orgId}', '${workspaceA}', '${planA}', '${sceneA}', '${assetA}', '${hashA}'),
        ('${resultB}', '${orgId}', '${workspaceB}', '${planB}', '${sceneB}', '${assetB}', '${hashB}');
      GRANT SELECT ON workspace_members, ai_story_generation_results, assets TO service_role, authenticated;
    `);
    await sql.unsafe(migration);
    await sql.unsafe(migration);
  });

  afterAll(async () => {
    if (sql) {
      await sql.unsafe(`
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM local_gpu_audio_no_bypass;
        DROP OWNED BY local_gpu_audio_no_bypass;
        DROP ROLE IF EXISTS local_gpu_audio_no_bypass;
      `);
      await sql.end();
    }
    if (admin && databaseName) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${databaseName}`);
      await admin.end();
    }
  });

  it("keeps one immutable server-written row and leaves unrelated records unchanged", async () => {
    const row = fact({
      evidenceId: evidenceA,
      workspaceId: workspaceA,
      planId: planA,
      sceneId: sceneA,
      resultId: resultA,
      assetId: assetA,
      contentHash: hashA,
      fingerprint: fingerprintA,
    });
    await sql`
      INSERT INTO ai_story_local_gpu_audio_evidence (
        audio_evidence_id, org_id, workspace_id, execution_plan_id, scene_execution_id,
        generation_result_id, asset_id, content_hash, has_audio, speech_content,
        evidence_fingerprint, fact
      ) VALUES (
        ${row.audioEvidenceId}::uuid, ${row.orgId}::uuid, ${row.workspaceId}::uuid,
        ${row.executionPlanId}::uuid, ${row.sceneExecutionId}::uuid, ${row.generationResultId}::uuid,
        ${row.assetId}::uuid, ${row.contentHash}, ${row.hasAudio}, ${row.speechContent},
        ${row.evidenceFingerprint}, ${sql.json(row)}
      )
    `;
    await sql`
      INSERT INTO ai_story_local_gpu_audio_evidence (
        audio_evidence_id, org_id, workspace_id, execution_plan_id, scene_execution_id,
        generation_result_id, asset_id, content_hash, has_audio, speech_content,
        evidence_fingerprint, fact
      ) VALUES (
        ${row.audioEvidenceId}::uuid, ${row.orgId}::uuid, ${row.workspaceId}::uuid,
        ${row.executionPlanId}::uuid, ${row.sceneExecutionId}::uuid, ${row.generationResultId}::uuid,
        ${row.assetId}::uuid, ${row.contentHash}, ${row.hasAudio}, ${row.speechContent},
        ${row.evidenceFingerprint}, ${sql.json(row)}
      )
      ON CONFLICT (generation_result_id) DO NOTHING
    `;
    await expect(sql`
      INSERT INTO ai_story_local_gpu_audio_evidence (
        audio_evidence_id, org_id, workspace_id, execution_plan_id, scene_execution_id,
        generation_result_id, asset_id, content_hash, has_audio, speech_content,
        evidence_fingerprint, fact
      ) VALUES (
        ${randomUUID()}::uuid, ${row.orgId}::uuid, ${row.workspaceId}::uuid,
        ${row.executionPlanId}::uuid, ${row.sceneExecutionId}::uuid, ${row.generationResultId}::uuid,
        ${row.assetId}::uuid, ${row.contentHash}, ${row.hasAudio}, ${row.speechContent},
        ${fingerprintConflict}, ${sql.json({ ...row, evidenceFingerprint: fingerprintConflict })}
      )
    `).rejects.toMatchObject({ code: "23505" });
    await expect(sql`
      UPDATE ai_story_local_gpu_audio_evidence
      SET created_at = now()
      WHERE generation_result_id = ${resultA}::uuid
    `).rejects.toThrow("LOCAL_GPU_AUDIO_EVIDENCE_IMMUTABLE");
    await expect(sql`
      DELETE FROM ai_story_local_gpu_audio_evidence
      WHERE generation_result_id = ${resultA}::uuid
    `).rejects.toThrow("LOCAL_GPU_AUDIO_EVIDENCE_IMMUTABLE");
    const stored = await sql<{ evidence_fingerprint: string; speech_content: string }[]>`
      SELECT evidence_fingerprint, speech_content
      FROM ai_story_local_gpu_audio_evidence
      WHERE generation_result_id = ${resultA}::uuid
    `;
    expect(stored).toEqual([{ evidence_fingerprint: fingerprintA, speech_content: "HUMAN_REVIEW_REQUIRED" }]);
    await sql.unsafe(migration);
    const rerun = await sql<{ evidence_fingerprint: string }[]>`
      SELECT evidence_fingerprint FROM ai_story_local_gpu_audio_evidence
      WHERE generation_result_id = ${resultA}::uuid
    `;
    expect(rerun).toEqual([{ evidence_fingerprint: fingerprintA }]);
    const manual = await sql<{ note: string }[]>`SELECT note FROM manual_local_sentinel`;
    const postQc = await sql<{ note: string }[]>`SELECT note FROM post_qc_sentinel`;
    expect(manual).toEqual([{ note: "manual-local-unchanged" }]);
    expect(postQc).toEqual([{ note: "post-qc-unchanged" }]);
  });

  it("rejects a workspace or asset binding that disagrees with the Generation Result", async () => {
    const mismatched = fact({
      evidenceId: evidenceB,
      workspaceId: workspaceB,
      planId: planA,
      sceneId: sceneA,
      resultId: resultA,
      assetId: assetA,
      contentHash: hashA,
      fingerprint: fingerprintB,
    });
    await expect(sql`
      INSERT INTO ai_story_local_gpu_audio_evidence (
        audio_evidence_id, org_id, workspace_id, execution_plan_id, scene_execution_id,
        generation_result_id, asset_id, content_hash, has_audio, speech_content,
        evidence_fingerprint, fact
      ) VALUES (
        ${mismatched.audioEvidenceId}::uuid, ${orgId}::uuid, ${workspaceB}::uuid,
        ${planA}::uuid, ${sceneA}::uuid, ${resultA}::uuid, ${assetA}::uuid, ${hashA},
        true, 'HUMAN_REVIEW_REQUIRED', ${fingerprintB}, ${sql.json(mismatched)}
      )
    `).rejects.toThrow("LOCAL_GPU_AUDIO_EVIDENCE_WORKSPACE_MISMATCH");
  });

  it("lets the bypass role insert and read, and blocks anon and cross-workspace members", async () => {
    const row = fact({
      evidenceId: evidenceB,
      workspaceId: workspaceB,
      planId: planB,
      sceneId: sceneB,
      resultId: resultB,
      assetId: assetB,
      contentHash: hashB,
      fingerprint: fingerprintB,
    });
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL role = 'service_role'");
      await tx`
        INSERT INTO ai_story_local_gpu_audio_evidence (
          audio_evidence_id, org_id, workspace_id, execution_plan_id, scene_execution_id,
          generation_result_id, asset_id, content_hash, has_audio, speech_content,
          evidence_fingerprint, fact
        ) VALUES (
          ${row.audioEvidenceId}::uuid, ${row.orgId}::uuid, ${row.workspaceId}::uuid,
          ${row.executionPlanId}::uuid, ${row.sceneExecutionId}::uuid, ${row.generationResultId}::uuid,
          ${row.assetId}::uuid, ${row.contentHash}, ${row.hasAudio}, ${row.speechContent},
          ${row.evidenceFingerprint}, ${tx.json(row)}
        )
      `;
      const visible = await tx<{ generation_result_id: string }[]>`
        SELECT generation_result_id::text FROM ai_story_local_gpu_audio_evidence ORDER BY generation_result_id
      `;
      expect(new Set(visible.map((item) => item.generation_result_id))).toEqual(new Set([resultA, resultB]));
    });
    await sql.unsafe("GRANT UPDATE, DELETE ON ai_story_local_gpu_audio_evidence TO service_role");
    await expect(sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL role = 'service_role'");
      await tx`
        UPDATE ai_story_local_gpu_audio_evidence
        SET created_at = now()
        WHERE generation_result_id = ${resultB}::uuid
      `;
    })).rejects.toThrow("LOCAL_GPU_AUDIO_EVIDENCE_IMMUTABLE");
    await expect(sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL role = 'service_role'");
      await tx`
        DELETE FROM ai_story_local_gpu_audio_evidence
        WHERE generation_result_id = ${resultB}::uuid
      `;
    })).rejects.toThrow("LOCAL_GPU_AUDIO_EVIDENCE_IMMUTABLE");
    await sql.unsafe("REVOKE UPDATE, DELETE ON ai_story_local_gpu_audio_evidence FROM service_role");

    await expect(sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL role = 'anon'");
      await tx`SELECT audio_evidence_id FROM ai_story_local_gpu_audio_evidence`;
    })).rejects.toMatchObject({ code: "42501" });

    const own = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL role = 'authenticated'");
      await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', '${userA}', true)`);
      return tx<{ generation_result_id: string }[]>`
        SELECT generation_result_id::text FROM ai_story_local_gpu_audio_evidence
      `;
    });
    expect(own.map((item) => item.generation_result_id)).toEqual([resultA]);

    await expect(sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL role = 'authenticated'");
      await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', '${userA}', true)`);
      await tx`
        INSERT INTO ai_story_local_gpu_audio_evidence (
          audio_evidence_id, org_id, workspace_id, execution_plan_id, scene_execution_id,
          generation_result_id, asset_id, content_hash, has_audio, speech_content, evidence_fingerprint, fact
        ) VALUES (
          ${randomUUID()}::uuid, ${orgId}::uuid, ${workspaceA}::uuid, ${planA}::uuid, ${sceneA}::uuid,
          ${resultA}::uuid, ${assetA}::uuid, ${hashA}, true, 'HUMAN_REVIEW_REQUIRED', ${fingerprintA}, '{}'::jsonb
        )
      `;
    })).rejects.toMatchObject({ code: "42501" });

    const grants = await sql<{ grantee: string; privilege_type: string }[]>`
      SELECT grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_name = 'ai_story_local_gpu_audio_evidence'
        AND grantee IN ('anon', 'authenticated', 'service_role')
      ORDER BY grantee, privilege_type
    `;
    expect(grants).toEqual([
      { grantee: "authenticated", privilege_type: "SELECT" },
      { grantee: "service_role", privilege_type: "INSERT" },
      { grantee: "service_role", privilege_type: "SELECT" },
    ]);
    const [security] = await sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = 'ai_story_local_gpu_audio_evidence'
    `;
    expect(security).toEqual({ relrowsecurity: true, relforcerowsecurity: false });
    const [serviceRole] = await sql<{ rolbypassrls: boolean }[]>`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role'
    `;
    expect(serviceRole?.rolbypassrls).toBe(true);
  });

  it("rejects insert from a role that does not bypass row security", async () => {
    await sql.unsafe(`
      GRANT SELECT ON ai_story_generation_results, assets TO local_gpu_audio_no_bypass;
      GRANT INSERT ON ai_story_local_gpu_audio_evidence TO local_gpu_audio_no_bypass;
    `);
    const [role] = await sql<{ rolbypassrls: boolean }[]>`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = 'local_gpu_audio_no_bypass'
    `;
    expect(role?.rolbypassrls).toBe(false);
    const before = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM ai_story_local_gpu_audio_evidence
    `;
    const row = fact({
      evidenceId: randomUUID(),
      workspaceId: workspaceB,
      planId: planB,
      sceneId: sceneB,
      resultId: resultB,
      assetId: assetB,
      contentHash: hashB,
      fingerprint: fingerprintConflict,
    });
    await expect(sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL role = 'local_gpu_audio_no_bypass'");
      await tx`
        INSERT INTO ai_story_local_gpu_audio_evidence (
          audio_evidence_id, org_id, workspace_id, execution_plan_id, scene_execution_id,
          generation_result_id, asset_id, content_hash, has_audio, speech_content,
          evidence_fingerprint, fact
        ) VALUES (
          ${row.audioEvidenceId}::uuid, ${row.orgId}::uuid, ${row.workspaceId}::uuid,
          ${row.executionPlanId}::uuid, ${row.sceneExecutionId}::uuid, ${row.generationResultId}::uuid,
          ${row.assetId}::uuid, ${row.contentHash}, ${row.hasAudio}, ${row.speechContent},
          ${row.evidenceFingerprint}, ${tx.json(row)}
        )
      `;
    })).rejects.toMatchObject({ code: "42501" });
    const after = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM ai_story_local_gpu_audio_evidence
    `;
    expect(after).toEqual(before);
  });
});
