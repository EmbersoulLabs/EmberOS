import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(".env.e2e.local") });
const workspaceSlug = process.env.E2E_WORKSPACE_SLUG?.trim() || "e2e-workspace";

test("operator storage state survives protected navigation and reload", async ({ page, request }) => {
  await page.goto("/workspaces", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/workspaces$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/workspaces$/);
  await page.goto(`/w/${workspaceSlug}/campaigns`, { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/login/);
  const me = await request.get("/api/me");
  expect(me.ok()).toBeTruthy();
  const body = await me.json();
  const workspace = body.workspaces?.find((item: { slug: string }) => item.slug === workspaceSlug);
  expect(["admin", "operator"]).toContain(workspace?.role);
});

test("real login UI establishes a middleware-accepted session", async ({ page, context }) => {
  const email = process.env.E2E_USER_EMAIL?.trim();
  const password = process.env.E2E_USER_PASSWORD?.trim();
  if (!email || !password) throw new Error("Operator E2E credentials are not configured");
  await context.clearCookies();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.locator('form[data-hydrated="true"]').waitFor({ state: "visible" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/workspaces$/, { timeout: 60_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/workspaces$/);
});

test("login authentication errors are visible", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.locator('form[data-hydrated="true"]').waitFor({ state: "visible" });
  await page.locator('input[type="email"]').fill("invalid-e2e-user@local.test");
  await page.locator('input[type="password"]').fill("invalid-password");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("form p.text-red-600")).toBeVisible({ timeout: 30_000 });
});
