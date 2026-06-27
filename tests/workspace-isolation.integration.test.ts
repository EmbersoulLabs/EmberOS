import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql } from "postgres";
import {
  RUN_DB_INTEGRATION,
  getIntegrationDbUrl,
  createIntegrationSql,
  isRlsEnabled,
  withAuthenticatedUser,
  seedRlsFixture,
  cleanupRlsFixture,
  type RlsTestFixture,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

describeIntegration("workspace isolation (DB / RLS integration)", () => {
  let sql: Sql;
  let fixture: RlsTestFixture;

  beforeAll(async () => {
    sql = createIntegrationSql();

    const rlsOn = await isRlsEnabled(sql, "campaigns");
    if (!rlsOn) {
      throw new Error(
        "RLS is not enabled on campaigns. Run: pnpm db:rls (or apply packages/db/sql/rls.sql in Supabase)."
      );
    }

    fixture = await seedRlsFixture(sql);
  }, 30_000);

  afterAll(async () => {
    if (sql && fixture) {
      await cleanupRlsFixture(sql, fixture);
      await sql.end();
    }
  }, 30_000);

  it("user A sees only workspace A campaigns", async () => {
    const rows = await withAuthenticatedUser(sql, fixture.userAId, async (tx) => {
      return tx<{ id: string; workspace_id: string }[]>`
        SELECT id, workspace_id FROM campaigns ORDER BY name
      `;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(fixture.campaignAId);
    expect(rows[0]!.workspace_id).toBe(fixture.workspaceAId);
  });

  it("user B cannot read workspace A campaign by id", async () => {
    const rows = await withAuthenticatedUser(sql, fixture.userBId, async (tx) => {
      return tx<{ id: string }[]>`
        SELECT id FROM campaigns WHERE id = ${fixture.campaignAId}
      `;
    });

    expect(rows).toHaveLength(0);
  });

  it("user A cannot read workspace B campaign by id", async () => {
    const rows = await withAuthenticatedUser(sql, fixture.userAId, async (tx) => {
      return tx<{ id: string }[]>`
        SELECT id FROM campaigns WHERE id = ${fixture.campaignBId}
      `;
    });

    expect(rows).toHaveLength(0);
  });

  it("user A cannot update workspace B campaign", async () => {
    const updated = await withAuthenticatedUser(sql, fixture.userAId, async (tx) => {
      return tx<{ id: string }[]>`
        UPDATE campaigns
        SET name = ${"Hacked"}
        WHERE id = ${fixture.campaignBId}
        RETURNING id
      `;
    });

    expect(updated).toHaveLength(0);

    const [row] = await sql<{ name: string }[]>`
      SELECT name FROM campaigns WHERE id = ${fixture.campaignBId}
    `;
    expect(row?.name).toBe("Campaign B");
  });

  it("user A sees only their workspace in workspaces list", async () => {
    const rows = await withAuthenticatedUser(sql, fixture.userAId, async (tx) => {
      return tx<{ id: string }[]>`
        SELECT id FROM workspaces ORDER BY name
      `;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(fixture.workspaceAId);
  });

  it("service role (admin connection) sees both workspaces for the org", async () => {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM workspaces WHERE org_id = ${fixture.orgId} ORDER BY name
    `;
    expect(rows).toHaveLength(2);
  });
});
