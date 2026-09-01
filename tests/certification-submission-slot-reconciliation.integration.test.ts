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
const migration = readFileSync(resolve(
  process.cwd(),
  "packages/db/sql/certification-submission-slot-reconciliation-v1.sql"
), "utf8");
const schemaName = `slot_reconcile_${randomUUID().replaceAll("-", "")}`;

describeIntegration("certification submission-slot append-only reconciliation", () => {
  let db: Sql;
  let contender: Sql;

  beforeAll(async () => {
    db = createIntegrationSql();
    contender = postgres(url!, { max: 1, prepare: false });
    await db.unsafe(`
      CREATE SCHEMA ${schemaName};
      SET search_path TO ${schemaName}, public;
      CREATE TABLE organizations(id uuid PRIMARY KEY);
      CREATE TABLE workspaces(id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id));
      CREATE TABLE workspace_members(workspace_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL);
      CREATE TABLE ai_story_scene_executions(id uuid PRIMARY KEY);
      CREATE TABLE provider_execution_dispatches(dispatch_id text PRIMARY KEY);
      CREATE TABLE certification_commercial_scopes(
        certification_scope_id uuid PRIMARY KEY,
        consumed_provider_submissions int NOT NULL,
        reserved_provider_submissions int NOT NULL,
        max_provider_submissions int NOT NULL
      );
      CREATE TABLE certification_commercial_reservations(
        certification_reservation_id uuid PRIMARY KEY,
        certification_scope_id uuid NOT NULL REFERENCES certification_commercial_scopes(certification_scope_id),
        execution_identity text NOT NULL,
        CONSTRAINT certification_reservation_execution_unique UNIQUE(certification_scope_id, execution_identity)
      );
      CREATE TABLE certification_commercial_events(
        certification_commercial_event_id uuid PRIMARY KEY,
        certification_reservation_id uuid REFERENCES certification_commercial_reservations(certification_reservation_id)
      );
      ${migration}
    `);
  });

  afterAll(async () => {
    if (db) await db.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    if (contender) await contender.end();
    if (db) await db.end();
  });

  it("keeps gross history and allows exactly one immutable credit under concurrency", async () => {
    const org = randomUUID();
    const workspace = randomUUID();
    const scene = randomUUID();
    const scope = randomUUID();
    const reservation = randomUUID();
    const sourceEvent = randomUUID();
    const reconciliation = randomUUID();
    const actor = randomUUID();
    const dispatch = "dispatch:test-slot-reconciliation";
    await db.unsafe(`SET search_path TO ${schemaName}, public`);
    await db.unsafe(`
      INSERT INTO organizations VALUES ('${org}');
      INSERT INTO workspaces VALUES ('${workspace}','${org}');
      INSERT INTO ai_story_scene_executions VALUES ('${scene}');
      INSERT INTO provider_execution_dispatches VALUES ('${dispatch}');
      INSERT INTO certification_commercial_scopes VALUES ('${scope}',2,0,4);
      INSERT INTO certification_commercial_reservations(certification_reservation_id,certification_scope_id,execution_identity)
        VALUES ('${reservation}','${scope}','attempt:test');
      INSERT INTO certification_commercial_events VALUES ('${sourceEvent}','${reservation}');
    `);
    const insert = (client: Sql) => client.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schemaName}, public`);
      await tx.unsafe(`
        INSERT INTO certification_submission_slot_reconciliations(
          reconciliation_id,environment,org_id,workspace_id,certification_scope_id,
          scene_execution_id,dispatch_id,certification_reservation_id,
          source_consumption_event_id,outcome_classification,reason,actor_user_id,
          idempotency_key,evidence,quota_before,quota_after,integrity_hash,
          contract_version,created_at
        ) VALUES (
          '${reconciliation}','STAGING','${org}','${workspace}','${scope}',
          '${scene}','${dispatch}','${reservation}','${sourceEvent}',
          'PROVEN_NOT_SUBMITTED','PROVEN_PROVIDER_NON_ACCEPTANCE_RECONCILIATION',
          '${actor}','slot-test','{}','{"grossConsumed":2,"effectiveConsumed":2}',
          '{"grossConsumed":2,"reconciledNonSubmissions":1,"effectiveConsumed":1}',
          'sha256:${"a".repeat(64)}','certification-submission-slot-reconciliation.v1',now()
        ) ON CONFLICT (idempotency_key) DO NOTHING
      `);
    });
    await Promise.all([insert(db), insert(contender)]);
    const [state] = await db<{ gross: number; reconciled: number }[]>`
      SELECT scope.consumed_provider_submissions AS gross,
             count(r.reconciliation_id)::int AS reconciled
      FROM certification_commercial_scopes scope
      LEFT JOIN certification_submission_slot_reconciliations r
        ON r.certification_scope_id=scope.certification_scope_id
      WHERE scope.certification_scope_id=${scope}
      GROUP BY scope.certification_scope_id
    `;
    expect(state).toEqual({ gross: 2, reconciled: 1 });
    const successorReservation = randomUUID();
    await db.unsafe(`
      INSERT INTO ${schemaName}.certification_commercial_reservations(
        certification_reservation_id,certification_scope_id,execution_identity,
        source_slot_reconciliation_id
      ) VALUES ('${successorReservation}','${scope}','attempt:test','${reconciliation}')
    `);
    await expect(db.unsafe(`
      INSERT INTO ${schemaName}.certification_commercial_reservations(
        certification_reservation_id,certification_scope_id,execution_identity,
        source_slot_reconciliation_id
      ) VALUES ('${randomUUID()}','${scope}','attempt:test','${reconciliation}')
    `)).rejects.toThrow();
    await expect(db.unsafe(`
      UPDATE ${schemaName}.certification_submission_slot_reconciliations
      SET reason='PROVEN_PROVIDER_NON_ACCEPTANCE_RECONCILIATION'
      WHERE reconciliation_id='${reconciliation}'
    `)).rejects.toThrow("immutable");
    await expect(db.unsafe(`
      DELETE FROM ${schemaName}.certification_submission_slot_reconciliations
      WHERE reconciliation_id='${reconciliation}'
    `)).rejects.toThrow("immutable");
  });
});
