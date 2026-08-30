import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.integration.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web/src"),
      "@ceo-agent/db": path.resolve(__dirname, "packages/db/src/index.ts"),
      "@ceo-agent/shared/photo-scene-extraction.server": path.resolve(
        __dirname,
        "packages/shared/src/photo-scene-extraction.server.ts"
      ),
      "@ceo-agent/shared/photo-scene-marketing.server": path.resolve(
        __dirname,
        "packages/shared/src/photo-scene-marketing.server.ts"
      ),
      "@ceo-agent/shared/server": path.resolve(
        __dirname,
        "packages/shared/src/server.ts"
      ),
      "@ceo-agent/shared/platform-specs": path.resolve(
        __dirname,
        "packages/shared/src/platform-specs/index.ts"
      ),
      "@ceo-agent/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@ceo-agent/agents/provider-adapters": path.resolve(
        __dirname,
        "packages/agents/src/provider-adapters/index.ts"
      ),
      "@ceo-agent/agents/provider-router": path.resolve(
        __dirname,
        "packages/agents/src/provider-router/index.ts"
      ),
      "@ceo-agent/agents/commercial": path.resolve(
        __dirname,
        "packages/agents/src/commercial/index.ts"
      ),
      "@ceo-agent/agents": path.resolve(__dirname, "packages/agents/src/index.ts"),
      "@ceo-agent/queue/copy-cache": path.resolve(
        __dirname,
        "packages/queue/src/copy-cache.ts"
      ),
      "@ceo-agent/queue": path.resolve(__dirname, "packages/queue/src/index.ts"),
    },
  },
});
