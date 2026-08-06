/**
 * Sprint 3 Phase 2B PR 2B.5 — Browser E2E for Review & Assembly UI.
 *
 * Seeds an Execution Plan via scripts/e2e-seed-ai-story-review-plan.ts (tsx + DATABASE_URL),
 * then exercises the AI Story page against real PR 2B.4 APIs.
 */
import { test, expect, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { config } from "dotenv";
import { authenticateContext } from "./helpers/auth";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

config({ path: resolve(".env.e2e.local") });
config({ path: resolve(".env.local") });
config({ path: resolve("apps/worker/.env") });

const email = process.env.E2E_USER_EMAIL?.trim();
const password = process.env.E2E_USER_PASSWORD?.trim();
const viewerEmail = process.env.E2E_VIEWER_EMAIL?.trim() || "e2e.viewer@local.test";
const viewerPassword = process.env.E2E_VIEWER_PASSWORD?.trim() || process.env.E2E_USER_PASSWORD?.trim();
const workspaceSlug = process.env.E2E_WORKSPACE_SLUG?.trim() || "e2e-workspace";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

const hasAuth = Boolean(email && password && supabaseUrl && supabaseAnon);
const hasDb = Boolean(databaseUrl);
const hasViewerSetup = Boolean(hasAuth && hasDb && serviceRole && viewerPassword);

const FORBIDDEN_ERROR_UI_PATTERNS = [
  /\bSQL\b/,
  /stack\s*trace/i,
  /PostgreSQL/i,
  /select\s+\*\s+from/i,
  /ExecutionPlanReviewRepository/i,
  /ExecutionPlanAssemblyRepository/i,
  /[A-Za-z]:\\Users\\/i,
  /DATABASE_URL/,
  /api[_-]?key/i,
  /providerCredentials/i,
  /negativePrompt/i,
  /systemPrompt/i,
  /instructionSnapshot/i,
  /providerPayload/i,
];

const FORBIDDEN_DOM_PATTERNS = [
  /providerCredentials/i,
  /negativePrompt/i,
  /systemPrompt/i,
  /instructionSnapshot/i,
  /providerPayload/i,
  /DATABASE_URL/,
  /signed_url/i,
];

function assertNoSensitiveErrorLeakage(text: string) {
  for (const pattern of FORBIDDEN_ERROR_UI_PATTERNS) {
    expect(text, `forbidden error leak matched ${pattern}`).not.toMatch(pattern);
  }
}

function assertNoSensitiveDomLeakage(text: string) {
  for (const pattern of FORBIDDEN_DOM_PATTERNS) {
    expect(text, `forbidden DOM leak matched ${pattern}`).not.toMatch(pattern);
  }
}

async function signInWithCredentials(
  context: BrowserContext,
  userEmail: string,
  userPassword: string
) {
  const authenticated = await authenticateContext(context, {
    email: userEmail,
    password: userPassword,
  });
  return authenticated.userId;
}

async function signIn(context: BrowserContext) {
  return signInWithCredentials(context, email!, password!);
}

async function createCampaignAndStory(request: APIRequestContext, workspaceId: string) {
  const campaignRes = await request.post("/api/campaigns", {
    data: {
      workspaceId,
      name: `E2E Review UI ${Date.now()}`,
      objective: "awareness",
      platforms: ["instagram"],
      outputLanguage: "en",
      subtitleLanguage: "en",
      ctaLanguage: "en",
      hashtagLanguage: "en",
      campaignBrief: "Browser review assembly verification story.",
      targetAudienceOverride: "Adults",
    },
  });
  expect(campaignRes.ok(), await campaignRes.text()).toBeTruthy();
  const campaignBody = await campaignRes.json();
  const campaignId = campaignBody.campaign?.id as string;

  const storyRes = await request.post(`/api/campaigns/${campaignId}/ai-stories`, {
    data: {
      title: "Review UI story",
      originalIdea: "A short gift story for review assembly UI verification.",
      assetIds: [],
    },
  });
  expect(storyRes.ok(), await storyRes.text()).toBeTruthy();
  const storyBody = await storyRes.json();
  const storyId = storyBody.story?.id as string;
  return { campaignId, storyId };
}

function seedExecutionPlanFixture(input: {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
}): { executionPlanId: string } {
  const result = spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/e2e-seed-ai-story-review-plan.ts"],
    {
      cwd: resolve("."),
      encoding: "utf8",
      shell: true,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        RUN_DB_INTEGRATION_TESTS: "1",
        E2E_SEED_ORG_ID: input.orgId,
        E2E_SEED_WORKSPACE_ID: input.workspaceId,
        E2E_SEED_CAMPAIGN_ID: input.campaignId,
        E2E_SEED_STORY_ID: input.storyId,
      },
    }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "seed script failed");
  }
  const line = (result.stdout || "")
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) throw new Error("seed script returned no JSON");
  return JSON.parse(line) as { executionPlanId: string };
}

