import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3107";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /marketing-studio-ui\.cert\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: "test-results/marketing-ui-playwright",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/marketing-ui-e2e-server.mjs",
    url: `${baseURL}/api/e2e/session`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
