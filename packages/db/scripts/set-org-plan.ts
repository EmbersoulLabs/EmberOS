/**
 * Set organization plan (e.g. pro for 1080p export testing).
 * Usage: pnpm --filter @ceo-agent/db exec tsx scripts/set-org-plan.ts pro
 *        pnpm --filter @ceo-agent/db exec tsx scripts/set-org-plan.ts pro --slug=my-org
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(__dirname, "../../../apps/worker/.env") });
config({ path: resolve(__dirname, "../../../.env.local") });

const plan = process.argv[2] ?? "pro";
const slugArg = process.argv.find((a) => a.startsWith("--slug="));
const slug = slugArg?.split("=")[1];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const db = postgres(url, { max: 1 });

try {
  const rows = slug
    ? await db<{ id: string; name: string; slug: string; plan: string }[]>`
        UPDATE organizations SET plan = ${plan}
        WHERE slug = ${slug}
        RETURNING id, name, slug, plan
      `
    : await db<{ id: string; name: string; slug: string; plan: string }[]>`
        UPDATE organizations SET plan = ${plan}
        RETURNING id, name, slug, plan
      `;

  if (rows.length === 0) {
    console.error(slug ? `No organization found with slug=${slug}` : "No organizations in database");
    process.exit(1);
  }

  console.log(`Updated ${rows.length} organization(s) to plan="${plan}":`);
  for (const row of rows) {
    console.log(`  - ${row.name} (${row.slug}) id=${row.id}`);
  }
} catch (err) {
  console.error("Failed:", err);
  process.exit(1);
} finally {
  await db.end();
}
