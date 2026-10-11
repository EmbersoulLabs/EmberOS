import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 3107;
const databaseDir = path.join(tmpdir(), `emberos-marketing-ui-pg-${Date.now()}`);
const seedFile = path.join(tmpdir(), "emberos-marketing-ui-seed.json");
const secret = crypto.randomUUID() + crypto.randomUUID();

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(selected));
    });
  });
}

function assertPortFree(target) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`127.0.0.1:${target} is already in use`)));
    server.listen(target, "127.0.0.1", () => server.close(() => resolve()));
  });
}

const blockedKeys = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "LOCAL_GPU",
  "REDIS_URL",
];

let postgres = null;
let nextProcess = null;
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  if (nextProcess && !nextProcess.killed) nextProcess.kill();
  if (postgres) {
    try {
      await postgres.stop();
    } catch {
      // The test process is already exiting.
    }
    postgres = null;
  }
  rmSync(databaseDir, { recursive: true, force: true });
}

process.on("SIGINT", () => {
  void stop().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void stop().finally(() => process.exit(0));
});

await assertPortFree(port);
const pgPort = await freePort();
const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${pgPort}/marketing_ui_e2e`;
mkdirSync(databaseDir, { recursive: true });
postgres = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password: "postgres",
  port: pgPort,
  persistent: false,
  initdbFlags: ["--locale-provider=builtin", "--builtin-locale=C.UTF-8", "--encoding=UTF8"],
});
await postgres.initialise();
await postgres.start();
await postgres.createDatabase("marketing_ui_e2e");

const pushed = spawnSync("pnpm", ["exec", "drizzle-kit", "push", "--force"], {
  cwd: path.join(root, "packages", "db"),
  env: { ...process.env, DATABASE_URL: databaseUrl },
  encoding: "utf8",
  shell: true,
});
if (pushed.status !== 0) {
  await stop();
  throw new Error(`drizzle-kit push failed (${pushed.status}): ${pushed.stdout ?? ""}\n${pushed.stderr ?? ""}`);
}

const seeded = spawnSync("pnpm", ["exec", "tsx", "scripts/seed-marketing-ui-e2e.ts"], {
  cwd: root,
  env: { ...process.env, DATABASE_URL: databaseUrl, MARKETING_UI_SEED_FILE: seedFile },
  encoding: "utf8",
  shell: true,
});
if (seeded.status !== 0) {
  await stop();
  throw new Error(`seed failed (${seeded.status}): ${seeded.stdout ?? ""}\n${seeded.stderr ?? ""}`);
}

const seed = JSON.parse(readFileSync(seedFile, "utf8"));
writeFileSync(seedFile, JSON.stringify({ ...seed, secret, baseURL: `http://127.0.0.1:${port}` }, null, 2));

const childEnv = { ...process.env, DATABASE_URL: databaseUrl };
for (const key of blockedKeys) childEnv[key] = "";
childEnv.E2E_LOCAL_AUTH = "1";
childEnv.E2E_LOCAL_AUTH_SECRET = secret;
childEnv.NODE_ENV = "development";
childEnv.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
childEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY = "e2e-local-anon";

nextProcess = spawn(
  "pnpm",
  ["--filter", "@ceo-agent/web", "exec", "next", "dev", "--port", String(port), "--hostname", "127.0.0.1"],
  { cwd: root, env: childEnv, stdio: "inherit", shell: true }
);
nextProcess.on("exit", (code) => {
  if (stopping) return;
  void stop().finally(() => process.exit(code ?? 1));
});
