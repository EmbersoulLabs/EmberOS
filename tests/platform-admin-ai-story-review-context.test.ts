import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync(
  "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx",
  "utf8"
);

describe("Platform Admin AI Story review context", () => {
  it("projects explicit Platform Admin workspace access as an operator UI role", () => {
    expect(page).toContain(
      'setWorkspaceRole(me.isSuperAdmin && ws ? "admin" : ws?.role ?? null)'
    );
  });

  it("does not manufacture access when the workspace is absent from the server projection", () => {
    expect(page).toContain("me.isSuperAdmin && ws");
    expect(page).not.toContain('me.isSuperAdmin ? "admin"');
  });
});
