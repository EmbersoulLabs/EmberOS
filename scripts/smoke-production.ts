/**
 * Post-deploy smoke verification for Web + optional infra checks.
 *
 * Usage:
 *   pnpm smoke:prod -- --url https://your-app.vercel.app
 *   pnpm smoke:prod -- --url http://localhost:3000 --infra
 *   pnpm smoke:prod -- --url https://your-app.vercel.app --strict
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

type Args = {
  url: string;
  infra: boolean;
  strict: boolean;
};

function parseArgs(argv: string[]): Args {
  let url = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  let infra = false;
  let strict = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url") url = argv[++i] ?? url;
    else if (arg === "--infra") infra = true;
    else if (arg === "--strict") strict = true;
    else if (arg === "-h" || arg === "--help") {
      console.log(`
Production smoke check

  pnpm smoke:prod -- --url https://your-app.vercel.app
  pnpm smoke:prod -- --url http://localhost:3000 --infra

Options:
  --url <base>   Web base URL (default: NEXT_PUBLIC_APP_URL or localhost:3000)
  --infra        Also run pnpm check:infra (DATABASE_URL + REDIS_URL required)
  --strict       Fail if /api/health reports missing env (503)
`);
      process.exit(0);
    }
  }

  return { url: url.replace(/\/$/, ""), infra, strict };
}

async function checkHealth(baseUrl: string, strict: boolean): Promise<void> {
  const endpoint = `${baseUrl}/api/health`;
  console.log(`[smoke] GET ${endpoint}`);

  const res = await fetch(endpoint, { signal: AbortSignal.timeout(15_000) });
  const body = (await res.json()) as {
    ok?: boolean;
    service?: string;
    version?: string;
    checks?: Record<string, string>;
  };

  console.log(`[smoke] status=${res.status} ok=${body.ok} version=${body.version ?? "?"}`);
  if (body.checks) {
    for (const [key, value] of Object.entries(body.checks)) {
      console.log(`[smoke]   ${key}: ${value}`);
    }
  }

  if (!res.ok && strict) {
    throw new Error(`Health check failed with HTTP ${res.status}`);
  }

  if (strict && body.ok !== true) {
    throw new Error("Health check reported not ready (missing production env)");
  }

  if (!res.ok && !strict) {
    console.warn("[smoke] Health returned non-200 — acceptable without --strict (CI build uses placeholders)");
  }
}

function runInfraCheck(): void {
  console.log("\n[smoke] Running infrastructure check (pnpm check:infra)...\n");
  const result = spawnSync("pnpm", ["check:infra"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error("Infrastructure check failed");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await checkHealth(args.url, args.strict);
  if (args.infra) runInfraCheck();
  console.log("\n[smoke] Production smoke check passed.\n");
}

main().catch((err) => {
  console.error("\n[smoke] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
