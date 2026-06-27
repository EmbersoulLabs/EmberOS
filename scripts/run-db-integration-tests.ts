import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), "apps/web/.env.local") });
config({ path: resolve(process.cwd(), "apps/worker/.env") });

if (!process.env.DATABASE_URL?.trim()) {
  console.error("[test:integration] DATABASE_URL is not set (.env.local or apps/worker/.env)");
  process.exit(1);
}

process.env.RUN_DB_INTEGRATION_TESTS = "1";

const result = spawnSync(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.integration.config.ts",
  ],
  { stdio: "inherit", env: process.env, shell: true }
);

process.exit(result.status ?? 1);
