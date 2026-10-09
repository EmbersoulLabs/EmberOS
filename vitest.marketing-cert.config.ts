import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/marketing-studio-certification.integration.test.ts"],
    fileParallelism: false,
    globalSetup: ["tests/helpers/marketing-cert-postgres.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      MARKETING_CERT_DB_FILE: path.join(
        process.env.TEMP || process.env.TMP || "/tmp",
        "emberos-marketing-cert-db-url.txt"
      ),
    },
  },
  resolve: {
    alias: {
      "@ceo-agent/db": path.resolve(__dirname, "packages/db/src/index.ts"),
      "@ceo-agent/shared/platform-specs": path.resolve(
        __dirname,
        "packages/shared/src/platform-specs/index.ts"
      ),
      "@ceo-agent/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@ceo-agent/queue/copy-cache": path.resolve(__dirname, "packages/queue/src/copy-cache.ts"),
      "@ceo-agent/shared/i18n": path.resolve(__dirname, "packages/shared/src/i18n/index.ts"),
      "@ceo-agent/queue": path.resolve(__dirname, "packages/queue/src/index.ts"),
      "@ceo-agent/agents": path.resolve(__dirname, "packages/agents/src/index.ts"),
      "@": path.resolve(__dirname, "apps/web/src"),
    },
  },
});
