import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@ceo-agent/db": path.resolve(__dirname, "packages/db/src/index.ts"),
      "@ceo-agent/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@ceo-agent/shared/platform-specs": path.resolve(
        __dirname,
        "packages/shared/src/platform-specs/index.ts"
      ),
    },
  },
});
