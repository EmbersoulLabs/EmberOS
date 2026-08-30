import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @ceo-agent/web exec next dev -p 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-placeholder-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "e2e-placeholder-service-role-key",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
      REDIS_URL: "redis://127.0.0.1:6379"
    }
  }
});
