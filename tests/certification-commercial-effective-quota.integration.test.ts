import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  "packages/db/sql/certification-commercial-effective-quota-v1.sql"
), "utf8");
const schemaName = `effective_quota_${randomUUID().replaceAll("-", "")}`;

describeIntegration("certification commercial effective quota enforcement", () => {
  let db: Sql;
  let contender: Sql;
  const org = randomUUID();
  const workspace = randomUUID();

  beforeAll(async () => {
    db = createIntegrationSql();
    contender = postgres(url!, { max: 1, prepare: false });
    await db.unsafe(`
      CREATE SCHEMA ${schemaName};
      SET search_path TO ${schemaName}, public;
      CREATE TABLE certification_commercial_scopes(
        certification_scope_id uuid PRIMARY KEY,
        environment text NOT NULL,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        max_provider_submissions int NOT NULL,
        consumed_provider_submissions int NOT NULL,
        reserved_provider_submissions int NOT NULL,
        CONSTRAINT certification_commercial_scope_quota_check CHECK (
          consumed_provider_submissions + reserved_provider_submissions <= max_provider_submissions
        )
      );
      CREATE TABLE certification_submission_slot_reconciliations(
        reconciliation_id uuid PRIMARY KEY,
        certification_scope_id uuid NOT NULL REFERENCES certification_commercial_scopes(certification_scope_id),
        environment text NOT NULL,
        org_id uuid NOT NULL,
        workspace_id uuid NOT NULL
      );
      ${migration}
    `);
  });

  beforeEach(async () => {
    await db.unsafe(`SET search_path TO ${schemaName}, public`);
    await db.unsafe(`TRUNCATE certification_submission_slot_reconciliations, certification_commercial_scopes CASCADE`);
  });

  afterAll(async () => {
    if (db) await db.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    if (contender) await contender.end();
    if (db) await db.end();
  });

  async function seed(gross = 4, reconciled = 1) {
    const scope = randomUUID();
    await db`
      INSERT INTO certification_commercial_scopes(
        certification_scope_id,environment,org_id,workspace_id,
        max_provider_submissions,consumed_provider_submissions,reserved_provider_submissions
      ) VALUES (${scope},'STAGING',${org},${workspace},4,${gross},0)
    `;
    for (let index = 0; index < reconciled; index += 1) {
      await db`
        INSERT INTO certification_submission_slot_reconciliations(
          reconciliation_id,certification_scope_id,environment,org_id,workspace_id
        ) VALUES (${randomUUID()},${scope},'STAGING',${org},${workspace})
      `;
    }
    return scope;
  }

  it("allows one final effective slot and denies a second", async () => {
    const scope = await seed();
    await db`UPDATE certification_commercial_scopes
      SET reserved_provider_submissions=1 WHERE certification_scope_id=${scope}`;
    await expect(db`UPDATE certification_commercial_scopes
      SET reserved_provider_submissions=2 WHERE certification_scope_id=${scope}`)
      .rejects.toThrow("effective submission quota exceeded");
    const [state] = await db<{ gross: number; reserved: number }[]>`
      SELECT consumed_provider_submissions AS gross,
             reserved_provider_submissions AS reserved
      FROM certification_commercial_scopes WHERE certification_scope_id=${scope}
    `;
    expect(state).toEqual({ gross: 4, reserved: 1 });
  });

  it("allows the reconciled submission claim while preserving gross history", async () => {
    const scope = await seed();
    await db`UPDATE certification_commercial_scopes
      SET consumed_provider_submissions=consumed_provider_submissions+1
      WHERE certification_scope_id=${scope}`;
    const [state] = await db<{ gross: number; reconciled: number; effective: number }[]>`
      SELECT scope.consumed_provider_submissions AS gross,
             count(reconciliation.reconciliation_id)::int AS reconciled,
             (scope.consumed_provider_submissions-count(reconciliation.reconciliation_id)::int
               +scope.reserved_provider_submissions)::int AS effective
      FROM certification_commercial_scopes scope
      LEFT JOIN certification_submission_slot_reconciliations reconciliation
        ON reconciliation.certification_scope_id=scope.certification_scope_id
      WHERE scope.certification_scope_id=${scope}
      GROUP BY scope.certification_scope_id
    `;
    expect(state).toEqual({ gross: 5, reconciled: 1, effective: 4 });
  });

  it("has exactly one concurrent winner for the last effective slot", async () => {
    const scope = await seed();
    const reserve = (client: Sql) => client.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schemaName}, public`);
      await tx`
        UPDATE certification_commercial_scopes
        SET reserved_provider_submissions=reserved_provider_submissions+1
        WHERE certification_scope_id=${scope}
      `;
    });
    const outcomes = await Promise.allSettled([reserve(db), reserve(contender)]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const [state] = await db<{ reserved: number }[]>`
      SELECT reserved_provider_submissions AS reserved
      FROM certification_commercial_scopes WHERE certification_scope_id=${scope}
    `;
    expect(state?.reserved).toBe(1);
  });

  it("serializes a reservation/reconciliation race without oversubscription", async () => {
    const scope = await seed(4, 0);
    const reconcile = contender.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schemaName}, public`);
      await tx`
        INSERT INTO certification_submission_slot_reconciliations(
          reconciliation_id,certification_scope_id,environment,org_id,workspace_id
        ) VALUES (${randomUUID()},${scope},'STAGING',${org},${workspace})
      `;
    });
    const reserve = db.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schemaName}, public`);
      await tx`SELECT certification_scope_id FROM certification_commercial_scopes
        WHERE certification_scope_id=${scope} FOR UPDATE`;
      await tx`
        UPDATE certification_commercial_scopes
        SET reserved_provider_submissions=reserved_provider_submissions+1
        WHERE certification_scope_id=${scope}
      `;
    });
    const outcomes = await Promise.allSettled([reconcile, reserve]);
    expect(outcomes[0]?.status).toBe("fulfilled");
    const [state] = await db<{ gross: number; reconciled: number; reserved: number; effective: number }[]>`
      SELECT scope.consumed_provider_submissions AS gross,
             count(reconciliation.reconciliation_id)::int AS reconciled,
             scope.reserved_provider_submissions AS reserved,
             (scope.consumed_provider_submissions-count(reconciliation.reconciliation_id)::int
               +scope.reserved_provider_submissions)::int AS effective
      FROM certification_commercial_scopes scope
      LEFT JOIN certification_submission_slot_reconciliations reconciliation
        ON reconciliation.certification_scope_id=scope.certification_scope_id
      WHERE scope.certification_scope_id=${scope}
      GROUP BY scope.certification_scope_id
    `;
    expect(state?.gross).toBe(4);
    expect(state?.reconciled).toBe(1);
    expect([0, 1]).toContain(state?.reserved);
    expect(state?.effective).toBeLessThanOrEqual(4);
  });

  it("fails closed for malformed credits, identities, and corrupted usage", async () => {
    const scope = await seed(1, 1);
    await expect(db`
      INSERT INTO certification_submission_slot_reconciliations(
        reconciliation_id,certification_scope_id,environment,org_id,workspace_id
      ) VALUES (${randomUUID()},${scope},'STAGING',${org},${workspace})
    `).rejects.toThrow("exceed gross");
    await expect(db`
      INSERT INTO certification_submission_slot_reconciliations(
        reconciliation_id,certification_scope_id,environment,org_id,workspace_id
      ) VALUES (${randomUUID()},${scope},'STAGING',${randomUUID()},${workspace})
    `).rejects.toThrow("identity mismatch");
    await expect(db`UPDATE certification_commercial_scopes
      SET consumed_provider_submissions=6 WHERE certification_scope_id=${scope}`)
      .rejects.toThrow("effective submission quota exceeded");
    await expect(db`UPDATE certification_commercial_scopes
      SET max_provider_submissions=0 WHERE certification_scope_id=${scope}`)
      .rejects.toThrow();
  });
});
