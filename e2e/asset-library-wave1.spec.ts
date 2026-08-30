import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, test, type Page } from "@playwright/test";

const workspace = { id: "00000000-0000-4000-8000-000000000010", name: "Wave 1 Workspace", slug: "wave-1" };
const asset = { id: "00000000-0000-4000-8000-000000000020", type: "image", displayName: "Product hero", originalFilename: "product.png", mimeType: "image/png", fileSizeBytes: 2048, status: "ready", createdAt: new Date().toISOString() };
let authServer: Server;

beforeAll(async () => {
  authServer = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url?.startsWith("/auth/v1/user")) {
      response.end(JSON.stringify({ id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "operator@example.com", app_metadata: {}, user_metadata: {}, identities: [] }));
      return;
    }
    response.end("{}");
  });
  await new Promise<void>((resolve, reject) => authServer.listen(54321, "127.0.0.1", resolve).once("error", reject));
});

afterAll(async () => { if (authServer) await new Promise<void>((resolve) => authServer.close(() => resolve())); });

function token() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", sub: "00000000-0000-4000-8000-000000000001", email: "operator@example.com" })}.e2e`;
}

async function authenticate(page: Page) {
  await page.route("**/auth/v1/token**", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: token(), token_type: "bearer", expires_in: 3600, refresh_token: "e2e-refresh", user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "operator@example.com", app_metadata: {}, user_metadata: {}, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() } }) }));
  await page.goto("/login");
  await page.locator('input[type="email"]').fill("operator@example.com");
  await page.locator('input[type="password"]').fill("synthetic-only");
  await page.locator('input[type="checkbox"]').first().check();
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => localStorage.getItem("emberos.auth.email") === "operator@example.com");
}

async function mockLibrary(page: Page) {
  await page.route("**/api/organizations**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ organizations: [] }) }));
  await page.route("**/api/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workspaces: [workspace] }) }));
  await page.route(`**/api/workspaces/${workspace.id}/library?**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assets: [asset] }) }));
  await page.route(`**/api/workspaces/${workspace.id}/stories?**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stories: [{ id: "00000000-0000-4000-8000-000000000030", name: "Launch Story", description: "Ordered product evidence", status: "ready", coverAssetId: asset.id, version: 1, assets: [{ ...asset, sortOrder: 0 }] }] }) }));
  await page.route(`**/api/workspaces/${workspace.id}/library/${asset.id}/download-url`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ downloadUrl: "data:image/png;base64,iVBORw0KGgo=", filename: "product.png", mimeType: "image/png" }) }));
}

for (const viewport of [{ name: "mobile", width: 390, height: 844 }, { name: "desktop", width: 1440, height: 900 }]) {
  test(`Asset Library is usable at ${viewport.name} viewport`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockLibrary(page);
    await authenticate(page);
    await page.goto(`/w/${workspace.slug}/assets`);
    await expect(page.getByRole("heading", { name: "Asset Library" })).toBeVisible();
    await expect(page.getByText("Product hero")).toBeVisible();
    await page.getByRole("button", { name: "Asset Stories" }).click();
    await expect(page.getByText("Launch Story")).toBeVisible();
    await expect(page.getByRole("button", { name: "New Asset Story" })).toBeVisible();
  });
}
