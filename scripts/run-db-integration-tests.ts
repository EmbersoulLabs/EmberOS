import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import { resolve } from "node:path";

// Prefer apps/worker/.env (same order as packages/db/scripts/apply-rls.ts).
// Root .env.local may contain an unparseable DATABASE_URL that would shadow a valid one.
config({ path: resolve(process.cwd(), "apps/worker/.env") });
config({ path: resolve(process.cwd(), "apps/web/.env.local") });
config({ path: resolve(process.cwd(), ".env.local") });

const databaseUrl = process.env.DATABASE_URL?.trim() || "";
if (!databaseUrl) {
  console.error("[test:integration] DATABASE_URL is not set (.env.local or apps/worker/.env)");
  process.exit(1);
}
try {
  // eslint-disable-next-line no-new
  new URL(databaseUrl);
} catch {
  console.error(
    "[test:integration] DATABASE_URL is not a valid URL (check password encoding / .env.local)"
  );
  process.exit(1);
}
process.env.DATABASE_URL = databaseUrl;

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
