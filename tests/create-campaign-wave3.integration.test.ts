import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { RUN_DB_INTEGRATION, createIntegrationSql, getIntegrationDbUrl } from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

describeIntegration("Wave 3 Create Campaign PostgreSQL contract", () => {
  let sql: Sql;
  const orgId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();
  const suffix = crypto.randomUUID().slice(0, 8);

  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${orgId}, 'Wave 3 Org', ${`wave3-org-${suffix}`})`;
    await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${workspaceId}, ${orgId}, 'Wave 3 Workspace', ${`wave3-ws-${suffix}`})`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM campaigns WHERE workspace_id = ${workspaceId}`;
    await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
    await sql`DELETE FROM organizations WHERE id = ${orgId}`;
    await sql.end();
  });

  it("persists typed Campaign context without rewriting identity", async () => {
    const targetAudience = { summary: "Gift buyers", demographics: [], interests: ["flowers"], needs: [], locations: ["Singapore"] };
    const [row] = await sql<{ id: string; objective: string; target_audience: typeof targetAudience }[]>`
      INSERT INTO campaigns (
        id, org_id, workspace_id, name, objective, platforms,
        target_audience, creation_idempotency_key
      ) VALUES (
        ${campaignId}, ${orgId}, ${workspaceId}, 'Wave 3 Campaign', 'awareness',
        ${sql.array(["tiktok", "instagram"])}, ${sql.json(targetAudience)}, ${idempotencyKey}
      ) RETURNING id, objective, target_audience
    `;
    expect(row).toEqual({ id: campaignId, objective: "awareness", target_audience: targetAudience });
  });

  it("enforces one Campaign per Workspace idempotency key", async () => {
    await expect(sql`
      INSERT INTO campaigns (
        org_id, workspace_id, name, platforms, creation_idempotency_key
      ) VALUES (${orgId}, ${workspaceId}, 'Duplicate', ${sql.array(["tiktok"])}, ${idempotencyKey})
    `).rejects.toMatchObject({ code: "23505" });
  });
});
