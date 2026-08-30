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
  const photoAssetId = "00000000-0000-4000-8000-000000000509";
  let characters: Array<Record<string, unknown>> = [];
  await page.route(`**/api/campaigns/${campaignId}/assets/upload-url`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assetId: photoAssetId, uploadUrl: "https://upload.example.test/character-photo" }) });
  });
  await page.route("https://upload.example.test/character-photo", async (route) => {
    await route.fulfill({ status: 200, body: "" });
  });
  await page.route(`**/api/campaigns/${campaignId}/assets/${photoAssetId}/confirm`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assetId: photoAssetId, status: "READY" }) });
  });
  await page.route(`**/api/campaigns/${campaignId}/characters**`, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      characters = [{ characterId: "00000000-0000-4000-8000-000000000506", characterVersionId: "00000000-0000-4000-8000-000000000507", orgId: "00000000-0000-4000-8000-000000000508", workspaceId: "00000000-0000-4000-8000-000000000504", campaignId, version: 1, contractVersion: "ai-story-character.v1", name: body.name, canonicalFacts: { identity: body.identity, appearance: body.appearance, personality: body.personality, emotionalArc: body.emotionalArc, relationships: [] }, visualAssetReferences: body.visualAssetIds.map((assetId: string) => ({ assetId, role: "REFERENCE" })), status: "ACTIVE", fingerprint: `sha256:${"a".repeat(64)}`, supersedesCharacterVersionId: null, createdBy: userId, createdAt: "2026-08-29T00:00:00.000Z" }];
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
  await page.getByLabel("Choose Character reference photo").setInputFiles({ name: "ada.png", mimeType: "image/png", buffer: Buffer.from("synthetic-character-photo") });
  await expect(page.getByRole("img", { name: "Character reference 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove photo" })).toBeVisible();
  await page.getByRole("button", { name: "Save Character" }).click();
  await expect(page.getByRole("heading", { name: "Ada" })).toBeVisible();
  await expect(page.getByText("1 reference photo", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Ada Ren");
  await page.getByRole("button", { name: "Save Character" }).click();
  await expect(page.getByRole("heading", { name: "Ada Ren" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "Ada Ren" })).toHaveCount(0);
  expect(calls.providerCalls()).toBe(0);
});

test("operator manages Story-local supporting cast on mobile without global Ephemeral UI or Provider work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await authenticate(page, "operator"); let cast: Array<Record<string, unknown>> = [];
  await page.route(`**/api/campaigns/${campaignId}/ai-stories/${storyId}/supporting-cast**`, async (route) => { const request=route.request(); if(request.url().endsWith("/promote"))return route.fulfill({status:201,contentType:"application/json",body:JSON.stringify({promotion:{}})}); if(request.method()==="POST"){const body=request.postDataJSON();cast=[{supportingCharacterId:"00000000-0000-4000-8000-000000000601",supportingCharacterVersionId:"00000000-0000-4000-8000-000000000602",orgId:"00000000-0000-4000-8000-000000000503",workspaceId:"00000000-0000-4000-8000-000000000504",campaignId,storyId,version:1,contractVersion:"ai-story-cast.v1",displayName:body.displayName,identity:body.identity,storyRole:body.storyRole,appearance:body.appearance,relationships:[],continuityFacts:body.continuityFacts,visualAssetReferences:[],status:"ACTIVE",fingerprint:`sha256:${"b".repeat(64)}`,supersedesSupportingCharacterVersionId:null,createdBy:userId,createdAt:"2026-08-29T00:00:00.000Z"}];return route.fulfill({status:201,contentType:"application/json",body:JSON.stringify({supportingCharacter:cast[0]})});}if(request.method()==="PATCH"){const body=request.postDataJSON();cast=[{...cast[0],version:2,displayName:body.supportingCharacter.displayName}];return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({supportingCharacter:cast[0]})});}if(request.method()==="DELETE"){cast=[];return route.fulfill({status:200,contentType:"application/json",body:"{}"});}return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({supportingCharacters:cast})}); });
  await page.goto(`/w/wave-5/campaigns/${campaignId}/ai-stories/${storyId}`); await page.getByRole("button",{name:"Add supporting Character"}).click(); await expect(page.getByRole("dialog",{name:"Add supporting Character"})).toBeInViewport(); await page.getByLabel("Name").fill("River"); await page.getByLabel("Story identity").fill("Recurring Story-local witness"); await page.getByLabel("Story role").fill("synthetic unknown role"); await page.getByLabel("Appearance").fill("Silver coat"); await page.getByLabel("Continuity facts").fill("Returns in Scene 3"); await page.getByRole("button",{name:"Save supporting Character"}).click(); await expect(page.getByRole("heading",{name:"River"})).toBeVisible(); await page.getByRole("button",{name:"Edit"}).click(); await page.getByLabel("Name").fill("River Vale"); await page.getByRole("button",{name:"Save supporting Character"}).click(); await expect(page.getByRole("heading",{name:"River Vale"})).toBeVisible(); page.once("dialog",(dialog)=>dialog.accept()); await page.getByRole("button",{name:"Delete"}).click(); await expect(page.getByRole("heading",{name:"River Vale"})).toHaveCount(0); await expect(page.getByTestId("supporting-cast-panel")).not.toContainText("Ephemeral Actor Panel"); expect(calls.providerCalls()).toBe(0);
});

