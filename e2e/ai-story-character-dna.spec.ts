import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, test, type Page } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000000801";
const workspace = { id: "00000000-0000-4000-8000-000000000802", name: "DNA WS", slug: "wave-dna", role: "operator" };
const campaignId = "00000000-0000-4000-8000-000000000803";
const sourceAssetId = "00000000-0000-4000-8000-000000000804";
const jobId = "00000000-0000-4000-8000-000000000805";
const characterId = "00000000-0000-4000-8000-000000000806";
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const hash = `sha256:${"c".repeat(64)}`;
let authServer: Server;
let saved = false;
let imageGenerationCalls = 0;
let seedanceCalls = 0;

const proposedDna = {
  identityDescription: "Oval-faced adult with shoulder-length dark straight hair and a calm friendly expression.",
  face: { shape: "oval face", jawline: "soft jawline", forehead: "medium forehead", cheeks: "soft cheeks", chin: "rounded chin" },
  eyes: { shape: "almond-shaped eyes", size: "medium eyes", colorDescription: "dark brown eyes", eyebrowShape: "naturally arched brows" },
  nose: { bridge: "straight bridge", width: "medium width", tip: "rounded tip" },
  mouth: { lipShape: "soft lip shape", lipFullness: "medium lips" },
  hair: { length: "shoulder-length hair", texture: "straight hair", parting: "center-adjacent parting", style: "loose straight style", colorDescription: "dark hair" },
  body: { build: "petite natural build", proportionDescription: "petite natural proportions", heightImpression: "average-to-petite height impression" },
  appearance: { defaultExpression: "calm friendly expression", overallImpression: "clean commercial presenter look", presentationStyle: "natural on-camera presentation" },
  distinctiveVisualFacts: ["small beauty mark near the left eye"],
  mustPreserve: ["face structure", "eye shape", "nose structure", "hair identity", "body proportions"],
  mutableTraits: ["outfit", "makeup", "accessories", "expression", "pose", "location"],
  sourceAssetId,
  sourceContentHash: hash,
  analysisVersion: "ai-story-character-dna-analysis.v1",
  createdAt: "2026-09-23T00:00:00.000Z",
};

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
    portraitAssetId: sourceAssetId,
    episodeCount: 0,
    status: "ACTIVE",
    identityMode: "CHARACTER_DNA",
    characterDnaCertified: true,
    portraitLabel: "Source photo",
    identityLocked: true,
  };
}

async function authenticate(page: Page) {
  await page.route("**/auth/continue", (route) => route.fulfill({ status: 307, headers: { location: "/workspaces" } }));
  await page.addInitScript(() => localStorage.setItem("emberos-locale", "en"));
  await page.route("**/auth/v1/token**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ access_token: token(), token_type: "bearer", expires_in: 3600, refresh_token: "e2e-refresh", user: { id: userId, aud: "authenticated", role: "authenticated", email: "operator@example.com", app_metadata: {}, user_metadata: {}, identities: [] } }),
  }));
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (/seedance|gpt-image|images\/generations|\/(run|generate|execute|release-next-scene)(\/|\?|$)/.test(url)) {
      if (/seedance|\/(run|generate|execute|release-next-scene)/.test(url)) seedanceCalls += 1;
      if (/gpt-image|images\/generations/.test(url)) imageGenerationCalls += 1;
    }
    if (url.includes("/api/me")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workspaces: [workspace], isSuperAdmin: false }) });
    }
    if (url.includes(`/api/workspaces/${workspace.id}/library/${sourceAssetId}/preview`)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ previewUrl: png, mimeType: "image/png" }) });
    }
    if (url.includes(`/api/workspaces/${workspace.id}/library`) && method === "POST" && !url.includes("/confirm")) {
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ assetId: sourceAssetId, uploadUrl: "http://127.0.0.1:54321/upload", type: "image" }) });
    }
    if (url.includes(`/api/workspaces/${workspace.id}/library/${sourceAssetId}/confirm`)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ asset: { id: sourceAssetId, contentHash: hash } }) });
    }
    if (url.includes("/character-dna/source")) {
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ sourceAssetId, semantic: "CHARACTER_SOURCE_PORTRAIT" }) });
    }
    if (url.includes("/character-dna/analyze") && method === "POST") {
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
        job: {
          id: jobId, workspaceId: workspace.id, sourceAssetId, sourceSemantic: "CHARACTER_SOURCE_PORTRAIT",
          status: "SUCCEEDED", approvalStatus: "PENDING_HUMAN_REVIEW", proposedDna, characterDnaFingerprint: `sha256:${"d".repeat(64)}`,
          costCategory: "CHARACTER_DNA_ANALYSIS", costUsd: "0.0010", imageGenerationCalls: 0, userSafeError: null,
        },
      }) });
    }
    if (url.includes("/character-dna/jobs/") && url.endsWith("/save") && method === "POST") {
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

test("Characters Create from Photo analyzes DNA, edits, saves, and locks identity in Episode create", async ({ page }) => {
  await authenticate(page);
  await page.goto(`/w/${workspace.slug}/characters`);
  await expect(page.getByRole("heading", { name: "Characters" })).toBeVisible();
  await expect(page.getByTestId("character-virtualizer-wizard")).toHaveCount(0);
  await page.getByTestId("create-character").click();
  await expect(page.getByTestId("character-dna-wizard")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Premium 3D" })).toHaveCount(0);
  await page.getByTestId("character-source-upload").setInputFiles({
    name: "alicia.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake-portrait"),
  });
  await page.getByTestId("character-permission-confirm").check();
  await page.getByTestId("character-analyze").click();
  await expect(page.getByTestId("character-dna-review")).toBeVisible();
  await page.getByTestId("character-dna-hair").fill("chin-length dark straight hair");
  await page.getByTestId("character-name").fill("Alicia");
  await page.getByTestId("character-save").click();
  await expect(page.getByTestId("character-card").getByRole("heading", { name: "Alicia" })).toBeVisible();
  await expect(page.getByTestId("character-dna-badge")).toContainText("Character DNA");
  expect(imageGenerationCalls).toBe(0);
  expect(seedanceCalls).toBe(0);

  await page.goto(`/w/${workspace.slug}/campaigns/${campaignId}/ai-stories/new`);
  await expect(page.getByTestId("episode-create-form")).toBeVisible();
  await page.getByTestId("episode-character-option").filter({ hasText: "Alicia" }).click();
  await expect(page.getByTestId("episode-identity-locked")).toContainText("Identity locked");
  await page.getByTestId("episode-look-outfit").fill("White blouse");
  await expect(page.getByTestId("episode-look-outfit")).toHaveValue("White blouse");
  expect(imageGenerationCalls).toBe(0);
  expect(seedanceCalls).toBe(0);
});
