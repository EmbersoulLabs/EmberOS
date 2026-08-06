/**
 * Sprint 1 acceptance: inspect a completed task for export readiness.
 * Usage: npx tsx scripts/sprint1-export-inspect.ts [taskId]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, ".env.local") });

async function main() {
  const taskIdArg = process.argv[2];
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const tasks = taskIdArg
      ? await sql`SELECT id, campaign_id, status, workspace_id, org_id,
          step_progress->'content_generate'->>'status' AS content_gen,
          step_progress->'export_packs' AS export_packs,
          step_progress->'export_pack' AS export_pack,
          step_progress->'export_request' AS export_request
        FROM tasks WHERE id = ${taskIdArg}`
      : await sql`SELECT id, campaign_id, status, workspace_id, org_id,
          step_progress->'content_generate'->>'status' AS content_gen,
          step_progress->'export_packs' AS export_packs,
          step_progress->'export_pack' AS export_pack,
          step_progress->'export_request' AS export_request
        FROM tasks WHERE status = 'completed'
        ORDER BY created_at DESC LIMIT 5`;

    for (const t of tasks) {
      const creatives = await sql`
        SELECT id, status, render_status, video_url, video_export_url, cover_url
        FROM creatives WHERE task_id = ${t.id}
        ORDER BY created_at
      `;
      const reviews = await sql`
        SELECT id, decision, creative_id FROM reviews
        WHERE creative_id IN (SELECT id FROM creatives WHERE task_id = ${t.id})
        ORDER BY created_at DESC LIMIT 5
      `;
      const [campaign] = await sql`
        SELECT id, name, status, generate_status FROM campaigns WHERE id = ${t.campaign_id}
      `;
      console.log(
        JSON.stringify(
          {
            task: t,
            campaign,
            creatives,
            reviews,
          },
          null,
          2
        )
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
