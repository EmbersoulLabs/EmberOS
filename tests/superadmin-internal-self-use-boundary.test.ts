import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Platform Superadmin internal self-use boundary", () => {
  it("requires persistent Platform Admin identity and an exact workspace scope", () => {
    const route = read("apps/web/src/app/api/admin/internal-self-use/route.ts");
    const service = read("packages/db/src/queries/controlled-self-use.ts");
    expect(route).toContain("requirePlatformAdmin()");
    expect(route).toContain("eq(schema.workspaces.id, workspaceId)");
    expect(route).toContain("eq(schema.workspaces.orgId, organizationId)");
    expect(route).toContain("BillingAccountRepositoryImpl");
    expect(service).toContain("controlled_self_use_workspace_scopes scope");
    expect(service).toContain("scope.workspace_id = ${input.workspaceId}::uuid");
    expect(service).toContain("scope.status = 'ACTIVE'");
    expect(route).toContain("export async function DELETE");
    expect(service).toContain("revokeInternalWorkspace");
  });

  it("preserves the certified hard budget and zero automatic retries", () => {
    const service = read("packages/db/src/queries/controlled-self-use.ts");
    expect(service).toContain('maxUsdPerExecution: "5.00"');
    expect(service).toContain('dailyCapUsd: "10.00"');
    expect(service).toContain("maxAutomaticRetries: 0");
    expect(service).toContain("SELF_USE_DAILY_BUDGET_EXCEEDED");
  });

  it("keeps the scope ledger server-only with RLS", () => {
    const migration = read("supabase/migrations/20261016033243_superadmin_internal_self_use_workspace_scope.sql");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all privileges on table public.controlled_self_use_workspace_scopes from anon, authenticated");
    expect(migration).toContain("unique (authority_id, workspace_id)");
  });
});
