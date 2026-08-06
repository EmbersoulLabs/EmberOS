import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(".env.e2e.local") });

const workspaceSlug = process.env.E2E_WORKSPACE_SLUG?.trim() || "e2e-workspace";

test("Business Profile reads and writes PD-042 publishing defaults", async ({ request }) => {
  const meResponse = await request.get("/api/me");
  expect(meResponse.ok()).toBeTruthy();
  const me = await meResponse.json();
  const workspace = me.workspaces?.find((item: { slug: string }) => item.slug === workspaceSlug);
  expect(workspace?.id).toBeTruthy();
  test.skip(!["admin", "operator"].includes(workspace.role), "operator permission required");

  const getResponse = await request.get(`/api/workspaces/${workspace.id}/business-profile`);
  expect(getResponse.ok(), await getResponse.text()).toBeTruthy();
  const getBody = await getResponse.json();
  const original = getBody.data?.profile ?? getBody.profile;
  expect(Array.isArray(original.defaultPublishingPlatforms)).toBeTruthy();

  const probe = original.defaultPublishingPlatforms.includes("instagram")
    ? ["facebook"]
    : ["instagram"];
  const patchResponse = await request.patch(`/api/workspaces/${workspace.id}/business-profile`, {
    data: { version: original.version, defaultPublishingPlatforms: probe },
  });
  expect(patchResponse.ok(), await patchResponse.text()).toBeTruthy();
  const patchBody = await patchResponse.json();
  const updated = patchBody.data?.profile ?? patchBody.profile;
  expect(updated.defaultPublishingPlatforms).toEqual(probe);

  const restoreResponse = await request.patch(`/api/workspaces/${workspace.id}/business-profile`, {
    data: {
      version: updated.version,
      defaultPublishingPlatforms: original.defaultPublishingPlatforms,
    },
  });
  expect(restoreResponse.ok(), await restoreResponse.text()).toBeTruthy();
});
