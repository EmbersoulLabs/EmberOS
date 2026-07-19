import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql } from "postgres";
import {
  RUN_DB_INTEGRATION,
  getIntegrationDbUrl,
  createIntegrationSql,
  isRlsEnabled,
  withAuthenticatedUser,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

interface BpRlsFixture {
  orgAId: string;
  orgBId: string;
  workspaceAId: string;
  workspaceBId: string;
  userAId: string;
  userBId: string;
  profileAId: string;
  profileBId: string;
  suffix: string;
}

async function seedBusinessProfileRlsFixture(sql: Sql): Promise<BpRlsFixture> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const orgAId = crypto.randomUUID();
  const orgBId = crypto.randomUUID();
  const workspaceAId = crypto.randomUUID();
  const workspaceBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();
  const profileAId = crypto.randomUUID();
  const profileBId = crypto.randomUUID();

  await sql`
    INSERT INTO organizations (id, name, slug)
    VALUES
      (${orgAId}, ${"BP RLS Org A"}, ${`bp-rls-a-${suffix}`}),
      (${orgBId}, ${"BP RLS Org B"}, ${`bp-rls-b-${suffix}`})
  `;

  await sql`
    INSERT INTO workspaces (id, org_id, name, slug)
    VALUES
      (${workspaceAId}, ${orgAId}, ${"BP WS A"}, ${`bp-ws-a-${suffix}`}),
      (${workspaceBId}, ${orgBId}, ${"BP WS B"}, ${`bp-ws-b-${suffix}`})
  `;

  await sql`
    INSERT INTO workspace_members (org_id, workspace_id, user_id, role)
    VALUES
      (${orgAId}, ${workspaceAId}, ${userAId}, ${"admin"}),
      (${orgBId}, ${workspaceBId}, ${userBId}, ${"admin"})
  `;

  await sql`
    INSERT INTO business_profiles (id, org_id, workspace_id, company_name, version)
    VALUES
      (${profileAId}, ${orgAId}, ${workspaceAId}, ${"Company A"}, 1),
      (${profileBId}, ${orgBId}, ${workspaceBId}, ${"Company B"}, 1)
  `;

  return {
    orgAId,
    orgBId,
    workspaceAId,
    workspaceBId,
    userAId,
    userBId,
    profileAId,
    profileBId,
    suffix,
  };
}

async function cleanupBusinessProfileRlsFixture(sql: Sql, fixture: BpRlsFixture): Promise<void> {
  await sql`DELETE FROM business_profiles WHERE id IN (${fixture.profileAId}, ${fixture.profileBId})`;
  await sql`DELETE FROM workspace_members WHERE user_id IN (${fixture.userAId}, ${fixture.userBId})`;
  await sql`DELETE FROM workspaces WHERE id IN (${fixture.workspaceAId}, ${fixture.workspaceBId})`;
  await sql`DELETE FROM organizations WHERE id IN (${fixture.orgAId}, ${fixture.orgBId})`;
}

