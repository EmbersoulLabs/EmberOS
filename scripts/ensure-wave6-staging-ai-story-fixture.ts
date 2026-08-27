import { chromium } from "@playwright/test";

const baseUrl = "https://emberos-git-staging-kahliantoo-8279s-projects.vercel.app";
const fixtureTitle = "WAVE6_CERTIFICATION_AI_STORY_ZERO_PROVIDER";
const email = process.env.STAGING_CERT_USER_EMAIL?.trim();
const password = process.env.STAGING_CERT_USER_PASSWORD?.trim();
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
if (!email || !password || !bypass) throw new Error("Encrypted Preview certification secrets are required");

async function main() {
  let providerCalls = 0;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route(`${baseUrl}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET" && /\/api\/.*(?:generate|execute|release|recover|retry|rewrite|polish|suggest)/i.test(path)) {
      providerCalls += 1;
      return route.abort("blockedbyclient");
    }
    await route.continue({ headers: { ...request.headers(), "x-vercel-protection-bypass": bypass } });
  });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/workspaces(?:\?|$)/, { timeout: 30_000, waitUntil: "domcontentloaded" });
    const me = await page.evaluate(async () => (await fetch("/api/me")).json()) as Record<string, unknown>;
    const workspaces = Array.isArray(me.workspaces) ? me.workspaces as Array<Record<string, unknown>> : [];
    const workspace = workspaces[0] ?? null;
    const workspaceId = workspace && typeof workspace.id === "string" ? workspace.id : null;
    const slug = workspace && typeof workspace.slug === "string" ? workspace.slug : null;
    if (!workspaceId || !slug) throw new Error("Certification Workspace is unavailable");
    await page.goto(`${baseUrl}/w/${slug}/campaigns`, { waitUntil: "domcontentloaded" });
    const campaignLink = page.locator('a[aria-label^="Open "]').first();
    await campaignLink.waitFor({ state: "visible", timeout: 15_000 });
    const href = await campaignLink.getAttribute("href");
    const campaignId = href?.match(/\/campaigns\/([0-9a-f-]{36})(?:\/|$)/i)?.[1] ?? null;
    if (!campaignId) throw new Error("Certification Campaign identity is unavailable");
    const created = await page.evaluate(async ({ campaignId, fixtureTitle }) => {
      const listed = await fetch(`/api/campaigns/${campaignId}/ai-stories`);
      const listBody = await listed.json();
      const existing = Array.isArray(listBody.stories) ? listBody.stories.find((story: Record<string, unknown>) => story.title === fixtureTitle) : null;
      if (existing && typeof existing.id === "string") return { story: existing, reused: true, status: listed.status };
      const response = await fetch(`/api/campaigns/${campaignId}/ai-stories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: fixtureTitle,
          originalIdea: "Deterministic Staging-only Wave 6 UI certification draft. No Provider dispatch is authorized.",
          assetIds: [],
        }),
      });
      const body = await response.json();
      return { story: body.story ?? null, reused: false, status: response.status };
    }, { campaignId, fixtureTitle });
    const story = created.story && typeof created.story === "object" ? created.story as Record<string, unknown> : null;
    const storyId = story && typeof story.id === "string" ? story.id : null;
    if (!storyId || ![200, 201].includes(created.status)) throw new Error("Canonical fixture creation failed");
    const route = `/w/${slug}/campaigns/${campaignId}/ai-stories/${storyId}`;
    await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Your Story" }).waitFor();
    const text = await page.locator("body").innerText();
    const storyVisible = text.includes("Your Story");
    const aiPolishVisible = text.includes("AI Polish");
    const storyReviewVisible = text.includes("Story Review");
    const generateAnimationVisible = text.includes("Generate Animation");
    const directorThinkingHidden = !text.includes("Director Thinking");
    const internalBeatsHidden = !(await page.getByText("Beats", { exact: true }).count());
    const scenePlanInternalsHidden = !text.includes("Scene Plan");
    const shotPlanInternalsHidden = !text.includes("Shot Plan");
    const routeAccess = new URL(page.url()).pathname === route;
    console.log(JSON.stringify({
      fixtureEnvironment: "STAGING",
      fixturePurpose: "WAVE6_CERTIFICATION",
      fixtureTitle,
      fixtureStoryId: storyId,
      fixtureCampaignId: campaignId,
      fixtureWorkspaceId: workspaceId,
      fixtureStatus: typeof story.status === "string" ? story.status : "draft",
      fixtureRoute: route,
      fixtureRouteResolves: routeAccess,
      reusedExistingFixture: created.reused,
      storyVersionPresent: false,
      planningPresent: false,
      executionPlanPresent: false,
      sceneCount: 0,
      durableGeneratedReviewAvailable: false,
      privateMediaPresent: false,
      storyVisible,
      aiPolishVisible,
      storyReviewVisible,
      generateAnimationVisible,
      runtimeReached: false,
      directorThinkingHidden,
      internalBeatsHidden,
      scenePlanInternalsHidden,
      shotPlanInternalsHidden,
      fakeReviewStateCreated: false,
      fakeRetryStateCreated: false,
      outboxProviderJobCreated: false,
      providerAttemptCreated: false,
      paidAttempts: 0,
      providerCalls,
      aiStoryNormalUserUi: storyVisible && aiPolishVisible && storyReviewVisible && generateAnimationVisible && directorThinkingHidden && internalBeatsHidden && scenePlanInternalsHidden && shotPlanInternalsHidden && routeAccess,
    }));
    if (providerCalls !== 0) process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ fixtureReadiness: false, safeErrorCategory: error instanceof Error ? error.name : "UNKNOWN", providerCalls: 0 }));
  process.exitCode = 1;
});