function ensureClientViewerFixture(): { email: string; userId: string; role: string } {
  const result = spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/e2e-ensure-client-viewer.ts"],
    {
      cwd: resolve("."),
      encoding: "utf8",
      shell: true,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: serviceRole,
        E2E_VIEWER_EMAIL: viewerEmail,
        E2E_VIEWER_PASSWORD: viewerPassword,
      },
    }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "ensure client_viewer failed");
  }
  const line = (result.stdout || "")
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) throw new Error("ensure client_viewer returned no JSON");
  return JSON.parse(line) as { email: string; userId: string; role: string };
}

function planApiBase(campaignId: string, storyId: string, executionPlanId: string) {
  return `/api/campaigns/${campaignId}/ai-stories/${storyId}/execution-plans/${executionPlanId}`;
}

async function getWorkspace(request: APIRequestContext) {
  const meRes = await request.get("/api/me");
  expect(meRes.ok()).toBeTruthy();
  const me = await meRes.json();
  const ws = (
    me.workspaces as Array<{ id: string; slug: string; role: string; orgId: string }> | undefined
  )?.find((workspace) => workspace.slug === workspaceSlug);
  expect(ws?.id).toBeTruthy();
  return ws!;
}

function assertNoSensitiveLeakage(text: string) {
  assertNoSensitiveErrorLeakage(text);
}

