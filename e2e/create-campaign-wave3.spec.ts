import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, test, type Page } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000000001";
const workspace = { id: "00000000-0000-4000-8000-000000000010", orgId: "00000000-0000-4000-8000-000000000002", name: "Wave 3", slug: "wave-3" };
const asset = { id: "00000000-0000-4000-8000-000000000020", type: "image", displayName: "Product", originalFilename: "product.png", status: "ready" };
const story = { id: "00000000-0000-4000-8000-000000000030", name: "Launch Story", status: "ready", assets: [asset] };
let authServer: Server;

function token() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", sub: userId, email: "operator@example.com" })}.e2e`;
}

beforeAll(async () => {
  authServer = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url?.startsWith("/auth/v1/user")) return response.end(JSON.stringify({ id: userId, aud: "authenticated", role: "authenticated", email: "operator@example.com", app_metadata: {}, user_metadata: {}, identities: [] }));
    response.end("{}");
  });
  await new Promise<void>((resolve, reject) => authServer.listen(54321, "127.0.0.1", resolve).once("error", reject));
});

afterAll(async () => { if (authServer) await new Promise<void>((resolve) => authServer.close(() => resolve())); });

async function authenticate(page: Page) {
  await page.addInitScript(() => localStorage.setItem("emberos-locale", "en"));
  await page.route("**/auth/v1/token**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: token(), token_type: "bearer", expires_in: 3600, refresh_token: "e2e-refresh", user: { id: userId, aud: "authenticated", role: "authenticated", email: "operator@example.com", app_metadata: {}, user_metadata: {}, identities: [] } }) }));
  await page.goto("/login");
  await page.locator('input[type="email"]').fill("operator@example.com");
  await page.locator('input[type="password"]').fill("synthetic-only");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/workspaces");
}

async function mockWizard(page: Page) {
  await page.route("**/api/organizations**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{\"organizations\":[]}" }));
  await page.route("**/api/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workspaces: [workspace] }) }));
  await page.route(`**/api/workspaces/${workspace.id}/business-profile`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: { defaultPublishingPlatforms: ["instagram"] } }) }));
  await page.route(`**/api/workspaces/${workspace.id}/library**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assets: [asset] }) }));
  await page.route(`**/api/workspaces/${workspace.id}/stories**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stories: [story] }) }));
  await page.route(`**/api/workspaces/${workspace.id}/audience/suggest`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "Singapore gift buyers seeking premium floral presents", proposal: true }) }));
  await page.route(`**/api/workspaces/${workspace.id}/campaign-brief/assist`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "Polished launch brief", proposal: true }) }));
}

test("desktop five-step flow uses defaults, explicit AI acceptance, and automatic handoff", async ({ page }) => {
  await mockWizard(page); await authenticate(page);
  let createPayload: Record<string, unknown> | null = null;
  await page.route("**/api/campaigns/create", async (route) => { createPayload = route.request().postDataJSON(); await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ campaignId: "00000000-0000-4000-8000-000000000040", taskId: "00000000-0000-4000-8000-000000000050" }) }); });
  await page.goto(`/w/${workspace.slug}/campaigns/new`);
  await page.getByLabel("Campaign Name").fill("Launch Campaign"); await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: "Instagram" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("textbox", { name: "Target Audience", exact: true }).fill("Initial audience");
  await page.getByRole("button", { name: "Suggest with AI" }).click();
  await expect(page.getByRole("textbox", { name: "Target Audience", exact: true })).toHaveValue("Initial audience");
  await page.getByRole("button", { name: "Accept" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Product", { exact: true }).click(); await page.getByText("Launch Story", { exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/Campaign Brief/).fill("Launch our premium gift");
  await page.getByRole("button", { name: /polish/i }).click();
  await page.getByRole("button", { name: "Accept" }).click(); await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Inferred Language")).toBeVisible();
  await expect(page.getByText(/AI Output Language|Subtitle Language|Voice|BGM|Content Style/)).toHaveCount(0);
  await page.getByRole("button", { name: "Create Campaign" }).click();
  await page.waitForURL("**/task?taskId=00000000-0000-4000-8000-000000000050");
  expect(createPayload).toMatchObject({ name: "Launch Campaign", objective: "awareness", publishingPlatforms: ["instagram"], campaignBrief: "Polished launch brief" });
});

test("mobile wizard remains reachable and preserves back navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await mockWizard(page); await authenticate(page);
  await page.goto(`/w/${workspace.slug}/campaigns/new`);
  await page.getByLabel("Campaign Name").fill("Mobile Campaign"); await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: "Target Audience", exact: true }).fill("Mobile audience"); await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Campaign Name")).toHaveValue("Mobile Campaign");
  await expect(page.getByRole("button", { name: "Continue" })).toBeInViewport();
});
