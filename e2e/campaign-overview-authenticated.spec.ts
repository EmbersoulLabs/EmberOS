import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

config({ path: resolve(".env.e2e.local") });
const workspaceSlug = process.env.E2E_WORKSPACE_SLUG?.trim() || "e2e-workspace";
const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

test("authenticated Campaign Overview renders its repaired hierarchy responsively", async ({ page, request }, testInfo) => {
  const meResponse = await request.get("/api/me");
  expect(meResponse.ok()).toBeTruthy();
  const me = await meResponse.json();
  const workspace = me.workspaces?.find((item: { slug: string }) => item.slug === workspaceSlug);
  expect(workspace?.id).toBeTruthy();

  const campaignsResponse = await request.get(`/api/campaigns?workspaceId=${workspace.id}`);
  expect(campaignsResponse.ok()).toBeTruthy();
  const campaignsBody = await campaignsResponse.json();
  const campaign = campaignsBody.data?.campaigns?.[0] ?? campaignsBody.campaigns?.[0];
  expect(campaign?.id, "E2E workspace needs a pre-existing Campaign for Overview verification").toBeTruthy();

  await page.goto(`/w/${workspaceSlug}/campaigns/${campaign.id}`, { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Create Content" })).toBeVisible({ timeout: 30_000 });

  const headings = await page.locator("main h2, main summary").allTextContents();
  let previous = -1;
  for (const expected of ["Marketing Analysis", "Create Content", "Media Assets", "Recent Content", "Recent Tasks", "Activity", "Campaign Settings"]) {
    const current = headings.findIndex((heading) => heading.trim().startsWith(expected));
    expect(current, `${expected} missing or out of order`).toBeGreaterThan(previous);
    previous = current;
  }

  const role = workspace.role as string;
  if (role === "client_viewer") {
    await expect(page.getByText("Operator permission is required").first()).toBeVisible();
    await expect(page.getByText("Create AI Story").last()).toHaveAttribute("aria-disabled", "true");
  } else {
    await expect(page.getByRole("link", { name: "Create AI Story" })).toBeVisible();
  }

  const artifactDir = resolve("test-results/campaign-overview-authenticated", testInfo.project.name);
  mkdirSync(artifactDir, { recursive: true });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Create Content" })).toBeVisible({ timeout: 30_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${viewport.width}x${viewport.height}`).toBe(false);
    await page.screenshot({
      path: resolve(artifactDir, `${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    });
  }
});