async function mockGeneratedSceneWorkspace(page: Page) {
  const planId = "00000000-0000-4000-8000-000000000701";
  const sceneExecutionId = "00000000-0000-4000-8000-000000000702";
  const attemptId = "synthetic-attempt-one";
  await page.route(new RegExp(`/api/campaigns/${campaignId}/ai-stories/${storyId}(?:\\?.*)?$`), (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ story: { id: storyId, status: "execution_review" }, currentVersion: { id: "00000000-0000-4000-8000-000000000505", structuredContent: draft } }),
  }));
  await page.route(new RegExp(`/api/campaigns/${campaignId}/ai-stories/${storyId}/execution-plans/current(?:\\?.*)?$`), (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ executionPlan: { executionPlanId: planId, status: "EXECUTING", storyVersionId: "00000000-0000-4000-8000-000000000703", animationPackageId: "00000000-0000-4000-8000-000000000704", sceneIntentCount: 1, compiledAt: "2026-08-30T00:00:00.000Z" } }),
  }));
  await page.route(new RegExp(`/api/campaigns/${campaignId}/ai-stories/${storyId}/execution-plans/${planId}/runtime(?:\\?.*)?$`), (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      contractVersion: "1", executionPlanId: planId, runtimeAuthorizationId: "00000000-0000-4000-8000-000000000705", status: "SCENES_COMPLETE", runtimeProjectionVersion: 1,
      requiredSceneCount: 1, succeededSceneCount: 1, failedSceneCount: 0, reconciliationCount: 0, assemblyState: "NONE", hasFinalStoryResult: false, canExecute: false, safeFailureSummary: null,
      generatedSceneReviews: [{
        sceneExecutionId, sceneId: "00000000-0000-4000-8000-000000000706", sceneOrder: 0, reviewState: "PENDING_REVIEW", runtimeState: "PENDING_REVIEW", reviewAvailable: true, recoveryMode: null,
        approvedAttemptId: null, approvedSceneResultId: null, latestAttemptId: attemptId, latestReviewId: "00000000-0000-4000-8000-000000000707", retryEligibility: null, retryInputRevisionId: null, retryAuthorizationId: null,
        latestAttemptNumber: 1, latestAttemptStatus: "SUCCEEDED", attemptCount: 1, retryRemaining: 2, maxAttempts: 3, latestAttemptKnownCost: 0.25, sceneKnownCost: 0.25, currency: "USD", running: false,
        attempts: [{ attemptId, attemptNumber: 1, providerExecutionId: null, status: "SUCCEEDED", outcome: "success", sceneResultId: "00000000-0000-4000-8000-000000000708", reviewState: "PENDING_REVIEW", failureClass: null, knownCostAmount: 0.25, costSource: "estimate", createdAt: "2026-08-30T00:00:00.000Z", completedAt: "2026-08-30T00:00:10.000Z" }],
        generatedMedia: { mediaId: "00000000-0000-4000-8000-000000000709", sceneResultId: "00000000-0000-4000-8000-000000000708", sceneExecutionId, providerAttemptId: attemptId, mediaType: "video", contentType: "video/mp4", deliveryUrl: "https://media.example.test/scene.mp4", expiresAt: "2026-08-30T01:00:00.000Z", deliveryStatus: "READY", safeError: null },
        presentation: { title: "Scene 1", summary: "Ari hands the sample to River", purpose: "Reveal", importance: "Major", transitional: false, cast: [{ castId: "00000000-0000-4000-8000-000000000710", kind: "Character", displayName: "Ari", description: "Campaign founder", referenceAssetIds: [], recurringInStory: true }, { castId: "00000000-0000-4000-8000-000000000711", kind: "Supporting Character", displayName: "River", description: "Story-local witness", referenceAssetIds: [], recurringInStory: true }, { castId: "00000000-0000-4000-8000-000000000712", kind: "Scene actor", displayName: "Visitor", description: "Temporary participant", referenceAssetIds: [], recurringInStory: false }], location: { locationId: "00000000-0000-4000-8000-000000000713", kind: "Story location", displayName: "Unknown atrium", description: "Bright open space", referenceAssetIds: [], promotionAction: "REUSE_IN_CAMPAIGN" }, products: [{ productAuthorityId: "00000000-0000-4000-8000-000000000714", displayName: "Sample object", referenceAssetId: "00000000-0000-4000-8000-000000000715" }], actionSummary: ["Ari hands the sample to River"], startsWith: ["Possession: Ari holds the sample"], endsWith: ["Possession: River holds the sample"], continuityNotes: [], legacyCompatibility: false },
        postGenerationQcEvidence: { postQcEvaluationId: "00000000-0000-4000-8000-000000000716", aggregateStatus: "POST_QC_WARN", sceneSummary: "The transfer is visible but the final grip needs checking.", findings: [{ category: "END_STATE", result: "WARN", reason: "Check who holds the sample at the end", evidenceSummary: "The final hand position is partly obscured.", repairOwner: "PROVIDER_EXECUTION", confidence: "MEDIUM", waiverPolicy: "WAIVABLE_BY_HUMAN" }], warningsMayBeAccepted: true, hardFailureWaiverPolicy: "EXPLICIT_NON_WAIVABLE_INTEGRITY_DENIAL", humanDecisionRequired: true },
      }], pendingReviewSceneCount: 1, approvedSceneCount: 0, derivedAt: "2026-08-30T00:00:15.000Z",
    }),
  }));
  await page.route(new RegExp(`/api/campaigns/${campaignId}/ai-stories/${storyId}/execution-plans/${planId}/review(?:/history)?(?:\\?.*)?$`), (route) => route.fulfill({
    status: 404, contentType: "application/json", body: JSON.stringify({ error: "No advanced review record", code: "NOT_FOUND" }),
  }));
}

