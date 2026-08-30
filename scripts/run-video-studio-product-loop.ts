/**
 * VS-RC-TEST-01 permanent product-loop release gate.
 * Outcomes: PASS (0), PRODUCT_FAILURE (1), ENVIRONMENT_BLOCKED (2).
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { runVideoStudioProductLoopPreflight } from "./video-studio-product-loop-preflight";

config({ path: resolve(process.cwd(), "apps/worker/.env") });
config({ path: resolve(process.cwd(), "apps/web/.env.local") });
config({ path: resolve(process.cwd(), ".env.e2e.local") });
config({ path: resolve(process.cwd(), ".env.local") });

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): number {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error("PRODUCT_FAILURE", result.error.name);
    return 1;
  }
  return result.status ?? 1;
}

async function main() {
  const preflight = await runVideoStudioProductLoopPreflight();
  if (!preflight.ok) {
    const blockers = preflight.items
      .filter((item) => item.status !== "PASS" && item.status !== "AVAILABLE")
      .map((item) => item.name);
    console.error("ENVIRONMENT_BLOCKED", blockers.join(",") || "preflight");
    process.exitCode = 2;
    setTimeout(() => process.exit(2), 200);
    return;
  }

  const integration = run(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.config.ts",
      "tests/vs-rc-test-01-product-loop.integration.test.ts",
    ],
    { RUN_DB_INTEGRATION_TESTS: "1" }
  );
  if (integration !== 0) {
    console.error("PRODUCT_FAILURE automated MUST");
    process.exit(1);
  }

  console.log("VS-RC-TEST-01 PASS");
}

main().catch((error) => {
  console.error("ENVIRONMENT_BLOCKED", error instanceof Error ? error.name : "unknown");
  process.exit(2);
});
