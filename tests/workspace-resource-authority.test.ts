import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  WorkspaceResourceMismatchError,
  assertWorkspaceResourceMatch,
} from "@/lib/workspace-resource-authority";

describe("workspace URL and resource authority", () => {
  const tapaoJomWorkspace = "3ab245ba-b7be-463b-9f57-98cd3bfa38ed";
  const otherAuthorizedWorkspace = "6ca8bc5e-4ea7-4b34-b3fe-8677cff070bf";

  it("rejects a campaign in another workspace even when both memberships exist", () => {
    expect(() => assertWorkspaceResourceMatch(tapaoJomWorkspace, otherAuthorizedWorkspace))
      .toThrow(WorkspaceResourceMismatchError);
  });

  it("rejects an AI Story in another workspace", () => {
    expect(() => assertWorkspaceResourceMatch(tapaoJomWorkspace, otherAuthorizedWorkspace))
      .toThrowError("Workspace resource not found");
  });

  it("allows a resource belonging to the URL workspace", () => {
    expect(() => assertWorkspaceResourceMatch(tapaoJomWorkspace, tapaoJomWorkspace))
      .not.toThrow();
  });

  it("uses the canonical persistent Platform Admin grant as the membership-free read fallback", () => {
    const source = readFileSync(
      "apps/web/src/lib/workspace-resource-authority.ts",
      "utf8"
    );
    expect(source).toContain("PlatformAdminRepositoryImpl");
    expect(source).toContain("getActiveGrantForUser(input.userId)");
    expect(source).not.toContain("SUPERADMIN_EMAILS");
  });

  it("binds Campaign listing to the selected Workspace authority", () => {
    const source = readFileSync("apps/web/src/app/api/campaigns/route.ts", "utf8");
    expect(source).toContain("requireWorkspaceResourceAuthority({");
    expect(source).toContain("resourceWorkspaceId: workspaceId");
  });
});
