import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/campaign-content-iterations.integration.test.ts"], fileParallelism: false,
    globalSetup: ["tests/helpers/campaign-iterations-postgres.ts"], testTimeout: 30_000, hookTimeout: 180_000,
    env: { CAMPAIGN_ITERATIONS_DB_FILE: path.join(process.env.TEMP || process.env.TMP || "/tmp", "emberos-campaign-iterations-db-url.txt") },
  },
  resolve: { alias: {
    "@ceo-agent/db": path.resolve(__dirname, "packages/db/src/index.ts"),
    "@ceo-agent/shared/server": path.resolve(__dirname, "packages/shared/src/server.ts"),
    "@ceo-agent/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
    "drizzle-orm": path.resolve(__dirname, "packages/db/node_modules/drizzle-orm"),
  } },
});
