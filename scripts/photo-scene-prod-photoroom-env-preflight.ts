/**
 * Read-only Photoroom production env verification.
 * Never prints secret values. Does not set Railway/Vercel env.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { evaluatePhotoroomProductionEnv } from "../packages/shared/src/photo-scene-production-ops";

config({ path: resolve(".env.local") });
config({ path: resolve("apps/worker/.env") });

const result = evaluatePhotoroomProductionEnv(process.env);
const redacted = result.checks.map((check) => ({
  name: check.name,
  present: check.present,
  ok: check.ok,
  expected: check.expected,
}));
console.log(JSON.stringify({ status: result.status, checks: redacted, secretsPrinted: false }));
if (result.status !== "READY") process.exitCode = 2;
