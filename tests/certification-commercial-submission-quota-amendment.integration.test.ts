import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import {
  BillingAccountRepositoryImpl,
  CertificationCommercialAuthorityService,
  CertificationCommercialError,
  closeDb,
} from "@ceo-agent/db";
import {
  PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON,
  STAGING_BOUNDED_SUCCESSOR_SEEDANCE_CERTIFICATION_QUOTA_AMENDMENT_REASON,
  ProviderUsdPricingRuleSchema,
  buildBillingAccount,
  estimateProviderCostUsd,
  withIntegrity,
} from "@ceo-agent/shared/server";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const url = getIntegrationDbUrl();
const describeIntegration = RUN_DB_INTEGRATION && url ? describe : describe.skip;
const predecessor = readFileSync(
  resolve(process.cwd(), "packages/db/sql/certification-commercial-authority-v1.sql"),
  "utf8"
);
const ceiling = readFileSync(
  resolve(process.cwd(), "packages/db/sql/certification-commercial-ceiling-amendment-v1.sql"),
  "utf8"
);
const quota = readFileSync(
  resolve(process.cwd(), "packages/db/sql/certification-commercial-submission-quota-amendment-v1.sql"),
  "utf8"
);
const schemaName = `cert_quota_${randomUUID().replaceAll("-", "")}`;

function pricingRule(input: {
  ruleId: string;
  createdBy: string;
  version: string;
  createdAt: string;
}) {
  return ProviderUsdPricingRuleSchema.parse(withIntegrity({
    contractVersion: "1" as const,
    providerUsdPricingRuleId: input.ruleId,
    providerKey: "BYTEPLUS_MODELARK" as const,
    modelId: "dreamina-seedance-2-0-260128" as const,
    generationMode: "TEXT_TO_VIDEO" as const,
    durationSeconds: 5,
    aspectRatio: "16:9" as const,
    resolution: "480p" as const,
    inputVideoIncluded: false as const,
    outputWidthPixels: 864,
    outputHeightPixels: 480,
    outputFrameRate: 24,
    currency: "USD" as const,
    usdPerMillionTokens: "7.0000",
    costBasis: "OFFICIAL_TOKEN_RATE_ESTIMATE" as const,
    sourceUrl: "https://docs.byteplus.com/docs/ModelArk/1099320" as const,
    version: input.version,
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveTo: null,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  }));
}

