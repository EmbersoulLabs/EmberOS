import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });
config({ path: resolve(__dirname, "../../../.env.local") });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const db = postgres(url, { max: 1 });
try {
  await db.unsafe("VACUUM ANALYZE agent_logs");
  await db.unsafe("VACUUM ANALYZE tasks");
  await db.unsafe("VACUUM ANALYZE creatives");
  const [sizes] = await db`
    SELECT
      pg_size_pretty(pg_total_relation_size('agent_logs')) AS agent_logs,
      pg_size_pretty(pg_total_relation_size('tasks')) AS tasks,
      pg_size_pretty(pg_total_relation_size('creatives')) AS creatives
  `;
  console.log("After VACUUM:", sizes);
} finally {
  await db.end();
}
