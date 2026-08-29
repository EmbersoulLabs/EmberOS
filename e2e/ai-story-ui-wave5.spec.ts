import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, test, type Page } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000000501";
const campaignId = "00000000-0000-4000-8000-000000000502";
const storyId = "00000000-0000-4000-8000-000000000503";
let authServer: Server;

const draft = {
  title: "A Lily Gift",
  summary: "A considered gift is revealed.",
  objective: "Awareness",
  targetAudience: "Premium gift buyers",
  tone: "Warm",
  estimatedDuration: "15 seconds",
  story: { opening: "A gift box rests closed.", development: "The lily arrangement is revealed.", ending: "The gift lands with quiet confidence." },
  keyMessages: ["Thoughtful gifting"], cta: "Discover the collection", assetReferences: [], warnings: [],
};

function token() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", sub: userId, email: "viewer@example.com" })}.e2e`;
}

beforeAll(async () => {
  authServer = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url?.startsWith("/auth/v1/user")) return response.end(JSON.stringify({ id: userId, aud: "authenticated", role: "authenticated", email: "viewer@example.com", app_metadata: {}, user_metadata: {}, identities: [] }));
    response.end("{}");
  });
  await new Promise<void>((resolve, reject) => authServer.listen(54321, "127.0.0.1", resolve).once("error", reject));
});

afterAll(async () => { if (authServer) await new Promise<void>((resolve) => authServer.close(() => resolve())); });

async function authenticate(page: Page, role: "client_viewer" | "operator") {
  let patchCount = 0;
  let providerCalls = 0;
  await page.addInitScript(() => localStorage.setItem("emberos-locale", "en"));
  await page.route("**/api/**", (route) => {
    const url = route.request().url();
    if (/\/(run|generate|execute|release-next-scene|recover-pre-dispatch)(\/|\?|$)/.test(url)) providerCalls += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workspaces: [{ id: "00000000-0000-4000-8000-000000000504", slug: "wave-5", name: "Wave 5", role }] }) }));
  await page.route(`**/api/campaigns/${campaignId}/ai-stories/${storyId}`, (route) => {
    if (route.request().method() === "PATCH") {
      patchCount += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ story: { id: storyId, status: "pending_review" } }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ story: { id: storyId, status: "pending_review" }, currentVersion: { id: "00000000-0000-4000-8000-000000000505", structuredContent: draft } }) });
  });
  await page.route(`**/api/campaigns/${campaignId}/ai-stories/${storyId}/rewrite`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ storyId, status: "pending_review", previewOnly: true, draft: { ...draft, summary: "A polished, considered gift reveal." } }) }));
  await page.route("**/auth/v1/token**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: token(), token_type: "bearer", expires_in: 3600, refresh_token: "e2e-refresh", user: { id: userId, aud: "authenticated", role: "authenticated", email: "viewer@example.com", app_metadata: {}, user_metadata: {}, identities: [] } }) }));
  await page.goto("/login");
  await page.locator('input[type="email"]').fill("viewer@example.com");
  await page.locator('input[type="password"]').fill("synthetic-only");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/workspaces");
  return { patchCount: () => patchCount, providerCalls: () => providerCalls };
}

