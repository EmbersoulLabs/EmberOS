import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Platform Superadmin internal self-use boundary", () => {
  it("requires persistent Platform Admin identity and authoritative Company ownership", () => {
    const service = read("packages/db/src/queries/controlled-self-use.ts");
    expect(service).toContain("controlled_self_use_organization_scopes scope");
    expect(service).toContain("owner.role = 'owner'");
    expect(service).toContain("admin.platform_role = 'PLATFORM_SUPER_ADMIN'");
    expect(service).toContain("admin.status = 'ACTIVE'");
    expect(service).toContain("scope.status = 'ACTIVE'");
  });

  it("removes internal USD blocking only for account scope while preserving zero automatic retries", () => {
    const service = read("packages/db/src/queries/controlled-self-use.ts");
    expect(service).toContain('maxUsdPerExecution: "5.00"');
    expect(service).toContain('dailyCapUsd: "10.00"');
    expect(service).toContain("maxAutomaticRetries: 0");
    expect(service).toContain('authority.scopeKind === "ORGANIZATION"');
    expect(service).toContain("SELF_USE_DAILY_BUDGET_EXCEEDED");
  });

  it("keeps the account scope server-only with RLS and automatic owner inheritance", () => {
    const migration = read("supabase/migrations/20261016160034_global_superadmin_entitlement_v1.sql");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all privileges on table public.controlled_self_use_organization_scopes from anon, authenticated");
    expect(migration).toContain("organization_owner_global_internal_self_use");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("revoke all on function public.inherit_global_internal_self_use_from_owner()");
  });
});
