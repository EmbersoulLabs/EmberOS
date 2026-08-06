import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(".env.e2e.local") });
const workspaceSlug = process.env.E2E_WORKSPACE_SLUG?.trim() || "e2e-workspace";

test("viewer storage state reaches protected pages and remains read-only", async ({ page, request }) => {
  await page.goto(`/w/${workspaceSlug}/campaigns`, { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/login/);
  const me = await request.get("/api/me");
  expect(me.ok()).toBeTruthy();
  const body = await me.json();
  const workspace = body.workspaces?.find((item: { slug: string }) => item.slug === workspaceSlug);
  expect(workspace?.role).toBe("client_viewer");

  const mutation = await request.post("/api/campaigns", {
    data: { workspaceId: workspace.id, name: "Unauthorized viewer campaign", objective: "awareness", platforms: ["instagram"] },
  });
  expect(mutation.status()).toBe(403);
});