test("normal user follows Story, AI Polish, Review, and explicit acceptance", async ({ page }) => {
  const calls = await authenticate(page, "client_viewer");
  await page.goto(`/w/wave-5/campaigns/${campaignId}/ai-stories/${storyId}`);
  await expect(page.getByRole("heading", { name: "Your Story" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Story Review" })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI Polish" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate Animation" })).toBeVisible();
  await expect(page.getByText("Director Thinking", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Beats", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "AI Polish" }).click();
  await expect(page.getByRole("heading", { name: "AI Polish Preview" })).toBeVisible();
  await expect(page.getByText("A polished, considered gift reveal.")).toBeVisible();
  expect(calls.patchCount()).toBe(0);
  await page.getByRole("button", { name: "Accept changes" }).click();
  await expect.poll(calls.patchCount).toBe(1);
  expect(calls.providerCalls()).toBe(0);
});

test("operator diagnostics are server-role bounded and collapsed by default", async ({ page }) => {
  const calls = await authenticate(page, "operator");
  await page.route(`**/api/campaigns/${campaignId}/ai-stories/${storyId}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ story: { id: storyId, status: "ready_for_animation" }, currentVersion: { id: "00000000-0000-4000-8000-000000000505", structuredContent: draft } }) }));
  await page.route(`**/api/campaigns/${campaignId}/ai-stories/${storyId}/planning`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ planningDraft: { completedStages: [] } }) }));
  await page.goto(`/w/wave-5/campaigns/${campaignId}/ai-stories/${storyId}`);
  const diagnostics = page.getByTestId("advanced-planning-diagnostics");
  await expect(diagnostics).toBeVisible();
  await expect(page.getByText("Director Thinking", { exact: true })).not.toBeVisible();
  await diagnostics.locator("summary").click();
  await expect(page.getByRole("button", { name: "Generate Director Thinking" })).toBeVisible();
  expect(calls.providerCalls()).toBe(0);
});

test("mobile normal-user story flow remains reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await authenticate(page, "client_viewer");
  await page.goto(`/w/wave-5/campaigns/${campaignId}/ai-stories/${storyId}`);
  await expect(page.getByRole("heading", { name: "Your Story" })).toBeInViewport();
  const generate = page.getByRole("button", { name: "Generate Animation" });
  await generate.scrollIntoViewIfNeeded();
  await expect(generate).toBeInViewport();
  await expect(page.locator("body")).toHaveCSS("overflow-x", /^(visible|hidden|clip|auto)$/);
  expect(calls.providerCalls()).toBe(0);
});

test("operator manages Campaign Characters on mobile without Provider work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await authenticate(page, "operator");
  let characters: Array<Record<string, unknown>> = [];
  await page.route(`**/api/campaigns/${campaignId}/characters**`, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      characters = [{ characterId: "00000000-0000-4000-8000-000000000506", characterVersionId: "00000000-0000-4000-8000-000000000507", orgId: "00000000-0000-4000-8000-000000000508", workspaceId: "00000000-0000-4000-8000-000000000504", campaignId, version: 1, contractVersion: "ai-story-character.v1", name: body.name, canonicalFacts: { identity: body.identity, appearance: body.appearance, personality: body.personality, emotionalArc: body.emotionalArc, relationships: [] }, visualAssetReferences: [], status: "ACTIVE", fingerprint: `sha256:${"a".repeat(64)}`, supersedesCharacterVersionId: null, createdBy: userId, createdAt: "2026-08-29T00:00:00.000Z" }];
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ character: characters[0] }) });
    }
    if (request.method() === "PATCH") {
      const body = request.postDataJSON(); const current = characters[0]!;
      characters = [{ ...current, version: 2, name: body.character.name, canonicalFacts: { ...(current.canonicalFacts as object), ...body.character } }];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ character: characters[0] }) });
    }
    if (request.method() === "DELETE") { characters = []; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) }); }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ characters }) });
  });
  await page.goto(`/w/wave-5/campaigns/${campaignId}/ai-stories/${storyId}`);
  await page.getByRole("button", { name: "Add Character" }).click();
  await expect(page.getByRole("dialog", { name: "Add Character" })).toBeInViewport();
  await page.getByLabel("Name").fill("Ada");
  await page.getByLabel("Identity").fill("Returning Campaign founder");
  await page.getByLabel("Appearance").fill("Cobalt jacket and silver pin");
  await page.getByLabel("Personality").fill("Patient and direct");
  await page.getByLabel("Emotional arc").fill("Guarded to trusting");
  await page.getByRole("button", { name: "Save Character" }).click();
  await expect(page.getByRole("heading", { name: "Ada" })).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Ada Ren");
  await page.getByRole("button", { name: "Save Character" }).click();
  await expect(page.getByRole("heading", { name: "Ada Ren" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "Ada Ren" })).toHaveCount(0);
  expect(calls.providerCalls()).toBe(0);
});
