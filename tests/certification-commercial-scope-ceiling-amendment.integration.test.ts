import { randomUUID } from "node:crypto";
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
  PRODUCTION_SETTLEMENT_CEILING_AMENDMENT_REASON,
  ProviderUsdPricingRuleSchema,
  buildBillingAccount,
  settleProviderCostUsdFromCompletionTokens,
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
const amendment = readFileSync(
  resolve(process.cwd(), "packages/db/sql/certification-commercial-ceiling-amendment-v1.sql"),
  "utf8"
);
const schemaName = `cert_ceiling_${randomUUID().replaceAll("-", "")}`;

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

describeIntegration("Production commercial ceiling amendment SQL", () => {
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

  it("accepts CEILING_AMENDED events only after the bounded amendment migration", async () => {
    await sql.unsafe(`SET search_path TO ${schemaName}, public; ${predecessor}`);
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
        0.27,1,0,0.27,1,0,'${randomUUID()}','test',now(),'hash-scope-ceiling','1','{}'
      )
    `);
    const before = sql.unsafe(`
      INSERT INTO certification_commercial_events(
        certification_commercial_event_id,certification_scope_id,event_type,reason,occurred_at,integrity_hash,event_body
      ) VALUES (
        '${randomUUID()}','${scopeId}','CEILING_AMENDED','Human-authorized Production settlement ceiling amendment',now(),'hash-event-denied','{}'
      )
    `);
    await expect(before).rejects.toThrow();
    await sql.unsafe(`SET search_path TO ${schemaName}, public; ${amendment}`);
    await sql.unsafe(`
      INSERT INTO certification_commercial_events(
        certification_commercial_event_id,certification_scope_id,event_type,reason,occurred_at,integrity_hash,event_body
      ) VALUES (
        '${randomUUID()}','${scopeId}','CEILING_AMENDED','Human-authorized Production settlement ceiling amendment',now(),'hash-event-amended','{}'
      )
    `);
    const rows = await sql<{ event_type: string }[]>`
      SELECT event_type FROM certification_commercial_events WHERE certification_scope_id = ${scopeId}
    `;
    expect(rows.map((row) => row.event_type)).toEqual(["CEILING_AMENDED"]);
  });
});

describeIntegration("Production commercial ceiling amendment service", () => {
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
      VALUES (${orgId}, ${"Settlement Org"}, ${`settle-${suffix}`})
    `;
    await sql`
      INSERT INTO workspaces (id, org_id, name, slug)
      VALUES (${workspaceId}, ${orgId}, ${"Settlement Workspace"}, ${`ws-settle-${suffix}`})
    `;
    await new BillingAccountRepositoryImpl().createOrConverge(buildBillingAccount({
      orgId,
      createdAt,
      identitySeed: `settlement-billing:${orgId}`,
    }));
    const rule = pricingRule({
      ruleId: randomUUID(),
      createdBy: actorUserId,
      version: `settlement-${suffix}`,
      createdAt,
    });
    await commercial.provisionPrice(rule);
    const provisioned = await commercial.provisionScope({
      environment: "PRODUCTION",
      orgId,
      workspaceId,
      actorUserId,
      createdAt,
      maxProviderCostUsd: "0.35",
      maxProviderSubmissions: 1,
    });
    return { orgId, workspaceId, actorUserId, createdAt, rule, scope: provisioned.scope };
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

  it("amends an ACTIVE Production scope ceiling upward, cost-only, and is idempotent", async () => {
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
      const actual = settleProviderCostUsdFromCompletionTokens(60_000, seeded.rule.usdPerMillionTokens);
      expect(actual).toBe("0.42");
      await expect(commercial.settleFromProviderUsage({
        reservationId: reserved.reservation.certificationReservationId,
        completionTokens: 60_000,
        settledAt: "2026-09-19T16:20:00.000Z",
      })).rejects.toMatchObject({
        name: "CertificationCommercialError",
        code: "CERTIFICATION_BUDGET_EXCEEDED",
      });

      await expect(commercial.amendActiveProductionScopeCeiling({
        environment: "STAGING",
        certificationScopeId: seeded.scope.certificationScopeId,
        orgId: seeded.orgId,
        workspaceId: seeded.workspaceId,
        actorUserId: seeded.actorUserId,
        amendedAt: "2026-09-19T16:21:00.000Z",
        maxProviderCostUsd: actual,
      })).rejects.toBeInstanceOf(CertificationCommercialError);

      await expect(commercial.amendActiveProductionScopeCeiling({
        environment: "PRODUCTION",
        certificationScopeId: seeded.scope.certificationScopeId,
        orgId: seeded.orgId,
        workspaceId: seeded.workspaceId,
        actorUserId: seeded.actorUserId,
        amendedAt: "2026-09-19T16:21:00.000Z",
        maxProviderCostUsd: "0.10",
      })).rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_AMENDMENT_DENIED" });

      await expect(commercial.amendActiveProductionScopeCeiling({
        environment: "PRODUCTION",
        certificationScopeId: seeded.scope.certificationScopeId,
        orgId: seeded.orgId,
        workspaceId: seeded.workspaceId,
        actorUserId: seeded.actorUserId,
        amendedAt: "2026-09-19T16:21:00.000Z",
        maxProviderCostUsd: actual,
        maxProviderSubmissions: 2,
      })).rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_AMENDMENT_DENIED" });

      const first = await commercial.amendActiveProductionScopeCeiling({
        environment: "PRODUCTION",
        certificationScopeId: seeded.scope.certificationScopeId,
        orgId: seeded.orgId,
        workspaceId: seeded.workspaceId,
        actorUserId: seeded.actorUserId,
        amendedAt: "2026-09-19T16:21:00.000Z",
        maxProviderCostUsd: actual,
        maxProviderSubmissions: 1,
      });
      expect(first.replayed).toBe(false);
      expect(first.scope.maxProviderCostUsd).toBe(actual);
      expect(first.scope.maxProviderSubmissions).toBe(1);
      expect(first.scope.spentProviderCostUsd).toBe(seeded.scope.spentProviderCostUsd);
      expect(first.scope.reservedProviderCostUsd).toBe(reserved.scope.reservedProviderCostUsd);
      expect(first.scope.consumedProviderSubmissions).toBe(1);
      expect(first.scope.reservedProviderSubmissions).toBe(0);
      expect(first.scope.certificationScopeId).toBe(seeded.scope.certificationScopeId);

      const replay = await commercial.amendActiveProductionScopeCeiling({
        environment: "PRODUCTION",
        certificationScopeId: seeded.scope.certificationScopeId,
        orgId: seeded.orgId,
        workspaceId: seeded.workspaceId,
        actorUserId: seeded.actorUserId,
        amendedAt: "2026-09-19T16:22:00.000Z",
        maxProviderCostUsd: actual,
      });
      expect(replay.replayed).toBe(true);
      expect(replay.scope.integrityHash).toBe(first.scope.integrityHash);

      const settled = await commercial.settleFromProviderUsage({
        reservationId: reserved.reservation.certificationReservationId,
        completionTokens: 60_000,
        settledAt: "2026-09-19T16:23:00.000Z",
      });
      expect(settled.replayed).toBe(false);
      expect(settled.reservation.status).toBe("SETTLED");
      expect(settled.reservation.certificationReservationId).toBe(
        reserved.reservation.certificationReservationId
      );
      expect(settled.reservation.settledCostUsd).toBe(actual);

      const settledAgain = await commercial.settleFromProviderUsage({
        reservationId: reserved.reservation.certificationReservationId,
        completionTokens: 60_000,
        settledAt: "2026-09-19T16:24:00.000Z",
      });
      expect(settledAgain.replayed).toBe(true);
      expect(settledAgain.reservation.settledCostUsd).toBe(actual);

      const scope = await commercial.getActiveScope("PRODUCTION", seeded.orgId, seeded.workspaceId);
      expect(scope?.spentProviderCostUsd).toBe(actual);
      expect(scope?.reservedProviderCostUsd).toBe("0.00");
      expect(scope?.consumedProviderSubmissions).toBe(1);
      expect(scope?.reservedProviderSubmissions).toBe(0);
      expect(scope?.maxProviderSubmissions).toBe(1);

      const events = await sql<{ event_type: string; reason: string }[]>`
        SELECT event_type, reason
          FROM certification_commercial_events
         WHERE certification_scope_id = ${seeded.scope.certificationScopeId}
         ORDER BY occurred_at, event_type
      `;
      expect(events.filter((row) => row.event_type === "CEILING_AMENDED")).toEqual([
        {
          event_type: "CEILING_AMENDED",
          reason: PRODUCTION_SETTLEMENT_CEILING_AMENDMENT_REASON,
        },
      ]);
    } finally {
      await cleanup({
        orgId: seeded.orgId,
        workspaceId: seeded.workspaceId,
        ruleId: seeded.rule.providerUsdPricingRuleId,
        scopeId: seeded.scope.certificationScopeId,
      });
    }
  });

  for (const quota of [2, 3, 4] as const) {
    it(`amends Production ceiling upward when maxProviderSubmissions is ${quota}`, async () => {
      const suffix = randomUUID().slice(0, 8);
      const orgId = randomUUID();
      const workspaceId = randomUUID();
      const actorUserId = randomUUID();
      const createdAt = "2026-09-20T12:00:00.000Z";
      await sql`
        INSERT INTO organizations (id, name, slug)
        VALUES (${orgId}, ${"Quota Ceiling Org"}, ${`qceil-${suffix}`})
      `;
      await sql`
        INSERT INTO workspaces (id, org_id, name, slug)
        VALUES (${workspaceId}, ${orgId}, ${"Quota Ceiling Workspace"}, ${`ws-qceil-${suffix}`})
      `;
      await new BillingAccountRepositoryImpl().createOrConverge(buildBillingAccount({
        orgId,
        createdAt,
        identitySeed: `quota-ceiling-billing:${orgId}`,
      }));
      const rule = pricingRule({
        ruleId: randomUUID(),
        createdBy: actorUserId,
        version: `quota-ceiling-${suffix}`,
        createdAt,
      });
      const commercial = new CertificationCommercialAuthorityService();
      await commercial.provisionPrice(rule);
      const provisioned = await commercial.provisionScope({
        environment: "PRODUCTION",
        orgId,
        workspaceId,
        actorUserId,
        createdAt,
        maxProviderCostUsd: "0.58",
        maxProviderSubmissions: quota,
      });
      try {
        const reserved = await commercial.reserve({
          environment: "PRODUCTION",
          orgId,
          workspaceId,
          executionIdentity: `quota-${quota}-reservation`,
          pricingRule: rule,
          createdAt,
          claimSubmission: true,
        });
        const before = {
          spent: reserved.scope.spentProviderCostUsd,
          reservedCost: reserved.scope.reservedProviderCostUsd,
          consumed: reserved.scope.consumedProviderSubmissions,
          reservedSlots: reserved.scope.reservedProviderSubmissions,
          quota: reserved.scope.maxProviderSubmissions,
          reservationId: reserved.reservation.certificationReservationId,
          reservationStatus: reserved.reservation.status,
        };
        const amended = await commercial.amendActiveProductionScopeCeiling({
          environment: "PRODUCTION",
          certificationScopeId: provisioned.scope.certificationScopeId,
          orgId,
          workspaceId,
          actorUserId,
          amendedAt: "2026-09-20T12:05:00.000Z",
          maxProviderCostUsd: "1.16",
          maxProviderSubmissions: quota,
        });
        expect(amended.replayed).toBe(false);
        expect(amended.scope.maxProviderCostUsd).toBe("1.16");
        expect(amended.scope.maxProviderSubmissions).toBe(quota);
        expect(amended.scope.spentProviderCostUsd).toBe(before.spent);
        expect(amended.scope.reservedProviderCostUsd).toBe(before.reservedCost);
        expect(amended.scope.consumedProviderSubmissions).toBe(before.consumed);
        expect(amended.scope.reservedProviderSubmissions).toBe(before.reservedSlots);

        await expect(commercial.amendActiveProductionScopeCeiling({
          environment: "PRODUCTION",
          certificationScopeId: provisioned.scope.certificationScopeId,
          orgId,
          workspaceId,
          actorUserId,
          amendedAt: "2026-09-20T12:06:00.000Z",
          maxProviderCostUsd: "1.16",
          maxProviderSubmissions: quota + 1,
        })).rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_AMENDMENT_DENIED" });

        await expect(commercial.amendActiveProductionScopeCeiling({
          environment: "PRODUCTION",
          certificationScopeId: provisioned.scope.certificationScopeId,
          orgId,
          workspaceId,
          actorUserId,
          amendedAt: "2026-09-20T12:07:00.000Z",
          maxProviderCostUsd: "0.10",
        })).rejects.toMatchObject({ code: "CERTIFICATION_SCOPE_AMENDMENT_DENIED" });

        const replay = await commercial.amendActiveProductionScopeCeiling({
          environment: "PRODUCTION",
          certificationScopeId: provisioned.scope.certificationScopeId,
          orgId,
          workspaceId,
          actorUserId,
          amendedAt: "2026-09-20T12:08:00.000Z",
          maxProviderCostUsd: "1.16",
        });
        expect(replay.replayed).toBe(true);
        expect(replay.scope.integrityHash).toBe(amended.scope.integrityHash);

        const reservations = await sql<{
          certification_reservation_id: string; status: string;
        }[]>`
          SELECT certification_reservation_id::text, status
            FROM certification_commercial_reservations
           WHERE certification_scope_id = ${provisioned.scope.certificationScopeId}
        `;
        expect(reservations).toEqual([{
          certification_reservation_id: before.reservationId,
          status: before.reservationStatus,
        }]);
        const events = await sql<{ event_type: string; reason: string }[]>`
          SELECT event_type, reason
            FROM certification_commercial_events
           WHERE certification_scope_id = ${provisioned.scope.certificationScopeId}
             AND event_type = 'CEILING_AMENDED'
        `;
        expect(events).toEqual([{
          event_type: "CEILING_AMENDED",
          reason: PRODUCTION_SETTLEMENT_CEILING_AMENDMENT_REASON,
        }]);
      } finally {
        await cleanup({
          orgId,
          workspaceId,
          ruleId: rule.providerUsdPricingRuleId,
          scopeId: provisioned.scope.certificationScopeId,
        });
      }
    });
  }
});