test.describe("Sprint 3 Phase 2B PR 2B.5 Review & Assembly UI (browser)", () => {
  test.skip(!hasAuth, "Requires E2E_USER_EMAIL/PASSWORD and Supabase env");

  test("operator happy path via seeded plan + real APIs + UI", async ({ page, context }) => {
    test.skip(!hasDb, "Requires DATABASE_URL for Execution Plan fixture seed");
    test.setTimeout(300_000);

    await signIn(context);
    await page.goto(`/w/${workspaceSlug}/campaigns`, { waitUntil: "domcontentloaded" });
    const ws = await getWorkspace(page.request);
    expect(["admin", "operator"]).toContain(ws.role);

    const { campaignId, storyId } = await createCampaignAndStory(page.request, ws.id);
    const seed = seedExecutionPlanFixture({
      orgId: ws.orgId,
      workspaceId: ws.id,
      campaignId,
      storyId,
    });

    await page.addInitScript(
      ([sid, planId]) => {
        sessionStorage.setItem(`emberos:ai-story-execution-plan:${sid}`, planId);
      },
      [storyId, seed.executionPlanId] as const
    );

    await page.goto(`/w/${workspaceSlug}/campaigns/${campaignId}/ai-stories/${storyId}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("execution-plan-review-panel")).toBeVisible({
      timeout: 60_000,
    });

    await expect(page.getByTestId("status-execution-lock")).toContainText(/Locked/i);
    await expect(page.getByRole("button", { name: /^Execute$/i })).toHaveCount(0);

    const html = await page.content();
    expect(html.toLowerCase()).not.toContain("negativeprompt");
    expect(html.toLowerCase()).not.toContain("systemprompt");
    expect(html).not.toMatch(/providerCredentials|signed_url|DATABASE_URL/);

    await page.getByTestId("open-review").click();
    await expect(page.getByTestId("scene-review-list")).toBeVisible({ timeout: 60_000 });

    const approveStory = page.getByTestId("approve-story");
    await expect(approveStory).toHaveAttribute("data-eligible", "false");
    await expect(page.getByTestId("story-not-eligible-hint")).toBeVisible();

    const sceneCards = page.locator("[data-testid^=scene-card-]");
    const count = await sceneCards.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await page.getByTestId(`approve-scene-${i}`).click();
      await expect(page.getByTestId(`scene-card-${i}`)).toContainText(/APPROVED|Approved/i, {
        timeout: 60_000,
      });
    }

    await expect(approveStory).toHaveAttribute("data-eligible", "true", { timeout: 30_000 });
    await approveStory.click();
    await expect(page.getByTestId("status-review")).toContainText(/Approved/i, {
      timeout: 60_000,
    });

    await page.getByTestId("create-assembly").click();
    await expect(page.getByTestId("assembly-persisted")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("status-readiness")).toContainText(/Ready for execution/i);
    await expect(page.getByTestId("status-execution-lock")).toContainText(/Locked/i);
    await expect(page.getByTestId("review-history")).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("execution-plan-review-panel")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("status-review")).toContainText(/Approved/i);
    await expect(page.getByTestId("assembly-persisted")).toBeVisible();
    await expect(page.getByTestId("status-execution-lock")).toContainText(/Locked/i);
  });

  test("Scene rejection derives Rejected and disables Story approve", async ({
    page,
    context,
  }) => {
    test.skip(!hasDb, "Requires DATABASE_URL for Execution Plan fixture seed");
    test.setTimeout(180_000);

    await signIn(context);
    await page.goto(`/w/${workspaceSlug}/campaigns`, { waitUntil: "domcontentloaded" });
    const ws = await getWorkspace(page.request);
    const { campaignId, storyId } = await createCampaignAndStory(page.request, ws.id);
    const seed = seedExecutionPlanFixture({
      orgId: ws.orgId,
      workspaceId: ws.id,
      campaignId,
      storyId,
    });

    await page.addInitScript(
      ([sid, planId]) => {
        sessionStorage.setItem(`emberos:ai-story-execution-plan:${sid}`, planId);
      },
      [storyId, seed.executionPlanId] as const
    );
    await page.goto(`/w/${workspaceSlug}/campaigns/${campaignId}/ai-stories/${storyId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("execution-plan-review-panel")).toBeVisible({
      timeout: 60_000,
    });
    await page.getByTestId("open-review").click();
    await page.getByTestId("reject-scene-0").click();
    await expect(page.getByTestId("review-rejected-banner")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("status-review")).toContainText(/Rejected/i);
    await expect(page.getByTestId("approve-story")).toBeDisabled();
  });

  test("Story approval before all Scenes returns STORY_REVIEW_NOT_ELIGIBLE with safe UI", async ({
    page,
    context,
  }) => {
    test.skip(!hasDb, "Requires DATABASE_URL for Execution Plan fixture seed");
    test.setTimeout(180_000);

    await signIn(context);
    await page.goto(`/w/${workspaceSlug}/campaigns`, { waitUntil: "domcontentloaded" });
    const ws = await getWorkspace(page.request);
    const { campaignId, storyId } = await createCampaignAndStory(page.request, ws.id);
    const seed = seedExecutionPlanFixture({
      orgId: ws.orgId,
      workspaceId: ws.id,
      campaignId,
      storyId,
    });

    await page.addInitScript(
      ([sid, planId]) => {
        sessionStorage.setItem(`emberos:ai-story-execution-plan:${sid}`, planId);
      },
      [storyId, seed.executionPlanId] as const
    );
    await page.goto(`/w/${workspaceSlug}/campaigns/${campaignId}/ai-stories/${storyId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("execution-plan-review-panel")).toBeVisible({
      timeout: 60_000,
    });
    await page.getByTestId("open-review").click();
    await expect(page.getByTestId("scene-review-list")).toBeVisible({ timeout: 60_000 });

    // Leave all scenes unapproved; click Story Approve → real API 409.
    await page.getByTestId("approve-story").click();
    const error = page.getByTestId("review-assembly-error");
    await expect(error).toBeVisible({ timeout: 60_000 });
    await expect(error).toHaveAttribute("data-error-code", "STORY_REVIEW_NOT_ELIGIBLE");
    await expect(error).toContainText(/Scene/i);

    const errorText = await error.innerText();
    assertNoSensitiveErrorLeakage(errorText);
    assertNoSensitiveDomLeakage(await page.content());

    const before = await (
      await page.request.get(planApiBase(campaignId, storyId, seed.executionPlanId) + "/review")
    ).json();
    expect(before.review?.storyDecision ?? null).toBeNull();
    expect(before.review?.status).not.toBe("APPROVED");

    await error.getByRole("button", { name: /Reload/i }).click();
    await expect(page.getByTestId("status-review")).toContainText(/Under review/i, {
      timeout: 60_000,
    });
    await expect(page.getByTestId("approve-story")).toBeVisible();
    const after = await (
      await page.request.get(planApiBase(campaignId, storyId, seed.executionPlanId) + "/review")
    ).json();
    expect(after.review?.storyDecision ?? null).toBeNull();
    expect(after.executionAllowed).toBe(false);
  });

  test("client_viewer read-only UI + write APIs return 403", async ({ browser, context }) => {
    test.skip(!hasViewerSetup, "Requires DATABASE_URL, service role, and viewer password");
    test.setTimeout(300_000);

    const viewer = ensureClientViewerFixture();
    expect(viewer.role).toBe("client_viewer");

    // Operator prepares an approved review + assembly for the viewer to read.
    await signIn(context);
    const operatorPage = await context.newPage();
    await operatorPage.goto(`/w/${workspaceSlug}/campaigns`, { waitUntil: "domcontentloaded" });
    const ws = await getWorkspace(operatorPage.request);
    const { campaignId, storyId } = await createCampaignAndStory(operatorPage.request, ws.id);
    const seed = seedExecutionPlanFixture({
      orgId: ws.orgId,
      workspaceId: ws.id,
      campaignId,
      storyId,
    });
    const base = planApiBase(campaignId, storyId, seed.executionPlanId);

    expect((await operatorPage.request.post(base + "/review")).ok()).toBeTruthy();
    const opened = await (await operatorPage.request.get(base + "/review")).json();
    const scenes = (opened.review?.scenes ?? []) as Array<{ sceneExecutionId: string }>;
    expect(scenes.length).toBeGreaterThan(0);
    for (const scene of scenes) {
      const decisionRes = await operatorPage.request.post(
        `${base}/review/scenes/${scene.sceneExecutionId}/decisions`,
        { data: { decision: "APPROVED", comment: "ok" } }
      );
      expect(decisionRes.ok(), await decisionRes.text()).toBeTruthy();
    }
    expect(
      (await operatorPage.request.post(base + "/review/decisions", {
        data: { decision: "APPROVED", comment: "ship" },
      })).ok()
    ).toBeTruthy();
    expect((await operatorPage.request.post(base + "/assembly-definition", { data: {} })).ok()).toBeTruthy();

    const canonicalBefore = await (await operatorPage.request.get(base + "/review")).json();
    expect(canonicalBefore.review.status).toBe("APPROVED");
    expect(canonicalBefore.assemblyDefinition.status).toBe("PERSISTED");
    const historyBefore = await (await operatorPage.request.get(base + "/review/history")).json();
    await operatorPage.close();

    // Authenticated client_viewer browser session.
    const viewerContext = await browser.newContext();
    await signInWithCredentials(viewerContext, viewerEmail, viewerPassword!);
    const page = await viewerContext.newPage();
    await page.addInitScript(
      ([sid, planId]) => {
        sessionStorage.setItem(`emberos:ai-story-execution-plan:${sid}`, planId);
      },
      [storyId, seed.executionPlanId] as const
    );
    await page.goto(`/w/${workspaceSlug}/campaigns/${campaignId}/ai-stories/${storyId}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("execution-plan-review-panel")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("execution-plan-review-panel")).toHaveAttribute(
      "data-can-mutate",
      "false"
    );
    await expect(page.getByTestId("status-review")).toContainText(/Approved/i);
    await expect(page.getByTestId("status-readiness")).toContainText(/Ready for execution/i);
    await expect(page.getByTestId("status-execution-lock")).toContainText(/Locked/i);
    await expect(page.getByTestId("scene-review-list")).toBeVisible();
    await expect(page.getByTestId("review-history")).toBeVisible();
    await expect(page.getByTestId("assembly-persisted")).toBeVisible();

    await expect(page.getByTestId("open-review")).toHaveCount(0);
    await expect(page.getByTestId("approve-scene-0")).toHaveCount(0);
    await expect(page.getByTestId("reject-scene-0")).toHaveCount(0);
    await expect(page.getByTestId("approve-story")).toHaveCount(0);
    await expect(page.getByTestId("reject-story")).toHaveCount(0);
    await expect(page.getByTestId("create-assembly")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Execute$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Retry/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Regenerate/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Export/i })).toHaveCount(0);
    await expect(page.getByText(/Provider selection/i)).toHaveCount(0);

    assertNoSensitiveDomLeakage(await page.content());

    // Direct write API calls with client_viewer session — must 403.
    const openRes = await page.request.post(base + "/review");
    expect(openRes.status()).toBe(403);
    expect((await openRes.json()).code).toBe("FORBIDDEN");

    const sceneRes = await page.request.post(
      `${base}/review/scenes/${scenes[0]!.sceneExecutionId}/decisions`,
      { data: { decision: "APPROVED" } }
    );
    expect(sceneRes.status()).toBe(403);
    expect((await sceneRes.json()).code).toBe("FORBIDDEN");

    const storyRes = await page.request.post(base + "/review/decisions", {
      data: { decision: "APPROVED" },
    });
    expect(storyRes.status()).toBe(403);
    expect((await storyRes.json()).code).toBe("FORBIDDEN");

    const assemblyRes = await page.request.post(base + "/assembly-definition", { data: {} });
    expect(assemblyRes.status()).toBe(403);
    expect((await assemblyRes.json()).code).toBe("FORBIDDEN");

    const canonicalAfter = await (await page.request.get(base + "/review")).json();
    expect(canonicalAfter.review.status).toBe(canonicalBefore.review.status);
    expect(canonicalAfter.review.storyDecision?.decision).toBe(
      canonicalBefore.review.storyDecision?.decision
    );
    expect(canonicalAfter.assemblyDefinition.status).toBe(
      canonicalBefore.assemblyDefinition.status
    );
    expect(canonicalAfter.assemblyDefinition.id).toBe(canonicalBefore.assemblyDefinition.id);
    expect(canonicalAfter.executionAllowed).toBe(false);

    const historyAfter = await (await page.request.get(base + "/review/history")).json();
    expect(historyAfter.events?.length).toBe(historyBefore.events?.length);

    await viewerContext.close();
  });
});