describeIntegration("Production commercial submission quota amendment SQL", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql.unsafe(`
      CREATE SCHEMA ${schemaName};
      SET search_path TO ${schemaName}, public;
      CREATE TABLE organizations(id uuid PRIMARY KEY);
      CREATE TABLE workspaces(id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id));
    `);
  });

  afterAll(async () => {
    if (sql) await sql.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    if (sql) await sql.end();
  });

  it("accepts SUBMISSION_QUOTA_AMENDED only after the bounded quota migration", async () => {
    await sql.unsafe(`SET search_path TO ${schemaName}, public; ${predecessor}`);
    await sql.unsafe(`SET search_path TO ${schemaName}, public; ${ceiling}`);
    const orgId = randomUUID();
    const workspaceId = randomUUID();
    const scopeId = randomUUID();
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
        0.29,1,0.29,0,1,0,'${randomUUID()}','test',now(),'hash-scope-quota','1','{}'
      )
    `);
    const before = sql.unsafe(`
      INSERT INTO certification_commercial_events(
        certification_commercial_event_id,certification_scope_id,event_type,reason,occurred_at,integrity_hash,event_body
      ) VALUES (
        '${randomUUID()}','${scopeId}','SUBMISSION_QUOTA_AMENDED','Human-authorized Production additional Provider submission',now(),'hash-event-denied','{}'
      )
    `);
    await expect(before).rejects.toThrow();
    await sql.unsafe(`SET search_path TO ${schemaName}, public; ${quota}`);
    await sql.unsafe(`
      INSERT INTO certification_commercial_events(
        certification_commercial_event_id,certification_scope_id,event_type,reason,occurred_at,integrity_hash,event_body
      ) VALUES (
        '${randomUUID()}','${scopeId}','SUBMISSION_QUOTA_AMENDED','Human-authorized Production additional Provider submission',now(),'hash-event-quota','{}'
      )
    `);
    const rows = await sql<{ event_type: string }[]>`
      SELECT event_type FROM certification_commercial_events WHERE certification_scope_id = ${scopeId}
    `;
    expect(rows.map((row) => row.event_type)).toEqual(["SUBMISSION_QUOTA_AMENDED"]);
  });
});

describeIntegration("Production commercial submission quota amendment service", () => {
  const commercial = new CertificationCommercialAuthorityService();
  let sql: Sql;

  beforeAll(() => {
    sql = createIntegrationSql();
  });

  afterAll(async () => {
    await closeDb();
    if (sql) await sql.end();
  });

  async function seed() {
    const suffix = randomUUID().slice(0, 8);
    const orgId = randomUUID();
    const workspaceId = randomUUID();
    const actorUserId = randomUUID();
    const createdAt = "2026-09-19T16:00:00.000Z";
    await sql`
      INSERT INTO organizations (id, name, slug)
      VALUES (${orgId}, ${"Quota Org"}, ${`quota-${suffix}`})
    `;
    await sql`
      INSERT INTO workspaces (id, org_id, name, slug)
      VALUES (${workspaceId}, ${orgId}, ${"Quota Workspace"}, ${`ws-quota-${suffix}`})
    `;
    await new BillingAccountRepositoryImpl().createOrConverge(buildBillingAccount({
      orgId,
      createdAt,
      identitySeed: `quota-billing:${orgId}`,
    }));
    const rule = pricingRule({
      ruleId: randomUUID(),
      createdBy: actorUserId,
      version: `quota-${suffix}`,
      createdAt,
    });
    await commercial.provisionPrice(rule);
    const maxProviderCostUsd = estimateProviderCostUsd(rule);
    expect(maxProviderCostUsd).toBe("0.35");
    const provisioned = await commercial.provisionScope({
      environment: "PRODUCTION",
      orgId,
      workspaceId,
      actorUserId,
      createdAt,
      maxProviderCostUsd,
      maxProviderSubmissions: 1,
    });
    return { orgId, workspaceId, actorUserId, createdAt, rule, scope: provisioned.scope, maxProviderCostUsd };
  }

  async function cleanup(input: { orgId: string; workspaceId: string; ruleId: string; scopeId: string }) {
    await sql`DELETE FROM certification_commercial_events WHERE certification_scope_id = ${input.scopeId}`;
    await sql`DELETE FROM certification_commercial_reservations WHERE certification_scope_id = ${input.scopeId}`;
    await sql`DELETE FROM certification_commercial_scopes WHERE certification_scope_id = ${input.scopeId}`;
    await sql`DELETE FROM provider_usd_pricing_rules WHERE provider_usd_pricing_rule_id = ${input.ruleId}`;
    await sql`DELETE FROM billing_accounts WHERE org_id = ${input.orgId}`;
    await sql`DELETE FROM workspaces WHERE id = ${input.workspaceId}`;
    await sql`DELETE FROM organizations WHERE id = ${input.orgId}`;
  }

  it("amends Production ACTIVE quota 1 → 2 exactly once, evented, without touching counters or ceiling", async () => {
    const seeded = await seed();
    try {
      const reserved = await commercial.reserve({
        environment: "PRODUCTION",
        orgId: seeded.orgId,
        workspaceId: seeded.workspaceId,
        executionIdentity: "942d8d59-bf9c-579a-85c1-807d905aa605",
        pricingRule: seeded.rule,
        createdAt: seeded.createdAt,
        claimSubmission: true,
      });
      expect(reserved.reservation.status).toBe("SUBMITTED");
      expect(reserved.scope.maxProviderSubmissions).toBe(1);
      expect(reserved.scope.consumedProviderSubmissions).toBe(1);
      expect(reserved.scope.maxProviderCostUsd).toBe(seeded.maxProviderCostUsd);
      expect(reserved.reservation.reservedCostUsd).toBe(seeded.maxProviderCostUsd);

      await expect(commercial.amendActiveProductionSubmissionQuota({
        environment: "STAGING",
        certificationScopeId: seeded.scope.certificationScopeId,
        orgId: seeded.orgId,
        workspaceId: seeded.workspaceId,
        actorUserId: seeded.actorUserId,
        humanAuthorizationReason: PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON,
        amendedAt: "2026-09-19T16:21:00.000Z",
        maxProviderSubmissions: 2,
      })).rejects.toBeInstanceOf(CertificationCommercialError);

      await expect(commercial.amendActiveProductionSubmissionQuota({
        environment: "PRODUCTION",
        certificationScopeId: seeded.scope.certificationScopeId,
        orgId: seeded.orgId,
        workspaceId: seeded.workspaceId,
        actorUserId: seeded.actorUserId,
        humanAuthorizationReason: PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON,
        amendedAt: "2026-09-19T16:21:00.000Z",
        maxProviderSubmissions: 3,
      })).rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_AMENDMENT_DENIED" });

      await expect(commercial.amendActiveProductionSubmissionQuota({
        environment: "PRODUCTION",
        certificationScopeId: seeded.scope.certificationScopeId,
        orgId: seeded.orgId,
        workspaceId: seeded.workspaceId,
        actorUserId: seeded.actorUserId,
        humanAuthorizationReason: PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON,
        amendedAt: "2026-09-19T16:21:00.000Z",
        maxProviderSubmissions: 0,
      })).rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_AMENDMENT_DENIED" });

      const first = await commercial.amendActiveProductionSubmissionQuota({
        environment: "PRODUCTION",
        certificationScopeId: seeded.scope.certificationScopeId,
        orgId: seeded.orgId,
        workspaceId: seeded.workspaceId,
        actorUserId: seeded.actorUserId,
        humanAuthorizationReason: PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON,
        amendedAt: "2026-09-19T16:21:00.000Z",
        maxProviderSubmissions: 2,
      });
      expect(first.replayed).toBe(false);
      expect(first.scope.maxProviderSubmissions).toBe(2);
      expect(first.scope.maxProviderCostUsd).toBe(seeded.scope.maxProviderCostUsd);
      expect(first.scope.spentProviderCostUsd).toBe(reserved.scope.spentProviderCostUsd);
      expect(first.scope.reservedProviderCostUsd).toBe(reserved.scope.reservedProviderCostUsd);
      expect(first.scope.consumedProviderSubmissions).toBe(1);
      expect(first.scope.reservedProviderSubmissions).toBe(0);

      const replay = await commercial.amendActiveProductionSubmissionQuota({
        environment: "PRODUCTION",
        certificationScopeId: seeded.scope.certificationScopeId,
        orgId: seeded.orgId,
        workspaceId: seeded.workspaceId,
        actorUserId: seeded.actorUserId,
        humanAuthorizationReason: PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON,
        amendedAt: "2026-09-19T16:22:00.000Z",
        maxProviderSubmissions: 2,
      });
      expect(replay.replayed).toBe(true);
      expect(replay.scope.integrityHash).toBe(first.scope.integrityHash);
      expect(replay.scope.maxProviderCostUsd).toBe(first.scope.maxProviderCostUsd);
      expect(replay.scope.maxProviderCostUsd).toBe(seeded.maxProviderCostUsd);

      await expect(commercial.reserve({
        environment: "PRODUCTION",
        orgId: seeded.orgId,
        workspaceId: seeded.workspaceId,
        executionIdentity: "3cd3dbe7-1fbf-5df2-9df3-74837f2381d5",
        pricingRule: seeded.rule,
        createdAt: "2026-09-19T16:22:30.000Z",
        claimSubmission: true,
      })).rejects.toMatchObject({
        name: "CertificationCommercialError",
        code: "CERTIFICATION_BUDGET_EXCEEDED",
      });
      const afterDeniedSecond = await commercial.getActiveScope(
        "PRODUCTION",
        seeded.orgId,
        seeded.workspaceId,
      );
      expect(afterDeniedSecond?.maxProviderSubmissions).toBe(2);
      expect(afterDeniedSecond?.maxProviderCostUsd).toBe(seeded.maxProviderCostUsd);
      expect(afterDeniedSecond?.consumedProviderSubmissions).toBe(1);

      await expect(commercial.amendActiveProductionScopeCeiling({
        environment: "PRODUCTION",
        certificationScopeId: seeded.scope.certificationScopeId,
        orgId: seeded.orgId,
        workspaceId: seeded.workspaceId,
        actorUserId: seeded.actorUserId,
        amendedAt: "2026-09-19T16:23:00.000Z",
        maxProviderCostUsd: seeded.scope.maxProviderCostUsd,
        maxProviderSubmissions: 3,
      })).rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_AMENDMENT_DENIED" });

      const reservations = await sql<{ status: string; reserved_cost_usd: string }[]>`
        SELECT status, reserved_cost_usd::text AS reserved_cost_usd
          FROM certification_commercial_reservations
         WHERE certification_scope_id = ${seeded.scope.certificationScopeId}
      `;
      expect(reservations).toEqual([{
        status: reserved.reservation.status,
        reserved_cost_usd: reserved.reservation.reservedCostUsd,
      }]);

      const events = await sql<{
        event_type: string;
        reason: string;
        actor_user_id: string | null;
        event_body: { oldMaxProviderSubmissions?: number; newMaxProviderSubmissions?: number };
      }[]>`
        SELECT event_type, reason, actor_user_id, event_body
          FROM certification_commercial_events
         WHERE certification_scope_id = ${seeded.scope.certificationScopeId}
           AND event_type = 'SUBMISSION_QUOTA_AMENDED'
      `;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event_type: "SUBMISSION_QUOTA_AMENDED",
        reason: PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON,
        actor_user_id: seeded.actorUserId,
        event_body: {
          oldMaxProviderSubmissions: 1,
          newMaxProviderSubmissions: 2,
        },
      });
    } finally {
      await cleanup({
        orgId: seeded.orgId,
        workspaceId: seeded.workspaceId,
        ruleId: seeded.rule.providerUsdPricingRuleId,
        scopeId: seeded.scope.certificationScopeId,
      });
    }
  });
});

describeIntegration("Staging successor certification submission quota amendment", () => {
  let commercial: CertificationCommercialAuthorityService;
  let sql: Sql;

  beforeAll(() => {
    commercial = new CertificationCommercialAuthorityService();
    sql = createIntegrationSql();
  });

  afterAll(async () => {
    await closeDb();
    if (sql) await sql.end();
  });

  async function seedHistoricalScope() {
    const suffix = randomUUID().slice(0, 8);
    const orgId = randomUUID();
    const workspaceId = randomUUID();
    const actorUserId = randomUUID();
    const createdAt = "2026-09-19T16:00:00.000Z";
    await sql`
      INSERT INTO organizations (id, name, slug)
      VALUES (${orgId}, ${"Staging Quota Org"}, ${`staging-quota-${suffix}`})
    `;
    await sql`
      INSERT INTO workspaces (id, org_id, name, slug)
      VALUES (${workspaceId}, ${orgId}, ${"Staging Quota Workspace"}, ${`ws-staging-quota-${suffix}`})
    `;
    const provisioned = await commercial.provisionScope({
      environment: "STAGING",
      orgId,
      workspaceId,
      actorUserId,
      createdAt,
    });
    await sql.unsafe("SET session_replication_role = replica");
    try {
      await sql`
        UPDATE certification_commercial_scopes
           SET consumed_provider_submissions = 6,
               spent_provider_cost_usd = 1.07,
               reserved_provider_submissions = 0,
               reserved_provider_cost_usd = 0.00
         WHERE certification_scope_id = ${provisioned.scope.certificationScopeId}
      `;
      for (const index of [1, 2]) {
        const integrity = createHash("sha256").update(`${suffix}-${index}`).digest("hex");
        await sql`
          INSERT INTO certification_submission_slot_reconciliations (
            reconciliation_id, environment, org_id, workspace_id, certification_scope_id,
            scene_execution_id, dispatch_id, certification_reservation_id, source_consumption_event_id,
            outcome_classification, reason, actor_user_id, idempotency_key, evidence,
            quota_before, quota_after, integrity_hash, contract_version, created_at
          ) VALUES (
            ${randomUUID()}, 'STAGING', ${orgId}, ${workspaceId}, ${provisioned.scope.certificationScopeId},
            ${randomUUID()}, ${`dispatch-${suffix}-${index}`}, ${randomUUID()}, ${randomUUID()},
            'PROVEN_NOT_SUBMITTED', 'PROVEN_PROVIDER_NON_ACCEPTANCE_RECONCILIATION', ${actorUserId},
            ${`idem-${suffix}-${index}`}, ${sql.json({} as never)},
            ${sql.json({ consumed: 6 } as never)}, ${sql.json({ consumed: 6 } as never)},
            ${`sha256:${integrity}`}, 'certification-submission-slot-reconciliation.v1', now()
          )
        `;
      }
    } finally {
      await sql.unsafe("SET session_replication_role = origin");
    }
    return { orgId, workspaceId, actorUserId, scopeId: provisioned.scope.certificationScopeId };
  }

  async function cleanup(input: { orgId: string; workspaceId: string; scopeId: string }) {
    await sql.unsafe("SET session_replication_role = replica");
    try {
      await sql`DELETE FROM certification_submission_slot_reconciliations WHERE certification_scope_id = ${input.scopeId}`;
      await sql`DELETE FROM certification_commercial_events WHERE certification_scope_id = ${input.scopeId}`;
      await sql`DELETE FROM certification_commercial_scopes WHERE certification_scope_id = ${input.scopeId}`;
      await sql`DELETE FROM billing_accounts WHERE org_id = ${input.orgId}`;
      await sql`DELETE FROM workspaces WHERE id = ${input.workspaceId}`;
      await sql`DELETE FROM organizations WHERE id = ${input.orgId}`;
    } finally {
      await sql.unsafe("SET session_replication_role = origin");
    }
  }

  function amend(input: {
    orgId: string; workspaceId: string; scopeId: string; actorUserId: string;
    reason?: string; environment?: "STAGING" | "PRODUCTION"; max?: number; capabilityKey?: "ai_story.execute";
  }) {
    return commercial.amendActiveStagingSubmissionQuota({
      environment: input.environment ?? "STAGING",
      certificationScopeId: input.scopeId,
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      capabilityKey: input.capabilityKey ?? "ai_story.execute",
      actorUserId: input.actorUserId,
      humanAuthorizationReason: input.reason ?? STAGING_BOUNDED_SUCCESSOR_SEEDANCE_CERTIFICATION_QUOTA_AMENDMENT_REASON,
      amendedAt: "2026-09-28T06:30:00.000Z",
      maxProviderSubmissions: input.max ?? 9,
    });
  }

  it("amends the active staging scope from 4 to 9 without resetting historical usage", async () => {
    const seeded = await seedHistoricalScope();
    try {
      await expect(amend({ ...seeded, reason: PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON }))
        .rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_AMENDMENT_DENIED" });
      await expect(amend({ ...seeded, reason: "unknown authorization" }))
        .rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_AMENDMENT_DENIED" });
      await expect(amend({ ...seeded, environment: "PRODUCTION" }))
        .rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_AMENDMENT_DENIED" });
      await expect(amend({ ...seeded, max: 3 }))
        .rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_AMENDMENT_DENIED" });
      await expect(amend({ ...seeded, max: 14 }))
        .rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_AMENDMENT_DENIED" });
      await expect(amend({ ...seeded, orgId: randomUUID() }))
        .rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_MISMATCH" });
      await expect(amend({ ...seeded, workspaceId: randomUUID() }))
        .rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_MISMATCH" });
      await expect(amend({ ...seeded, scopeId: randomUUID() }))
        .rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_MISSING" });

      const first = await amend(seeded);
      expect(first.replayed).toBe(false);
      expect(first.scope.maxProviderSubmissions).toBe(9);
      expect(first.scope.consumedProviderSubmissions).toBe(6);
      expect(first.scope.reservedProviderSubmissions).toBe(0);
      expect(first.scope.spentProviderCostUsd).toBe("1.07");
      expect(first.scope.reservedProviderCostUsd).toBe("0.00");
      expect(first.scope.maxProviderCostUsd).toBe("5.00");
      expect(first.scope.status).toBe("ACTIVE");

      const reconciliations = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count
          FROM certification_submission_slot_reconciliations
         WHERE certification_scope_id = ${seeded.scopeId}
      `;
      expect(reconciliations[0]?.count).toBe(2);

      const replay = await amend(seeded);
      expect(replay.replayed).toBe(true);
      expect(replay.scope.maxProviderSubmissions).toBe(9);
      expect(replay.scope.integrityHash).toBe(first.scope.integrityHash);

      const events = await sql<{ event_body: Record<string, unknown> }[]>`
        SELECT event_body FROM certification_commercial_events
         WHERE certification_scope_id = ${seeded.scopeId}
           AND event_type = 'SUBMISSION_QUOTA_AMENDED'
      `;
      expect(events).toHaveLength(1);
      expect(events[0]?.event_body).toMatchObject({
        environment: "STAGING",
        oldMaxProviderSubmissions: 4,
        newMaxProviderSubmissions: 9,
        effectiveConsumedAtAmendment: 4,
        authorizedAdditionalSubmissions: 5,
        reason: STAGING_BOUNDED_SUCCESSOR_SEEDANCE_CERTIFICATION_QUOTA_AMENDMENT_REASON,
        actorUserId: seeded.actorUserId,
        occurredAt: "2026-09-28T06:30:00.000Z",
      });
      await expect(amend({ ...seeded, max: 8 }))
        .rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_AMENDMENT_DENIED" });

      await sql`
        UPDATE certification_commercial_scopes
           SET status = 'REVOKED'
         WHERE certification_scope_id = ${seeded.scopeId}
      `;
      await expect(amend({ ...seeded, max: 9 })).rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_INACTIVE" });
    } finally {
      await cleanup(seeded);
    }
  });
});
