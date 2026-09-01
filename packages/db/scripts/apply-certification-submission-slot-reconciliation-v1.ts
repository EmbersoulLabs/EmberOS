import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { refuseProductionAiStoryApply } from "./refuse-production-ai-story-apply";

refuseProductionAiStoryApply();
const directory = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { max: 1, prepare: false });
  const migration = readFileSync(resolve(directory, "../sql/certification-submission-slot-reconciliation-v1.sql"), "utf8");
  await sql.unsafe(migration);
  await sql.end();
  console.log("Applied certification-submission-slot-reconciliation-v1.sql");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
