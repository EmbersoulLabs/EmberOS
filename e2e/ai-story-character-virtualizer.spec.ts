import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, test, type Page } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000000701";
const workspace = { id: "00000000-0000-4000-8000-000000000702", name: "Virtualizer WS", slug: "wave-cv", role: "operator" };
const campaignId = "00000000-0000-4000-8000-000000000703";
const sourceAssetId = "00000000-0000-4000-8000-000000000704";
const outputAssetId = "00000000-0000-4000-8000-000000000705";
const jobId = "00000000-0000-4000-8000-000000000706";
const characterId = "00000000-0000-4000-8000-000000000707";
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
let authServer: Server;
let saved = false;
let seedanceCalls = 0;

function token() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", sub: userId, email: "operator@example.com" })}.e2e`;
}

beforeAll(async () => {
  authServer = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url?.startsWith("/auth/v1/user")) {
      return response.end(JSON.stringify({ id: userId, aud: "authenticated", role: "authenticated", email: "operator@example.com", app_metadata: {}, user_metadata: {}, identities: [] }));
    }
    response.end("{}");
  });
  await new Promise<void>((resolve, reject) => authServer.listen(54321, "127.0.0.1", resolve).once("error", reject));
});

afterAll(async () => { if (authServer) await new Promise<void>((resolve) => authServer.close(() => resolve())); });

function characterCard() {
  return {
    reusableCharacterId: characterId,
    name: "Alicia",
    portraitAssetId: outputAssetId,
    episodeCount: 0,
    status: "ACTIVE",
    visualClass: "SYNTHETIC_3D",
    virtualStyle: "PREMIUM_3D",
    identityLocked: true,
  };
}

async function authenticate(page: Page) {
  await page.addInitScript(() => localStorage.setItem("emberos-locale", "en"));
  await page.route("**/auth/v1/token**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ access_token: token(), token_type: "bearer", expires_in: 3600, refresh_token: "e2e-refresh", user: { id: userId, aud: "authenticated", role: "authenticated", email: "operator@example.com", app_metadata: {}, user_metadata: {}, identities: [] } }),
  }));
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (/seedance|\/(run|generate|execute|release-next-scene)(\/|\?|$)/.test(url)) seedanceCalls += 1;
    if (url.includes("/api/me")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workspaces: [workspace], isSuperAdmin: false }) });
    }
    if (url.includes(`/api/workspaces/${workspace.id}/library/${sourceAssetId}/preview`) || url.includes(`/api/workspaces/${workspace.id}/library/${outputAssetId}/preview`)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ previewUrl: png, mimeType: "image/png" }) });
    }
    if (url.includes(`/api/workspaces/${workspace.id}/library`) && method === "POST" && !url.includes("/confirm")) {
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ assetId: sourceAssetId, uploadUrl: "http://127.0.0.1:54321/upload", type: "image" }) });
    }
    if (url.includes(`/api/workspaces/${workspace.id}/library/${sourceAssetId}/confirm`)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ asset: { id: sourceAssetId, contentHash: `sha256:${"c".repeat(64)}` } }) });
    }
    if (url.includes("/character-virtualization/source")) {
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ sourceAssetId, semantic: "CHARACTER_SOURCE_PORTRAIT" }) });
    }
    if (url.includes("/character-virtualization/estimate")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ estimate: { category: "CHARACTER_VIRTUALIZATION", currency: "USD", estimatedExpected: "0.04", estimatedMin: "0.02", estimatedMax: "0.06", requiresExplicitAuthorization: true, automaticRetry: false } }) });
    }
    if (url.includes("/character-virtualization/jobs") && method === "POST" && url.endsWith("/jobs")) {
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
        job: {
          id: jobId, orgId: workspace.id, workspaceId: workspace.id, sourceAssetId, sourceContentHash: `sha256:${"c".repeat(64)}`,
          sourceSemantic: "CHARACTER_SOURCE_PORTRAIT", style: "PREMIUM_3D", visualClass: "SYNTHETIC_3D", creativeDirection: null,
          permissionConfirmed: true, status: "SUCCEEDED", acceptanceStatus: "VIRTUAL_CHARACTER_CANDIDATE", provider: "mock",
          providerModel: "character-virtualizer-mock.v1", providerAttemptId: jobId, outputAssetId, outputContentHash: `sha256:${"d".repeat(64)}`,
          outputSemantic: "VIRTUAL_CHARACTER_CANDIDATE", costCategory: "CHARACTER_VIRTUALIZATION", costUsd: "0.04", parentJobId: null,
          automaticRetry: false, reusableCharacterId: null, reusableCharacterVersionId: null, seedanceVideoCalls: 0, realImageProviderCalls: 0,
          userSafeError: null, createdBy: userId, createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
          contractVersion: "ai-story-character-virtualizer.v1",
        },
      }) });
    }
    if (url.includes("/character-virtualization/jobs/") && url.endsWith("/accept") && method === "POST") {
      saved = true;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ character: characterCard() }) });
    }
    if (url.includes(`/api/workspaces/${workspace.id}/reusable-characters`) && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ characters: saved ? [characterCard()] : [] }) });
    }
    if (url.includes(`/api/campaigns/${campaignId}/reusable-characters`)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ characters: [characterCard()] }) });
    }
    if (url.includes(`/api/campaigns/${campaignId}/episode-cost-estimates`)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ estimate: { currency: "USD", estimatedExpected: "1.00", estimatedMin: "0.80", estimatedMax: "1.20" } }) });
    }
    if (url.includes(`/api/campaigns/${campaignId}`) && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ campaign: { id: campaignId, workspaceId: workspace.id }, assets: [] }) });
    }
    if (url.includes("/api/organizations")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ organizations: [] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("http://127.0.0.1:54321/upload", (route) => route.fulfill({ status: 200, body: "ok" }));
  await page.goto("/login");
  await page.locator('input[type="email"]').fill("operator@example.com");
  await page.locator('input[type="password"]').fill("synthetic-only");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/workspaces");
}

