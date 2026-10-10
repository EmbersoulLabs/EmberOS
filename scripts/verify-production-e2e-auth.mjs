import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appPort = 3108;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

const stub = createServer((_request, response) => {
  response.writeHead(401, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "invalid claim" }));
});
const stubPort = await listen(stub);

const nextBin = path.join(
  path.dirname(createRequire(path.join(root, "apps", "web", "package.json")).resolve("next/package.json")),
  "dist",
  "bin",
  "next"
);
const child = spawn(
  process.execPath,
  [nextBin, "start", "--port", String(appPort), "--hostname", "127.0.0.1"],
  {
    cwd: path.join(root, "apps", "web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      E2E_LOCAL_AUTH: "1",
      E2E_LOCAL_AUTH_SECRET: "review-secret-not-a-production-credential",
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${stubPort}`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "review-anon-not-a-production-credential",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:1/unused",
    },
  }
);

function stop(code) {
  stub.close();
  if (child.pid && !child.killed) child.kill();
  setTimeout(() => process.exit(code), 300);
}

child.stderr?.on("data", (chunk) => process.stderr.write(chunk));

const deadline = Date.now() + 60_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/e2e/session`);
    if (response.status === 404) {
      ready = true;
      break;
    }
  } catch {
    // The production server is still booting.
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) {
  console.error("production server did not reject the local session route");
  stop(1);
}

const minted = await fetch(`http://127.0.0.1:${appPort}/api/e2e/session`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-e2e-auth-secret": "review-secret-not-a-production-credential",
  },
  body: JSON.stringify({ userId: "00000000-0000-4000-8000-000000000001" }),
});
if (minted.status !== 404) {
  console.error(`production POST /api/e2e/session returned ${minted.status}`);
  stop(1);
}

const me = await fetch(`http://127.0.0.1:${appPort}/api/me`, {
  headers: { cookie: "emberos_e2e_session=forged.1.signature" },
});
if (me.status !== 401) {
  console.error(`forged test cookie on /api/me returned ${me.status}`);
  stop(1);
}

console.log("production e2e auth isolation: session route 404, forged cookie 401");
stop(0);
