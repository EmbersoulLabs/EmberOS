import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const directory = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(directory, "../../../apps/worker/.env") });
config({ path: resolve(directory, "../../../apps/web/.env.local") });
config({ path: resolve(directory, "../../../.env.local") });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const statements = readFileSync(
  resolve(directory, "../sql/ai-story-human-review-persistence-v1.sql"),
  "utf8"
)
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);
const client = postgres(databaseUrl, { max: 1, prepare: false });

try {
  for (const statement of statements) await client.unsafe(statement);
  console.log("AI Story Human Review persistence schema applied.");
} finally {
  await client.end();
}