test("Characters Create from Photo mocked Premium 3D flow saves Alicia and locks identity in Episode create", async ({ page }) => {
  await authenticate(page);
  await page.goto(`/w/${workspace.slug}/characters`);
  await expect(page.getByRole("heading", { name: "Characters" })).toBeVisible();
  await expect(page.getByTestId("advanced-character-setup")).toHaveCount(0);
  await page.getByTestId("create-character").click();
  await expect(page.getByTestId("character-virtualizer-wizard")).toBeVisible();
  await page.getByTestId("character-source-upload").setInputFiles({
    name: "alicia.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake-portrait"),
  });
  await page.getByTestId("character-permission-confirm").check();
  await expect(page.getByRole("radio", { name: "Premium 3D" })).toBeChecked();
  await expect(page.getByTestId("character-generate")).toBeEnabled();
  await page.getByTestId("character-generate").click();
  await expect(page.getByTestId("character-virtual-preview")).toBeVisible();
  await page.getByTestId("character-use-this").click();
  await page.getByTestId("character-name").fill("Alicia");
  await page.getByTestId("character-save").click();
  await expect(page.getByTestId("character-card").getByRole("heading", { name: "Alicia" })).toBeVisible();
  expect(seedanceCalls).toBe(0);

  await page.goto(`/w/${workspace.slug}/campaigns/${campaignId}/ai-stories/new`);
  await expect(page.getByTestId("episode-create-form")).toBeVisible();
  await page.getByTestId("episode-character-option").filter({ hasText: "Alicia" }).click();
  await expect(page.getByTestId("episode-identity-locked")).toContainText("Identity locked");
  await page.getByTestId("episode-look-outfit").fill("blue jacket");
  await expect(page.getByTestId("episode-look-outfit")).toHaveValue("blue jacket");
  expect(seedanceCalls).toBe(0);
});
