import { spawn } from "node:child_process";
import { resolve } from "node:path";
import "./sync-env.mjs";

const baseURL = new URL(process.env.E2E_BASE_URL || "http://127.0.0.1:3100");
if (baseURL.hostname !== "127.0.0.1") {
  throw new Error(`E2E_BASE_URL must use 127.0.0.1, received ${baseURL.hostname}`);
}

const child = spawn(
  process.execPath,
  [resolve("apps/web/node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", baseURL.port || "3100"],
  { cwd: resolve("apps/web"), stdio: "inherit", env: process.env }
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
