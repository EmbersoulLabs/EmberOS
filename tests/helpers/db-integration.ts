import postgres, { type Sql } from "postgres";

/** Set RUN_DB_INTEGRATION_TESTS=1 and DATABASE_URL to run against real Postgres/Supabase. */
export const RUN_DB_INTEGRATION = process.env.RUN_DB_INTEGRATION_TESTS === "1";

export function getIntegrationDbUrl(): string | null {
  if (!RUN_DB_INTEGRATION) return null;
  return process.env.DATABASE_URL?.trim() || null;
}

export function createIntegrationSql(): Sql {
  const url = getIntegrationDbUrl();
  if (!url) {
    throw new Error("DATABASE_URL is required when RUN_DB_INTEGRATION_TESTS=1");
  }
  return postgres(url, { max: 1, prepare: false });
}

export async function isRlsEnabled(sql: Sql, table: string): Promise<boolean> {
  const rows = await sql<{ relrowsecurity: boolean }[]>`
    SELECT c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = ${table} AND n.nspname = 'public'
    LIMIT 1
  `;
  return rows[0]?.relrowsecurity === true;
}

/** Run queries as a Supabase authenticated user (RLS enforced). */
export async function withAuthenticatedUser<T>(
  sql: Sql,
  userId: string,
  fn: (tx: Sql) => Promise<T>
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL role = 'authenticated'`);
    await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', '${userId}', true)`);
    return fn(tx);
  });
}

export interface RlsTestFixture {
  orgId: string;
  workspaceAId: string;
  workspaceBId: string;
  userAId: string;
  userBId: string;
  campaignAId: string;
  campaignBId: string;
  orgSlug: string;
}

export async function seedRlsFixture(sql: Sql): Promise<RlsTestFixture> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const orgSlug = `rls-test-${suffix}`;
  const orgId = crypto.randomUUID();
  const workspaceAId = crypto.randomUUID();
  const workspaceBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();
  const campaignAId = crypto.randomUUID();
  const campaignBId = crypto.randomUUID();

  await sql`
    INSERT INTO organizations (id, name, slug)
    VALUES (${orgId}, ${"RLS Test Org"}, ${orgSlug})
  `;

  await sql`
    INSERT INTO workspaces (id, org_id, name, slug)
    VALUES
      (${workspaceAId}, ${orgId}, ${"Workspace A"}, ${`ws-a-${suffix}`}),
      (${workspaceBId}, ${orgId}, ${"Workspace B"}, ${`ws-b-${suffix}`})
  `;

  await sql`
    INSERT INTO workspace_members (org_id, workspace_id, user_id, role)
    VALUES
      (${orgId}, ${workspaceAId}, ${userAId}, ${"admin"}),
      (${orgId}, ${workspaceBId}, ${userBId}, ${"admin"})
  `;

  await sql`
    INSERT INTO campaigns (id, org_id, workspace_id, name, platforms, status)
    VALUES
      (${campaignAId}, ${orgId}, ${workspaceAId}, ${"Campaign A"}, ${["tiktok"]}, ${"draft"}),
      (${campaignBId}, ${orgId}, ${workspaceBId}, ${"Campaign B"}, ${["tiktok"]}, ${"draft"})
  `;

  return {
    orgId,
    workspaceAId,
    workspaceBId,
    userAId,
    userBId,
    campaignAId,
    campaignBId,
    orgSlug,
  };
}

export async function cleanupRlsFixture(sql: Sql, fixture: RlsTestFixture): Promise<void> {
  await sql`DELETE FROM campaigns WHERE org_id = ${fixture.orgId}`;
  await sql`DELETE FROM workspace_members WHERE org_id = ${fixture.orgId}`;
  await sql`DELETE FROM workspaces WHERE org_id = ${fixture.orgId}`;
  await sql`DELETE FROM organizations WHERE id = ${fixture.orgId}`;
}
