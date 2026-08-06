import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), "apps/worker/.env") });
config({ path: resolve(process.cwd(), "apps/web/.env.local") });
config({ path: resolve(process.cwd(), ".env.local") });

process.env.RUN_DB_INTEGRATION_TESTS = "1";
if (!process.env.DATABASE_URL?.trim()) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const files = process.argv.slice(2);
const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "--config", "vitest.integration.config.ts", ...files],
  { stdio: "inherit", env: process.env, shell: true }
);
process.exit(result.status ?? 1);
