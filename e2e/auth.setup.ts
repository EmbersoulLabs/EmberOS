import { expect, test as setup } from "@playwright/test";
import { config } from "dotenv";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { authenticateContext } from "./helpers/auth";
import { cleanupInterruptedE2ECampaigns } from "./helpers/campaign-cleanup";

config({ path: resolve(".env.e2e.local") });
config({ path: resolve(".env.local") });

const authDir = resolve("e2e/.auth");
mkdirSync(authDir, { recursive: true });

for (const role of ["operator", "viewer"] as const) {
  setup(`create ${role} authenticated state`, async ({ page, context }) => {
    const email = process.env[role === "operator" ? "E2E_USER_EMAIL" : "E2E_VIEWER_EMAIL"]?.trim();
    const password = process.env[
      role === "operator" ? "E2E_USER_PASSWORD" : "E2E_VIEWER_PASSWORD"
    ]?.trim();
    if (!email || !password) throw new Error(`${role} E2E credentials are not configured`);

    const result = await authenticateContext(context, { email, password });
    expect(result.cookieNames.some((name) => name.endsWith("-auth-token.0") || name.endsWith("-auth-token"))).toBeTruthy();
    await page.goto("/workspaces", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/workspaces$/);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/workspaces$/);
    if (role === "operator") {
      const meResponse = await page.request.get("/api/me");
      expect(meResponse.ok()).toBeTruthy();
      const me = (await meResponse.json()) as {
        workspaces?: Array<{ id: string; slug: string }>;
      };
      const workspaceSlug = process.env.E2E_WORKSPACE_SLUG?.trim() || "e2e-workspace";
      const workspace = me.workspaces?.find((item) => item.slug === workspaceSlug);
      expect(workspace, `E2E workspace ${workspaceSlug} was not found`).toBeTruthy();
      await cleanupInterruptedE2ECampaigns(page.request, workspace!.id);
    }
    await context.storageState({ path: resolve(authDir, `${role}.json`) });
  });
}
