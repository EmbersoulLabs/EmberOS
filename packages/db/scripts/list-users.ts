/**
 * List registered Supabase auth users and org memberships.
 * Usage: pnpm --filter @ceo-agent/db exec tsx scripts/list-users.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(__dirname, "../../../apps/worker/.env") });
config({ path: resolve(__dirname, "../../../.env.local") });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const db = postgres(url, { max: 1 });

try {
  const users = await db<
    { id: string; email: string | null; created_at: Date; last_sign_in_at: Date | null }[]
  >`SELECT id, email, created_at, last_sign_in_at FROM auth.users ORDER BY created_at`;

  const orgs = await db<
    { user_id: string; org_name: string; slug: string; role: string }[]
  >`
    SELECT om.user_id, o.name AS org_name, o.slug, om.role
    FROM organization_members om
    JOIN organizations o ON o.id = om.org_id
  `;

  if (users.length === 0) {
    console.log("No users registered yet.");
    process.exit(0);
  }

  console.log(`Found ${users.length} account(s):\n`);
  for (const u of users) {
    const memberships = orgs.filter((m) => m.user_id === u.id);
    console.log(`Email: ${u.email ?? "(none)"}`);
    console.log(`  ID: ${u.id}`);
    console.log(`  Created: ${u.created_at.toISOString()}`);
    console.log(`  Last sign-in: ${u.last_sign_in_at?.toISOString() ?? "never"}`);
    if (memberships.length > 0) {
      console.log(`  Orgs: ${memberships.map((m) => `${m.org_name} (${m.role})`).join(", ")}`);
    }
    console.log("");
  }
} catch (err) {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await db.end();
}
