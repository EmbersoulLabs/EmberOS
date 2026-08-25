import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, test, type Page } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000000001";
const orgId = "00000000-0000-4000-8000-000000000002";
const workspace = {
  id: "00000000-0000-4000-8000-000000000010",
  orgId,
  name: "Wave 2 Workspace",
  slug: "wave-2",
};
let authServer: Server;
let saveRequestCount = 0;

function token() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    role: "authenticated",
    sub: userId,
    email: "operator@example.com",
  })}.e2e`;
}

const profile = {
  id: "00000000-0000-4000-8000-000000000020",
  orgId,
  workspaceId: workspace.id,
  companyName: "Wave 2 Company",
  industryId: "retail",
  industryDisplayName: "Retail",
  industryCustomValue: null,
  services: ["Retail"],
  businessDescription: "A test business profile.",
  targetAudience: "Local customers",
  businessHours: [],
  businessEmail: "hello@example.com",
  businessPhone: "+6591234567",
  whatsappBusiness: null,
  website: null,
  facebook: null,
  instagram: null,
  tiktok: null,
  youtube: null,
  redNote: null,
  linkedIn: null,
  country: "Singapore",
  stateProvince: null,
  city: "Singapore",
  address: "1 Test Street",
  postalCode: "123456",
  timezone: "Asia/Singapore",
  brandPersonality: ["Friendly"],
  brandStyle: ["Modern"],
  brandValues: ["Reliable"],
  brandKeywords: ["quality"],
  logo: null,
  brandColors: [],
  brandFonts: [],
  brandImages: [],
  supportedLanguages: ["English"],
  defaultPublishingPlatforms: ["instagram"],
  unrecognizedPublishingPlatforms: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdBy: userId,
  updatedBy: userId,
  deletedAt: null,
  version: 1,
};

beforeAll(async () => {
  authServer = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url?.startsWith("/auth/v1/user")) {
      response.end(
        JSON.stringify({
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "operator@example.com",
          app_metadata: {},
          user_metadata: {},
          identities: [],
        })
      );
      return;
    }
    response.end("{}");
  });
  await new Promise<void>((resolve, reject) =>
    authServer.listen(54321, "127.0.0.1", resolve).once("error", reject)
  );
});

afterAll(async () => {
  if (authServer) await new Promise<void>((resolve) => authServer.close(() => resolve()));
});

async function authenticate(page: Page) {
  await page.addInitScript(() => localStorage.setItem("emberos-locale", "en"));
  await page.route("**/auth/v1/token**", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: token(),
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "e2e-refresh",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "operator@example.com",
          app_metadata: {},
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }),
    })
  );
  await page.goto("/login");
  await page.locator('input[type="email"]').fill("operator@example.com");
  await page.locator('input[type="password"]').fill("synthetic-only");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/workspaces");
}

async function mockProfile(page: Page, failSave = false) {
  saveRequestCount = 0;
  let stored = { ...profile };
  await page.route("**/api/organizations**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{\"organizations\":[]}" })
  );
  await page.route("**/api/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ workspaces: [workspace] }),
    })
  );
  await page.route(`**/api/workspaces/${workspace.id}/business-profile`, async (route) => {
    if (route.request().method() === "PATCH") {
      saveRequestCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (failSave) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic save failure" }),
        });
        return;
      }
      const patch = route.request().postDataJSON();
      stored = { ...stored, ...patch, version: stored.version + 1, updatedAt: new Date().toISOString() };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ profile: stored }),
    });
  });
}

test("mobile platform editing exposes truthful dirty, saving, and saved states", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockProfile(page);
  await authenticate(page);
  await page.goto(`/w/${workspace.slug}/business-profile`);

  await expect(page.getByRole("heading", { name: "Business Profile" })).toBeVisible();
  const sticky = page.getByTestId("business-profile-mobile-save-status");
  await expect(sticky).toContainText("Saved");
  await page.getByRole("button", { name: "TikTok" }).click();
  await expect(sticky.getByRole("button", { name: "Save Changes" })).toBeVisible();
  await sticky.getByRole("button", { name: "Save Changes" }).click();
  await expect(sticky).toContainText("Saving...");
  await expect(sticky).toContainText("Saved");
  await page.reload();
  await expect(page.getByRole("button", { name: "TikTok" })).toHaveAttribute("aria-pressed", "true");
});

test("failed mobile save remains dirty and actionable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockProfile(page, true);
  await authenticate(page);
  await page.goto(`/w/${workspace.slug}/business-profile`);
  const sticky = page.getByTestId("business-profile-mobile-save-status");
  await page.getByRole("button", { name: "TikTok" }).click();
  await sticky.getByRole("button", { name: "Save Changes" }).click();
  await expect(sticky.getByRole("button", { name: "Save Failed" })).toBeVisible();
  await page.waitForTimeout(1_100);
  expect(saveRequestCount).toBe(1);
});

test("desktop retains vertical cards and upper save controls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockProfile(page);
  await authenticate(page);
  await page.goto(`/w/${workspace.slug}/business-profile`);
  await expect(page.getByRole("heading", { name: "Business Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Publishing Platforms" })).toBeVisible();
  await expect(page.getByTestId("business-profile-mobile-save-status")).toBeHidden();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
});
