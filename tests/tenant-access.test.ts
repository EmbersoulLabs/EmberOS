import { describe, expect, it } from "vitest";
import {
  ORG_ROLE_HIERARCHY,
  OrganizationAccessError,
  ROLE_HIERARCHY,
  WorkspaceAccessError,
} from "@ceo-agent/db";
import type { OrgRole, WorkspaceRole } from "@ceo-agent/shared";

function meetsMinRole(memberRole: WorkspaceRole, minRole: WorkspaceRole): boolean {
  return ROLE_HIERARCHY[memberRole] >= ROLE_HIERARCHY[minRole];
}

function meetsMinOrgRole(memberRole: OrgRole, minRole: OrgRole): boolean {
  return ORG_ROLE_HIERARCHY[memberRole] >= ORG_ROLE_HIERARCHY[minRole];
}

/**
 * Mirrors POST /api/workspaces authorization:
 * client-supplied orgId is only accepted when the user is a member of THAT org.
 */
function canCreateWorkspaceInOrg(opts: {
  requestedOrgId: string;
  memberships: Array<{ orgId: string; role: OrgRole }>;
}): boolean {
  const membership = opts.memberships.find((m) => m.orgId === opts.requestedOrgId);
  if (!membership) return false;
  return meetsMinOrgRole(membership.role, "member");
}

describe("requireWorkspaceRole RBAC matrix", () => {
  it("admin satisfies all workspace roles", () => {
    const roles: WorkspaceRole[] = [
      "admin",
      "operator",
      "editor",
      "reviewer",
      "publisher",
      "client_viewer",
    ];
    for (const min of roles) {
      expect(meetsMinRole("admin", min)).toBe(true);
    }
  });

  it("operator can run campaigns but editor cannot", () => {
    expect(meetsMinRole("operator", "operator")).toBe(true);
    expect(meetsMinRole("editor", "operator")).toBe(false);
  });

  it("publisher and reviewer share export/review tier", () => {
    expect(ROLE_HIERARCHY.publisher).toBe(ROLE_HIERARCHY.reviewer);
    expect(meetsMinRole("publisher", "publisher")).toBe(true);
    expect(meetsMinRole("reviewer", "publisher")).toBe(true);
    expect(meetsMinRole("editor", "publisher")).toBe(true);
    expect(meetsMinRole("client_viewer", "publisher")).toBe(false);
  });

  it("client_viewer is lowest privilege", () => {
    expect(meetsMinRole("client_viewer", "client_viewer")).toBe(true);
    expect(meetsMinRole("client_viewer", "editor")).toBe(false);
  });

  it("WorkspaceAccessError carries API error code", () => {
    const err = new WorkspaceAccessError("Not a member", "FORBIDDEN");
    expect(err.code).toBe("FORBIDDEN");
    expect(err.name).toBe("WorkspaceAccessError");
  });
});

describe("organization membership authorization for workspace create", () => {
  const orgA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const orgB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  it("owner/admin/member of the target org may create a workspace", () => {
    for (const role of ["owner", "admin", "member"] as OrgRole[]) {
      expect(
        canCreateWorkspaceInOrg({
          requestedOrgId: orgA,
          memberships: [{ orgId: orgA, role }],
        })
      ).toBe(true);
    }
  });

  it("rejects create when user belongs to a different organization only", () => {
    expect(
      canCreateWorkspaceInOrg({
        requestedOrgId: orgB,
        memberships: [{ orgId: orgA, role: "owner" }],
      })
    ).toBe(false);
  });

  it("does not trust client orgId when user has any membership elsewhere", () => {
    expect(
      canCreateWorkspaceInOrg({
        requestedOrgId: orgB,
        memberships: [{ orgId: orgA, role: "owner" }],
      })
    ).toBe(false);
  });

  it("allows create only for the org the user actually belongs to", () => {
    expect(
      canCreateWorkspaceInOrg({
        requestedOrgId: orgA,
        memberships: [
          { orgId: orgA, role: "member" },
          { orgId: orgB, role: "owner" },
        ],
      })
    ).toBe(true);
    expect(
      canCreateWorkspaceInOrg({
        requestedOrgId: orgB,
        memberships: [
          { orgId: orgA, role: "member" },
          { orgId: orgB, role: "owner" },
        ],
      })
    ).toBe(true);
  });

  it("org role hierarchy: owner > admin > member", () => {
    expect(ORG_ROLE_HIERARCHY.owner).toBeGreaterThan(ORG_ROLE_HIERARCHY.admin);
    expect(ORG_ROLE_HIERARCHY.admin).toBeGreaterThan(ORG_ROLE_HIERARCHY.member);
    expect(meetsMinOrgRole("owner", "admin")).toBe(true);
    expect(meetsMinOrgRole("member", "admin")).toBe(false);
  });

  it("OrganizationAccessError carries API error code", () => {
    const err = new OrganizationAccessError("Not a member of this organization", "FORBIDDEN");
    expect(err.code).toBe("FORBIDDEN");
    expect(err.name).toBe("OrganizationAccessError");
  });
});
