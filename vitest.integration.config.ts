import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.integration.test.ts"],
    deps: {
      moduleDirectories: ["node_modules", "apps/worker/node_modules", "packages/db/node_modules"],
    },
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
      "@ceo-agent/shared/platform-specs": path.resolve(
        __dirname,
        "packages/shared/src/platform-specs/index.ts"
      ),
      "@ceo-agent/shared/server": path.resolve(
        __dirname,
        "packages/shared/src/server.ts"
      ),
      "@ceo-agent/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@ceo-agent/agents/photo-scene/execute-product-extraction": path.resolve(
        __dirname,
        "packages/agents/src/photo-scene/execute-product-extraction.ts"
      ),
      "@ceo-agent/agents/photo-scene/execute-marketing-composition": path.resolve(
        __dirname,
        "packages/agents/src/photo-scene/execute-marketing-composition.ts"
      ),
      "@ceo-agent/agents/photo-scene/compose-marketing-image": path.resolve(
        __dirname,
        "packages/agents/src/photo-scene/compose-marketing-image.ts"
      ),
      "@ceo-agent/agents/photo-scene/background-removal": path.resolve(
        __dirname,
        "packages/agents/src/photo-scene/background-removal.ts"
      ),
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
      "@ceo-agent/queue": path.resolve(__dirname, "packages/queue/src/index.ts"),
      "drizzle-orm": path.resolve(__dirname, "packages/db/node_modules/drizzle-orm"),
      bullmq: path.resolve(__dirname, "apps/worker/node_modules/bullmq"),
      ioredis: path.resolve(__dirname, "apps/worker/node_modules/ioredis"),
      "@supabase/supabase-js": path.resolve(__dirname, "apps/worker/node_modules/@supabase/supabase-js"),
      ws: path.resolve(__dirname, "apps/worker/node_modules/ws"),
    },
  },
});
