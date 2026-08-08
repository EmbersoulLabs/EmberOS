import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.integration.test.ts"],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@ceo-agent/db": path.resolve(__dirname, "packages/db/src/index.ts"),
      "@ceo-agent/shared/server": path.resolve(
        __dirname,
        "packages/shared/src/server.ts"
      ),
      "@ceo-agent/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@ceo-agent/queue": path.resolve(__dirname, "packages/queue/src/index.ts"),
      "@ceo-agent/agents": path.resolve(__dirname, "packages/agents/src/index.ts"),
      "@": path.resolve(__dirname, "apps/web/src"),
    },
  },
});