test("operator reviews Scene, Cast, Location, Product, video, and QC without Provider internals", async ({ page }) => {
  const calls = await authenticate(page, "operator");
  await mockGeneratedSceneWorkspace(page);
  await page.goto(`/w/wave-5/campaigns/${campaignId}/ai-stories/${storyId}`);
  const card = page.getByTestId("scene-review-card-0");
  await expect(page.getByTestId("scene-review-workspace")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ari hands the sample to River" })).toBeVisible();
  await expect(card.getByText("Supporting Character · Recurring", { exact: true })).toBeVisible();
  await expect(card.getByText("Unknown atrium", { exact: true })).toBeVisible();
  await expect(card.getByText(/Sample object/)).toBeVisible();
  await expect(page.getByTestId("generated-scene-media-preview-0")).toBeVisible();
  await expect(page.getByText("Check recommended", { exact: true })).toBeVisible();
  await expect(page.getByText("The final hand position is partly obscured.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve Scene" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Needs changes" })).toBeVisible();
  await expect(page.getByText(/fingerprint|provider task|reference budget/i)).toHaveCount(0);
  expect(calls.providerCalls()).toBe(0);
});

test("mobile generated Scene review keeps evidence, video, and actions reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await authenticate(page, "operator");
  await mockGeneratedSceneWorkspace(page);
  await page.goto(`/w/wave-5/campaigns/${campaignId}/ai-stories/${storyId}`);
  const card = page.getByTestId("scene-review-card-0");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeInViewport();
  await expect(page.getByTestId("generated-scene-media-preview-0")).toBeVisible();
  await expect(page.getByTestId("post-qc-evidence-0")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve Scene" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Needs changes" })).toBeVisible();
  expect(calls.providerCalls()).toBe(0);
});
