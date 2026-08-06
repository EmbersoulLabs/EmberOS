/**
 * Ensure workspace skipClientReview for Sprint 1 export path verification.
 * Does not change product defaults for other workspaces.
 *
 * Usage:
 *   npx tsx scripts/sprint1-enable-internal-review.ts
 *   E2E_WORKSPACE_SLUG=e2e-workspace npx tsx scripts/sprint1-enable-internal-review.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, ".env.e2e.local") });
config({ path: resolve(root, ".env.local") });

async function main() {
  const slug =
    process.env.E2E_WORKSPACE_SLUG?.trim() ||
    process.argv[2]?.trim() ||
    "e2e-workspace";
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [ws] = await sql`
      SELECT id, slug, settings FROM workspaces WHERE slug = ${slug} LIMIT 1
    `;
    if (!ws) throw new Error(`workspace slug=${slug} not found`);
    const settings =
      typeof ws.settings === "string"
        ? JSON.parse(ws.settings)
        : ((ws.settings as Record<string, unknown>) ?? {});
    const next = { ...settings, skipClientReview: true, reviewMode: "internal_only" };
    await sql`
      UPDATE workspaces SET settings = ${JSON.stringify(next)}::jsonb WHERE id = ${ws.id}
    `;
    console.log(JSON.stringify({ workspace: ws.slug, settings: next }));
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
