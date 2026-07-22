/**
 * Apply PD-036/PD-037 Asset Library V1 schema.
 * Usage: pnpm --filter @ceo-agent/db sql:asset-library
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(__dirname, "../../../apps/worker/.env") });
config({ path: resolve(__dirname, "../../../.env.local") });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (check .env.local)");
  process.exit(1);
}

const sqlFile = resolve(__dirname, "../sql/asset-library-v1.sql");

function parseStatements(sql: string): string[] {
  const statements: string[] = [];
  let buffer = "";
  let inDoBlock = false;

  for (const rawLine of sql.split("\n")) {
    const line = rawLine;
    const trimmed = line.trim();
    if (!inDoBlock && trimmed.startsWith("--")) continue;

    buffer += `${line}\n`;

    if (/^\s*DO\s+\$\$/i.test(trimmed)) inDoBlock = true;
    if (inDoBlock && /\$\$\s*;\s*$/.test(trimmed)) {
      inDoBlock = false;
      statements.push(buffer.trim());
      buffer = "";
      continue;
    }

    if (!inDoBlock && trimmed.endsWith(";")) {
      statements.push(buffer.trim());
      buffer = "";
    }
  }

  if (buffer.trim()) statements.push(buffer.trim());
  return statements.filter((s) => s.length > 0);
}

const statements = parseStatements(readFileSync(sqlFile, "utf8"));
const db = postgres(url, { max: 1 });

try {
  for (const statement of statements) {
    await db.unsafe(statement);
    console.log("OK:", statement.slice(0, 72).replace(/\s+/g, " ") + "...");
  }
  console.log("Asset Library V1 schema applied.");
} finally {
  await db.end();
}
