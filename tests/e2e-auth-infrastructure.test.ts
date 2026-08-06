import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("authenticated E2E infrastructure", () => {
  it("uses Supabase SSR serialization instead of hand-built session cookies", () => {
    const helper = readFileSync("e2e/helpers/auth.ts", "utf8");
    const marketing = readFileSync("e2e/marketing-vertical-slice.spec.ts", "utf8");
    expect(helper).toContain("createServerClient");
    expect(helper).toContain("setAll");
    expect(marketing).toContain("authenticateContext");
    expect(marketing).not.toContain("access_token: session.access_token");
  });

  it("uses a canonical host and role-specific storage states", () => {
    const config = readFileSync("playwright.config.ts", "utf8");
    const setup = readFileSync("e2e/auth.setup.ts", "utf8");
    expect(config).toContain('hostname !== "127.0.0.1"');
    expect(config).toContain('storageState: "e2e/.auth/operator.json"');
    expect(config).toContain('storageState: "e2e/.auth/viewer.json"');
    expect(setup).toContain("page.reload");
  });

  it("makes application-session failure visible on login", () => {
    const login = readFileSync("apps/web/src/app/login/page.tsx", "utf8");
    expect(login).toContain('fetch("/api/me"');
    expect(login).toContain('t("auth.sessionEstablishmentFailed")');
    expect(login).toContain('data-hydrated={hydrated ? "true" : "false"}');
  });
});
