import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/marketing-budget-idempotency.integration.test.ts"],
    fileParallelism: false,
    globalSetup: ["tests/helpers/marketing-budget-idempotency-postgres.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      WEB_BUDGET_DB_FILE: path.join(process.env.TEMP || process.env.TMP || "/tmp", "emberos-web-budget-idempotency-db-url.txt"),
    },
  },
  resolve: {
    alias: {
      "@ceo-agent/db": path.resolve(__dirname, "packages/db/src/index.ts"),
      "@ceo-agent/shared/server": path.resolve(__dirname, "packages/shared/src/server.ts"),
      "@ceo-agent/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@ceo-agent/agents": path.resolve(__dirname, "packages/agents/src/index.ts"),
      "@ceo-agent/queue": path.resolve(__dirname, "packages/queue/src/index.ts"),
      "drizzle-orm": path.resolve(__dirname, "packages/db/node_modules/drizzle-orm"),
    },
  },
});
