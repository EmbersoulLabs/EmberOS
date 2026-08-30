/**
 * VS-RC-TEST-01 environment preflight for the bounded Video Studio V1 assembly.
 * Prints presence/usability only — never secret values.
 */
import { config } from "dotenv";
import { resolve } from "node:path";

export const ROOT = resolve(process.cwd());
config({ path: resolve(ROOT, ".env.e2e.local") });
config({ path: resolve(ROOT, ".env.local") });
config({ path: resolve(ROOT, "apps/worker/.env") });
config({ path: resolve(ROOT, "apps/web/.env.local") });

export type PreflightStatus =
  | "AVAILABLE"
  | "MISSING"
  | "INVALID"
  | "UNVERIFIED"
  | "PASS"
  | "BLOCKED"
  | "FAIL";

export type PreflightItem = { name: string; status: PreflightStatus; detail?: string };

export type PreflightResult = { ok: boolean; items: PreflightItem[] };

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export async function runVideoStudioProductLoopPreflight(): Promise<PreflightResult> {
  const items: PreflightItem[] = [];
  if (!present("DATABASE_URL")) {
    items.push({ name: "DATABASE_URL", status: "MISSING" });
    console.error("TEST_GATE_BLOCKED DATABASE_URL");
    return { ok: false, items };
  }
  items.push({ name: "DATABASE_URL", status: "AVAILABLE", detail: "key present" });
  if (!present("E2E_USER_EMAIL") || !present("E2E_USER_PASSWORD")) {
    items.push({ name: "E2E_CREDENTIALS", status: "MISSING" });
    console.error("TEST_GATE_BLOCKED E2E_CREDENTIALS");
    return { ok: false, items };
  }
  items.push({ name: "E2E_CREDENTIALS", status: "AVAILABLE" });
  return { ok: true, items };
}
