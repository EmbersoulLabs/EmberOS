import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BillingAccountRepositoryImpl,
  EntitlementRepositoryImpl,
  SubscriptionRepositoryImpl,
  closeDb,
} from "@ceo-agent/db";
import {
  effectiveProjectionHasCapability,
  type CapabilityKey,
} from "@ceo-agent/shared";
import {
  buildBillingAccount,
  buildEntitlementGrant,
  buildEntitlementRevocation,
  buildSubscriptionEvent,
  sha256CanonicalIntegrityHash,
} from "@ceo-agent/shared/server";
import {
  AiStoryAccessDeniedError,
  authorizeAiStoryAccess,
} from "../apps/web/src/lib/ai-story-access";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

vi.setConfig({ testTimeout: 30_000 });

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

type Fixture = {
  orgId: string;
  workspaceId: string;
  userId: string;
  plan: "free" | "pro" | "agency";
};

describeIntegration("RC-FIX-001 DB-backed AI Story access", () => {
  let sql: Sql;
  const suffix = crypto.randomUUID().slice(0, 8);
  const fixtures: Fixture[] = ["free", "pro", "agency", "free"].map((plan) => ({
    orgId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    plan: plan as Fixture["plan"],
  }));
  const [free, pro, agency, explicit] = fixtures;
  const outsider = crypto.randomUUID();
  const now = "2026-08-11T12:00:00.000Z";

  async function configurePlan(fixture: Fixture): Promise<void> {
    const billing = new BillingAccountRepositoryImpl();
    const account = buildBillingAccount({
      orgId: fixture.orgId,
      createdAt: "2026-08-11T10:00:00.000Z",
      identitySeed: `rc-fix-001:${fixture.orgId}`,
    });
    await billing.createOrConverge(account);
    const event = buildSubscriptionEvent({
      billingAccountId: account.billingAccountId,
      orgId: fixture.orgId,
      source: {
        provider: "rc-fix-001-test",
        externalSubscriptionId: `sub_${fixture.orgId}`,
        externalCustomerId: `cus_${fixture.orgId}`,
      },
      eventType: "ACTIVE",
      occurredAt: "2026-08-11T10:01:00.000Z",
      acceptedAt: "2026-08-11T10:01:00.000Z",
      payloadDigest: sha256CanonicalIntegrityHash({ fixture: fixture.orgId }),
    });
    const subscriptions = new SubscriptionRepositoryImpl();
    await subscriptions.acceptOrConvergeEvent(event);
    await subscriptions.rebuildProjectionFromEvent({
      event,
      planKey: fixture.plan,
      projectedAt: "2026-08-11T10:02:00.000Z",
    });
  }

  async function applyApprovedSql(relative: string): Promise<void> {
    await sql.unsafe(readFileSync(resolve(__dirname, relative), "utf8"));
  }

  async function authorize(fixture: Fixture, userId = fixture.userId) {
    return authorizeAiStoryAccess({
      user: { id: userId, email: `${userId}@example.test` },
      orgId: fixture.orgId,
      workspaceId: fixture.workspaceId,
      minRole: "client_viewer",
    });
  }

  async function addGrant(input: {
    fixture: Fixture;
    capability: CapabilityKey;
    expiresAt?: string;
    seed: string;
  }) {
    const grant = buildEntitlementGrant({
      orgId: input.fixture.orgId,
      workspaceId: input.fixture.workspaceId,
      capabilityKey: input.capability,
      source: "INTERNAL",
      reason: input.seed,
      grantedAt: "2026-08-11T11:00:00.000Z",
      expiresAt: input.expiresAt ?? null,
      identitySeed: input.seed,
    });
    await new EntitlementRepositoryImpl().acceptOrConvergeGrant(grant);
    return grant;
  }

  beforeAll(async () => {
    sql = createIntegrationSql();
    await applyApprovedSql("../packages/db/sql/commercial-persistence-v1.sql");
    await applyApprovedSql("../packages/db/sql/commercial-persistence-rls-v1.sql");
    await applyApprovedSql("../packages/db/sql/platform-admin-v1.sql");
    await applyApprovedSql("../packages/db/sql/platform-admin-rls-v1.sql");
    for (const fixture of fixtures) {
      await sql`
        INSERT INTO organizations (id, name, slug, plan)
        VALUES (
          ${fixture.orgId},
          ${`RC FIX 001 ${fixture.plan}`},
          ${`rc-fix-001-${fixture.plan}-${suffix}-${fixture.orgId.slice(0, 4)}`},
          ${fixture.plan}
        )
      `;
      await sql`
        INSERT INTO workspaces (id, org_id, name, slug)
        VALUES (
          ${fixture.workspaceId},
          ${fixture.orgId},
          ${`RC FIX 001 ${fixture.plan}`},
          ${`rc-fix-001-ws-${suffix}-${fixture.workspaceId.slice(0, 4)}`}
        )
      `;
      await sql`
        INSERT INTO workspace_members (org_id, workspace_id, user_id, role)
        VALUES (${fixture.orgId}, ${fixture.workspaceId}, ${fixture.userId}, 'admin')
      `;
      await configurePlan(fixture);
    }
  }, 120_000);

  afterAll(async () => {
    const orgIds = fixtures.map((fixture) => fixture.orgId);
    await sql`DELETE FROM effective_entitlement_projections WHERE org_id = ANY(${orgIds}::uuid[])`;
    await sql`DELETE FROM entitlement_revocations WHERE org_id = ANY(${orgIds}::uuid[])`;
    await sql`DELETE FROM entitlement_grants WHERE org_id = ANY(${orgIds}::uuid[])`;
    await sql`DELETE FROM subscription_projections WHERE org_id = ANY(${orgIds}::uuid[])`;
    await sql`DELETE FROM subscription_events WHERE org_id = ANY(${orgIds}::uuid[])`;
    await sql`DELETE FROM billing_accounts WHERE org_id = ANY(${orgIds}::uuid[])`;
    await sql`DELETE FROM workspace_members WHERE org_id = ANY(${orgIds}::uuid[])`;
    await sql`DELETE FROM workspaces WHERE org_id = ANY(${orgIds}::uuid[])`;
    await sql`DELETE FROM organizations WHERE id = ANY(${orgIds}::uuid[])`;
    await sql.end({ timeout: 5 });
    await closeDb();
  });

  it("denies Free and Pro but allows Agency through the real plan projection", async () => {
    await expect(authorize(free)).rejects.toBeInstanceOf(AiStoryAccessDeniedError);
    await expect(authorize(pro)).rejects.toBeInstanceOf(AiStoryAccessDeniedError);
    await expect(authorize(agency)).resolves.toEqual({
      allowedBy: "EFFECTIVE_ENTITLEMENT",
    });
  });

  it("denies outsiders, wrong workspaces, and wrong organizations", async () => {
    await expect(authorize(agency, outsider)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      authorizeAiStoryAccess({
        user: { id: agency.userId },
        orgId: agency.orgId,
        workspaceId: free.workspaceId,
        minRole: "client_viewer",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      authorizeAiStoryAccess({
        user: { id: agency.userId },
        orgId: free.orgId,
        workspaceId: agency.workspaceId,
        minRole: "client_viewer",
      })
    ).rejects.toBeInstanceOf(AiStoryAccessDeniedError);
  });

  it("supports explicit access, revocation, and expiry", async () => {
    const repo = new EntitlementRepositoryImpl();
    const access = await addGrant({
      fixture: explicit,
      capability: "ai_story.access",
      seed: `rc-fix-001-access-${suffix}`,
    });
    await expect(authorize(explicit)).resolves.toBeDefined();

    const projection = await repo.getEffectiveProjection({
      orgId: explicit.orgId,
      workspaceId: explicit.workspaceId,
    });
    expect(projection && effectiveProjectionHasCapability(projection, "ai_story.execute")).toBe(false);

    await repo.acceptOrConvergeRevocation(
      buildEntitlementRevocation({
        grant: access,
        reason: `rc-fix-001-revoke-${suffix}`,
        revokedByUserId: explicit.userId,
        revokedAt: "2026-08-11T11:30:00.000Z",
      })
    );
    await expect(authorize(explicit)).rejects.toBeInstanceOf(AiStoryAccessDeniedError);

    await addGrant({
      fixture: explicit,
      capability: "ai_story.access",
      expiresAt: "2026-08-11T11:59:59.000Z",
      seed: `rc-fix-001-expired-${suffix}`,
    });
    await expect(authorize(explicit)).rejects.toBeInstanceOf(AiStoryAccessDeniedError);
  });

  it("denies execute-only entitlement at the access boundary", async () => {
    await addGrant({
      fixture: explicit,
      capability: "ai_story.execute",
      seed: `rc-fix-001-execute-${suffix}`,
    });
    await expect(authorize(explicit)).rejects.toBeInstanceOf(AiStoryAccessDeniedError);
  });
});