describeIntegration("business_profiles RLS (DB integration)", () => {
  let sql: Sql;
  let fixture: BpRlsFixture;

  beforeAll(async () => {
    sql = createIntegrationSql();

    const rlsOn = await isRlsEnabled(sql, "business_profiles");
    if (!rlsOn) {
      throw new Error(
        "RLS is not enabled on business_profiles. Run: pnpm db:rls (or apply packages/db/sql/rls.sql)."
      );
    }

    fixture = await seedBusinessProfileRlsFixture(sql);
  }, 30_000);

  afterAll(async () => {
    if (sql && fixture) {
      await cleanupBusinessProfileRlsFixture(sql, fixture);
      await sql.end();
    }
  }, 30_000);

  it("authorized member can SELECT own workspace Business Profile", async () => {
    const rows = await withAuthenticatedUser(sql, fixture.userAId, async (tx) => {
      return tx<{ id: string; company_name: string }[]>`
        SELECT id, company_name FROM business_profiles WHERE workspace_id = ${fixture.workspaceAId}
      `;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(fixture.profileAId);
    expect(rows[0]!.company_name).toBe("Company A");
  });

  it("Org A user cannot read Org B Business Profile", async () => {
    const rows = await withAuthenticatedUser(sql, fixture.userAId, async (tx) => {
      return tx<{ id: string }[]>`
        SELECT id FROM business_profiles WHERE id = ${fixture.profileBId}
      `;
    });
    expect(rows).toHaveLength(0);
  });

  it("Org A user cannot INSERT using Org B org_id", async () => {
    const rogueId = crypto.randomUUID();
    await expect(
      withAuthenticatedUser(sql, fixture.userAId, async (tx) => {
        return tx`
          INSERT INTO business_profiles (id, org_id, workspace_id, company_name, version)
          VALUES (${rogueId}, ${fixture.orgBId}, ${fixture.workspaceAId}, ${"Forged Org"}, 1)
        `;
      })
    ).rejects.toThrow();
  });

  it("Org A user cannot INSERT using unauthorized Workspace ID", async () => {
    const rogueId = crypto.randomUUID();
    await expect(
      withAuthenticatedUser(sql, fixture.userAId, async (tx) => {
        return tx`
          INSERT INTO business_profiles (id, org_id, workspace_id, company_name, version)
          VALUES (${rogueId}, ${fixture.orgBId}, ${fixture.workspaceBId}, ${"Forged WS"}, 1)
        `;
      })
    ).rejects.toThrow();
  });

  it("Org A user cannot UPDATE Org B Business Profile", async () => {
    const updated = await withAuthenticatedUser(sql, fixture.userAId, async (tx) => {
      return tx<{ id: string }[]>`
        UPDATE business_profiles
        SET company_name = ${"Hacked"}
        WHERE id = ${fixture.profileBId}
        RETURNING id
      `;
    });
    expect(updated).toHaveLength(0);

    const [row] = await sql<{ company_name: string }[]>`
      SELECT company_name FROM business_profiles WHERE id = ${fixture.profileBId}
    `;
    expect(row?.company_name).toBe("Company B");
  });

  it("Org A user cannot reassign profile to Org B tenant", async () => {
    // USING allows the owned row; WITH CHECK rejects the unauthorized new tenant.
    await expect(
      withAuthenticatedUser(sql, fixture.userAId, async (tx) => {
        return tx`
          UPDATE business_profiles
          SET org_id = ${fixture.orgBId}, workspace_id = ${fixture.workspaceBId}
          WHERE id = ${fixture.profileAId}
          RETURNING id
        `;
      })
    ).rejects.toThrow(/row-level security policy/i);

    const [row] = await sql<{ org_id: string; workspace_id: string }[]>`
      SELECT org_id, workspace_id FROM business_profiles WHERE id = ${fixture.profileAId}
    `;
    expect(row?.org_id).toBe(fixture.orgAId);
    expect(row?.workspace_id).toBe(fixture.workspaceAId);
  });

  it("Org A user cannot DELETE Org B Business Profile", async () => {
    const deleted = await withAuthenticatedUser(sql, fixture.userAId, async (tx) => {
      return tx<{ id: string }[]>`
        DELETE FROM business_profiles WHERE id = ${fixture.profileBId} RETURNING id
      `;
    });
    expect(deleted).toHaveLength(0);

    const [row] = await sql<{ id: string }[]>`
      SELECT id FROM business_profiles WHERE id = ${fixture.profileBId}
    `;
    expect(row?.id).toBe(fixture.profileBId);
  });

  it("Org A user cannot soft-delete Org B Business Profile via UPDATE", async () => {
    const updated = await withAuthenticatedUser(sql, fixture.userAId, async (tx) => {
      return tx<{ id: string }[]>`
        UPDATE business_profiles
        SET deleted_at = now()
        WHERE id = ${fixture.profileBId}
        RETURNING id
      `;
    });
    expect(updated).toHaveLength(0);
  });
});
