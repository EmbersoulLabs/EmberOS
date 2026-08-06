import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootPackage = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const playwright = readFileSync(resolve("playwright.config.ts"), "utf8");
const runtime = readFileSync(resolve("scripts/start-local-runtime.mjs"), "utf8");
const health = readFileSync(resolve("apps/web/src/app/api/health/runtime/route.ts"), "utf8");

describe("unified local runtime", () => {
  it("uses one runtime for developers and Playwright", () => {
    expect(rootPackage.scripts.dev).toBe("node scripts/start-local-runtime.mjs");
    expect(playwright).toContain("start-local-runtime.mjs --e2e");
    expect(playwright).toContain("/api/health/runtime");
  });

  it("starts both web and worker and fails on readiness timeout", () => {
    expect(runtime).toContain('launch("worker"');
    expect(runtime).toContain('launch("web"');
    expect(runtime).toContain("readiness timeout");
  });

  it("requires all background-service checks", () => {
    for (const check of ["database", "redis", "worker", "supabase", "storage", "queue"]) {
      expect(health).toContain(`"${check}"`);
    }
  });

  it("keeps privileged readiness details out of the production response", () => {
    expect(health).toContain('process.env.NODE_ENV === "production"');
    expect(health).toContain('{ ok: true, service: "emberos-web" }');
    expect(health.indexOf('process.env.NODE_ENV === "production"')).toBeLessThan(
      health.indexOf("SUPABASE_SERVICE_ROLE_KEY")
    );
    expect(health).toContain('"Cache-Control": "no-store"');
  });
});
