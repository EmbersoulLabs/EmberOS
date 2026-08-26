import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, test, type Page } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000000001";
const workspace = { id: "00000000-0000-4000-8000-000000000010", name: "Wave 4", slug: "wave-4", role: "operator" };
const campaignId = "00000000-0000-4000-8000-000000000040";
const taskId = "00000000-0000-4000-8000-000000000050";
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

async function mockWorkspace(page: Page) {
  let providerCalls = 0;
  await page.route("**/api/**", (route) => {
    const url = route.request().url();
    if (/\/(run|generate|execute|release-next-scene|recover-pre-dispatch)(\/|\?|$)/.test(url)) providerCalls += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workspaces: [workspace] }) }));
  await page.route(`**/api/campaigns/${campaignId}/ai-stories`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stories: [{ id: "00000000-0000-4000-8000-000000000060", title: "Launch Story", status: "pending_review" }] }) }));
  await page.route(`**/api/campaigns/${campaignId}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    campaign: { id: campaignId, name: "Premium Launch", status: "processing", objective: "awareness", platforms: ["instagram", "tiktok"], targetAudience: { summary: "Premium gift buyers" }, campaignBrief: "Show the product with confidence.", createdAt: "2026-08-25T01:00:00.000Z", updatedAt: "2026-08-25T02:00:00.000Z" },
    assets: [{ id: "00000000-0000-4000-8000-000000000020", type: "image", storagePath: "private/product.png", displayName: "Product", status: "ready" }],
    assetStories: [{ id: "00000000-0000-4000-8000-000000000030", name: "Product Story", status: "ready" }],
    task: { id: taskId, status: "running", createdAt: "2026-08-25T01:01:00.000Z", updatedAt: "2026-08-25T02:01:00.000Z", stepProgress: {} },
    creative: null, creatives: [], hasVideoAsset: false, clipCount: 0, canDelete: false,
  }) }));
  return () => providerCalls;
}

test("Campaign Workspace presents the Blueprint shell with main-owned actions", async ({ page }) => {
  await authenticate(page);
  const providerCalls = await mockWorkspace(page);
  await page.goto(`/w/${workspace.slug}/campaigns/${campaignId}`);

  await expect(page.getByRole("heading", { name: "Premium Launch" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Continue Campaign" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Premium gift buyers")).toBeVisible();
  await expect(page.getByText("Product Story")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Photo Scene", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Video Studio" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI Story" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Marketing Package" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run CEO", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Generate Again", exact: true })).toHaveCount(0);
  await expect(page.locator('section[aria-labelledby="campaign-overview-title"] input, section[aria-labelledby="campaign-overview-title"] textarea, section[aria-labelledby="campaign-overview-title"] select')).toHaveCount(0);
  expect(providerCalls()).toBe(0);
});

test("mobile Campaign Workspace and Campaign Open affordance remain reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await authenticate(page);
  const providerCalls = await mockWorkspace(page);
  await page.goto(`/w/${workspace.slug}/campaigns/${campaignId}`);
  await expect(page.getByRole("link", { name: "Continue workflow" })).toBeInViewport();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  await page.route("**/api/campaigns?workspaceId=**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ campaigns: [{ id: campaignId, name: "Premium Launch", status: "processing", goal: "Awareness", platforms: ["instagram"], canDelete: false }] }) }));
  await page.goto(`/w/${workspace.slug}/campaigns`);
  await expect(page.getByRole("link", { name: "Open Premium Launch" })).toBeInViewport();
  expect(providerCalls()).toBe(0);
});
