import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

describeIntegration("Wave 2 Business Profile PostgreSQL contract", () => {
  let sql: Sql;
  const orgId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const suffix = crypto.randomUUID().slice(0, 8);

  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${orgId}, 'Wave 2 Org', ${`wave2-org-${suffix}`})`;
    await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${workspaceId}, ${orgId}, 'Wave 2 Workspace', ${`wave2-ws-${suffix}`})`;
    await sql`INSERT INTO business_profiles (id, org_id, workspace_id, company_name) VALUES (${profileId}, ${orgId}, ${workspaceId}, 'Wave 2 Company')`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM business_profiles WHERE id = ${profileId}`;
    await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
    await sql`DELETE FROM organizations WHERE id = ${orgId}`;
    await sql.end();
  });

  it("gives legacy rows a backward-safe empty platform list", async () => {
    const [row] = await sql<{ default_publishing_platforms: string[] }[]>`
      SELECT default_publishing_platforms FROM business_profiles WHERE id = ${profileId}
    `;
    expect(row?.default_publishing_platforms).toEqual([]);
  });

  it("persists typed platform values without rewriting profile identity", async () => {
    const [row] = await sql<{ id: string; default_publishing_platforms: string[] }[]>`
      UPDATE business_profiles
      SET default_publishing_platforms = ${sql.array(["tiktok", "instagram"])},
          version = version + 1
      WHERE id = ${profileId}
      RETURNING id, default_publishing_platforms
    `;
    expect(row).toEqual({
      id: profileId,
      default_publishing_platforms: ["tiktok", "instagram"],
    });
  });

  it("allows only one optimistic update for a stale version", async () => {
    const [{ version }] = await sql<{ version: number }[]>`
      SELECT version FROM business_profiles WHERE id = ${profileId}
    `;
    const first = await sql`
      UPDATE business_profiles SET company_name = 'Newest', version = version + 1
      WHERE id = ${profileId} AND version = ${version} RETURNING id
    `;
    const stale = await sql`
      UPDATE business_profiles SET company_name = 'Stale', version = version + 1
      WHERE id = ${profileId} AND version = ${version} RETURNING id
    `;
    expect(first).toHaveLength(1);
    expect(stale).toHaveLength(0);
  });
});
