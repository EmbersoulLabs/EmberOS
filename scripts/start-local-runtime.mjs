import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";
import "./sync-env.mjs";

const root = resolve(".");
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });
const e2eMode = process.argv.includes("--e2e");
const baseURL = new URL(
  e2eMode
    ? process.env.E2E_BASE_URL || "http://127.0.0.1:3100"
    : process.env.LOCAL_RUNTIME_URL || "http://127.0.0.1:3000"
);
if (baseURL.hostname !== "127.0.0.1") throw new Error(`Local runtime must use 127.0.0.1, received ${baseURL.hostname}`);

for (const name of ["DATABASE_URL", "REDIS_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required for the unified runtime`);
}

const children = [];
function launch(label, command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env, windowsHide: true });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(`[runtime] ${label} exited code=${code} signal=${signal ?? "none"}`);
      void stop(code ?? 1);
    }
  });
  return child;
}

let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1_500).unref();
}

launch("worker", process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), resolve("apps/worker/src/index.ts")], root);
launch("web", process.execPath, [resolve("apps/web/node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", baseURL.port || "3000"], resolve("apps/web"));

const healthURL = new URL("/api/health/runtime", baseURL).toString();
const deadline = Date.now() + 120_000;
let last = "not started";
while (Date.now() < deadline) {
  try {
    const response = await fetch(healthURL);
    last = await response.text();
    if (response.ok) {
      console.log(`[runtime] READY ${baseURL.origin}`);
      console.log(`[runtime] health ${healthURL}`);
      break;
    }
  } catch (error) {
    last = error instanceof Error ? error.message : String(error);
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
}
if (Date.now() >= deadline) {
  console.error(`[runtime] readiness timeout: ${last}`);
  await stop(1);
}

process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));
await new Promise(() => {});
