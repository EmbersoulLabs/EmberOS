import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const databaseDir = path.join(tmpdir(), "emberos-worker-budget-pg");
const urlFile = path.join(tmpdir(), "emberos-worker-budget-db-url.txt");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

let postgres: EmbeddedPostgres | null = null;

export default async function setup() {
  if (process.env.RUN_DB_INTEGRATION_TESTS === "1" && process.env.DATABASE_URL) return async () => {};
  const port = await freePort();
  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/worker_budget`;
  rmSync(databaseDir, { recursive: true, force: true });
  mkdirSync(databaseDir, { recursive: true });
  postgres = new EmbeddedPostgres({
    databaseDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    initdbFlags: ["--locale-provider=builtin", "--builtin-locale=C.UTF-8", "--encoding=UTF8"],
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase("worker_budget");
  writeFileSync(urlFile, databaseUrl, "utf8");
  const pushed = spawnSync("pnpm", ["exec", "drizzle-kit", "push", "--force"], {
    cwd: path.resolve("packages/db"),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    shell: true,
  });
  if (pushed.status !== 0) {
    throw new Error(`drizzle-kit push failed (${pushed.status}): ${pushed.stdout ?? ""}\n${pushed.stderr ?? ""}`);
  }
  return async () => {
    if (postgres) {
      try {
        await postgres.stop();
      } catch {
        // Windows can report EBUSY while the server releases its data directory.
      }
      postgres = null;
    }
  };
}
