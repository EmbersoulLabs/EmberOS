import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const directory = dirname(fileURLToPath(import.meta.url));
const client = postgres(databaseUrl, { max: 1 });
try {
  await client.unsafe(
    readFileSync(
      resolve(directory, "../sql/ai-story-post-terminal-provider-retry-v1.sql"),
      "utf8"
    )
  );
} finally {
  await client.end();
}
