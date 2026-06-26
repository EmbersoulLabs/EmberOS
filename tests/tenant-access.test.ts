import { describe, expect, it } from "vitest";
import { ROLE_HIERARCHY, WorkspaceAccessError } from "@ceo-agent/db";
import type { WorkspaceRole } from "@ceo-agent/shared";

function meetsMinRole(memberRole: WorkspaceRole, minRole: WorkspaceRole): boolean {
  return ROLE_HIERARCHY[memberRole] >= ROLE_HIERARCHY[minRole];
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
