import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const databaseDir = path.join(tmpdir(), "emberos-marketing-cert-pg");
const urlFile = path.join(tmpdir(), "emberos-marketing-cert-db-url.txt");

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
  const port = await freePort();
  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/marketing_cert`;
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
  try {
    await postgres.start();
  } catch (error) {
    throw new Error(`embedded postgres failed to start on ${port}: ${error instanceof Error ? error.message : String(error)}`);
  }
  await postgres.createDatabase("marketing_cert");
  writeFileSync(urlFile, databaseUrl, "utf8");

  const pushed = spawnSync(
    "pnpm",
    ["exec", "drizzle-kit", "push", "--force"],
    {
      cwd: path.resolve("packages/db"),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: "utf8",
      shell: true,
    }
  );
  if (pushed.status !== 0) {
    const detail = `${pushed.stdout ?? ""}\n${pushed.stderr ?? ""}`.trim();
    throw new Error(`drizzle-kit push failed (${pushed.status}): ${detail}`);
  }

  return async () => {
    if (postgres) {
      await postgres.stop();
      postgres = null;
    }
    rmSync(databaseDir, { recursive: true, force: true });
  };
}
