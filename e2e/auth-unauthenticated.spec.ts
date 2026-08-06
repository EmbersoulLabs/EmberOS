import { expect, test } from "@playwright/test";

test("unauthenticated and invalid sessions cannot open protected pages", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, storageState: undefined });
  const page = await context.newPage();
  await page.goto("/workspaces", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login$/);

  await context.addCookies([
    { name: "sb-invalid-auth-token", value: "base64-invalid", url: baseURL! },
  ]);
  await page.goto("/workspaces", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login$/);
  await context.close();
});
