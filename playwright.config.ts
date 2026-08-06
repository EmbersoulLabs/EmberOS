import { config } from "dotenv";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

config({ path: resolve(".env.e2e.local") });
config({ path: resolve(".env.local") });

const baseURL = process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3000";
const parsedBaseURL = new URL(baseURL);
if (parsedBaseURL.hostname !== "127.0.0.1") {
  throw new Error(`E2E_BASE_URL must use the canonical host 127.0.0.1, received ${parsedBaseURL.hostname}`);
}

/**
 * Marketing vertical slice browser E2E.
 *
 * Credentials (required):
 *   E2E_USER_EMAIL / E2E_USER_PASSWORD
 * Optional:
 *   E2E_BASE_URL (default http://127.0.0.1:3000)
 *   E2E_WORKSPACE_SLUG (default florist2)
 *
 * Setup helper:
 *   npx tsx scripts/setup-e2e-user.ts
 *   → writes .env.e2e.local (gitignored via .env*.local)
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 420_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/start-local-runtime.mjs --e2e",
    url: `${baseURL}/api/health/runtime`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "auth-setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["auth-setup"],
      testIgnore: [/auth\.setup\.ts/, /auth-protected\.spec\.ts/],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/operator.json" },
    },
    {
      name: "chromium-viewer",
      dependencies: ["auth-setup"],
      testMatch: /(auth-protected|campaign-overview-authenticated)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/viewer.json" },
    },
  ],
});
