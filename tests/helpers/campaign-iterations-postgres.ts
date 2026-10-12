import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const databaseDir = path.join(tmpdir(), "emberos-campaign-iterations-pg");
const urlFile = path.join(tmpdir(), "emberos-campaign-iterations-db-url.txt");
const freePort = () => new Promise<number>((resolve, reject) => {
  const server = createServer(); server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(typeof address === "object" && address ? address.port : 0)); });
});

let embedded: EmbeddedPostgres | null = null;
export default async function setup() {
  if (process.env.RUN_DB_INTEGRATION_TESTS === "1" && process.env.DATABASE_URL) return async () => {};
  const port = await freePort();
  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/campaign_iterations`;
  rmSync(databaseDir, { recursive: true, force: true }); mkdirSync(databaseDir, { recursive: true });
  embedded = new EmbeddedPostgres({ databaseDir, user: "postgres", password: "postgres", port, persistent: false, initdbFlags: ["--locale-provider=builtin", "--builtin-locale=C.UTF-8", "--encoding=UTF8"] });
  await embedded.initialise(); await embedded.start(); await embedded.createDatabase("campaign_iterations");
  writeFileSync(urlFile, databaseUrl, "utf8");
  const env = { ...process.env, DATABASE_URL: databaseUrl, RUN_DB_INTEGRATION_TESTS: "1", EMBEROS_TEST_DB_ENVIRONMENT: "test" };
  for (const [command, args] of [
    ["pnpm", ["exec", "tsx", "scripts/bootstrap-test-supabase-auth.ts"]],
    ["pnpm", ["--filter", "@ceo-agent/db", "exec", "drizzle-kit", "push", "--force"]],
    ["pnpm", ["--filter", "@ceo-agent/db", "sql:campaign-content-iterations"]],
    ["pnpm", ["--filter", "@ceo-agent/db", "sql:campaign-marketing-plan"]],
  ] as const) {
    const result = spawnSync(command, args, { cwd: path.resolve("."), env, encoding: "utf8", shell: true });
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${result.stdout}\n${result.stderr}`);
  }
  return async () => { if (embedded) { try { await embedded.stop(); } catch {} embedded = null; } };
}
