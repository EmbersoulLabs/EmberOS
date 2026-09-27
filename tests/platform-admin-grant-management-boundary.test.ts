import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Platform Super Admin grant management boundaries", () => {
  it("uses the canonical persistent authority and never email or membership authority", () => {
    const command = read("packages/db/src/queries/platform-admin-grant-management.ts");
    expect(command).toContain('eq(schema.platformAdminGrants.status, "ACTIVE")');
    expect(command).toContain('eq(schema.platformAdminGrants.platformRole, "PLATFORM_SUPER_ADMIN")');
    expect(command).not.toContain("SUPERADMIN_EMAILS");
    expect(command).not.toContain("organizationMembers");
    expect(command).not.toContain("workspaceMembers");
  });

  it("exposes only session-authorized server routes backed by the same service", () => {
    const auth = read("apps/web/src/lib/platform-admin-command-authorization.ts");
    const grant = read("apps/web/src/app/api/admin/platform-admins/[userId]/grant/route.ts");
    const revoke = read("apps/web/src/app/api/admin/platform-admins/[userId]/revoke/route.ts");
    expect(auth).toContain("requireSuperAdmin()");
    expect(auth).toContain("createTrustedAdminCommandContext");
    expect(grant).toContain("PlatformAdminGrantManagementService");
    expect(revoke).toContain("PlatformAdminGrantManagementService");
    expect(grant).not.toContain("SUPERADMIN_EMAILS");
    expect(revoke).not.toContain("SUPERADMIN_EMAILS");
  });

  it("keeps lifecycle history and enforces last-admin safety", () => {
    const command = read("packages/db/src/queries/platform-admin-grant-management.ts");
    expect(command).toContain("PLATFORM_ADMIN_LAST_ACTIVE_CANNOT_REVOKE");
    expect(command).toContain("platformAdminRevocations");
    expect(command).toContain("adminAuditEvents");
    expect(command).not.toContain("delete(schema.platformAdminGrants)");
  });
});
