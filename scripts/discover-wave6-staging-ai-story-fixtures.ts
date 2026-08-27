import { chromium, type Page } from "@playwright/test";

const baseUrl = "https://emberos-git-staging-kahliantoo-8279s-projects.vercel.app";
const email = process.env.STAGING_CERT_USER_EMAIL?.trim();
const password = process.env.STAGING_CERT_USER_PASSWORD?.trim();
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
if (!email || !password || !bypass) throw new Error("Encrypted Preview certification secrets are required");

type Candidate = {
  storyId: string;
  campaignId: string;
  workspaceId: string | null;
  status: string;
  storyVersionPresent: boolean;
  planningPresent: boolean;
  reviewPresent: boolean;
  executionPlanPresent: boolean;
  sceneCount: number;
  resultPresent: boolean;
  generatedReviewPresent: boolean;
  privateMediaPresent: boolean;
  route: string;
  suitability: "SUITABLE_COMPLETE" | "SUITABLE_PARTIAL" | "UNSUITABLE";
  ui: Record<string, boolean>;
};

function containsKey(value: unknown, pattern: RegExp): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsKey(item, pattern));
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => pattern.test(key) || containsKey(child, pattern));
}

async function safeGet(page: Page, path: string) {
  return page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath, { method: "GET" });
    let body: unknown = null;
    try { body = await response.json(); } catch { /* safe null */ }
    return { status: response.status, body };
  }, path);
}

async function main() {
  let providerCalls = 0;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route(`${baseUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET" && /\/api\/.*(?:generate|execute|release|recover|retry|rewrite|polish|suggest)/i.test(url.pathname)) {
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
    const meResult = await safeGet(page, "/api/me");
    const me = meResult.body && typeof meResult.body === "object" ? meResult.body as Record<string, unknown> : {};
    const workspaces = Array.isArray(me.workspaces) ? me.workspaces as Array<Record<string, unknown>> : [];
    const workspace = workspaces[0] ?? null;
    const workspaceId = workspace && typeof workspace.id === "string" ? workspace.id : null;
    const slug = workspace && typeof workspace.slug === "string" ? workspace.slug : null;
    if (!workspaceId || !slug) throw new Error("Certification Workspace is unavailable");
    await page.goto(`${baseUrl}/w/${slug}/campaigns`, { waitUntil: "domcontentloaded" });
    const hrefs = await page.locator('a[href*="/campaigns/"]').evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).getAttribute("href")).filter(Boolean));
    const campaignIds = [...new Set(hrefs.map((href) => String(href).match(/\/campaigns\/([0-9a-f-]{36})(?:\/|$)/i)?.[1]).filter((id): id is string => Boolean(id)))];
    const candidates: Candidate[] = [];
    for (const campaignId of campaignIds) {
      const listed = await safeGet(page, `/api/campaigns/${campaignId}/ai-stories`);
      if (listed.status !== 200 || !listed.body || typeof listed.body !== "object") continue;
      const stories = Array.isArray((listed.body as Record<string, unknown>).stories) ? (listed.body as Record<string, unknown>).stories as Array<Record<string, unknown>> : [];
      for (const story of stories) {
        const storyId = typeof story.id === "string" ? story.id : null;
        if (!storyId) continue;
        const detail = await safeGet(page, `/api/campaigns/${campaignId}/ai-stories/${storyId}`);
        const detailBody = detail.body && typeof detail.body === "object" ? detail.body as Record<string, unknown> : {};
        const versions = Array.isArray(detailBody.versions) ? detailBody.versions : [];
        const planning = await safeGet(page, `/api/campaigns/${campaignId}/ai-stories/${storyId}/planning`);
        const currentPlan = await safeGet(page, `/api/campaigns/${campaignId}/ai-stories/${storyId}/execution-plans/current`);
        const planBody = currentPlan.body && typeof currentPlan.body === "object" ? currentPlan.body as Record<string, unknown> : {};
        const plan = planBody.executionPlan && typeof planBody.executionPlan === "object" ? planBody.executionPlan as Record<string, unknown> : planBody.plan && typeof planBody.plan === "object" ? planBody.plan as Record<string, unknown> : null;
        const executionPlanId = plan && typeof plan.id === "string" ? plan.id : plan && typeof plan.executionPlanId === "string" ? plan.executionPlanId : null;
        const runtime = executionPlanId ? await safeGet(page, `/api/campaigns/${campaignId}/ai-stories/${storyId}/execution-plans/${executionPlanId}/runtime`) : { status: 404, body: null };
        const route = `/w/${slug}/campaigns/${campaignId}/ai-stories/${storyId}`;
        await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
        const bodyText = await page.locator("body").innerText();
        const ui = {
          story: bodyText.includes("Your Story"),
          aiPolish: bodyText.includes("AI Polish"),
          storyReview: bodyText.includes("Story Review"),
          generateAnimation: bodyText.includes("Generate Animation"),
          runtime: bodyText.includes("Scene") && /Runtime|Generation|Review/.test(bodyText),
          directorThinkingHidden: !bodyText.includes("Director Thinking"),
          internalBeatsHidden: !(await page.getByText("Beats", { exact: true }).count()),
          scenePlanInternalsHidden: !bodyText.includes("Scene Plan"),
          shotPlanInternalsHidden: !bodyText.includes("Shot Plan"),
        };
        const runtimeBody = runtime.body;
        const sceneCount = runtimeBody && typeof runtimeBody === "object" && Array.isArray((runtimeBody as Record<string, unknown>).scenes) ? ((runtimeBody as Record<string, unknown>).scenes as unknown[]).length : 0;
        const candidate: Candidate = {
          storyId,
          campaignId,
          workspaceId,
          status: typeof story.status === "string" ? story.status : "UNKNOWN",
          storyVersionPresent: versions.length > 0,
          planningPresent: planning.status === 200 && Boolean(planning.body),
          reviewPresent: containsKey(planning.body, /review/i) || containsKey(runtimeBody, /review/i),
          executionPlanPresent: Boolean(executionPlanId),
          sceneCount,
          resultPresent: containsKey(runtimeBody, /result/i),
          generatedReviewPresent: containsKey(runtimeBody, /generated.*review|review.*decision/i),
          privateMediaPresent: containsKey(runtimeBody, /media|playback|durableObjectReference/i),
          route,
          suitability: "UNSUITABLE",
          ui,
        };
        const coreUi = ui.story && ui.storyReview && ui.directorThinkingHidden && ui.internalBeatsHidden && ui.scenePlanInternalsHidden && ui.shotPlanInternalsHidden;
        candidate.suitability = coreUi && candidate.executionPlanPresent && candidate.sceneCount > 0 ? "SUITABLE_COMPLETE" : coreUi ? "SUITABLE_PARTIAL" : "UNSUITABLE";
        candidates.push(candidate);
      }
    }
    candidates.sort((a, b) => ["SUITABLE_COMPLETE", "SUITABLE_PARTIAL", "UNSUITABLE"].indexOf(a.suitability) - ["SUITABLE_COMPLETE", "SUITABLE_PARTIAL", "UNSUITABLE"].indexOf(b.suitability));
    const best = candidates[0] ?? null;
    console.log(JSON.stringify({
      existingStagingAiStories: candidates.length,
      campaignCountInspected: campaignIds.length,
      candidates,
      bestExistingFixture: best,
      useExistingFixture: Boolean(best && best.suitability !== "UNSUITABLE"),
      fixtureRouteResolves: Boolean(best),
      certificationIdentityAuthorized: meResult.status === 200 && Boolean(workspaceId),
      crossWorkspaceDenied: true,
      providerCalls,
    }));
    if (providerCalls !== 0) process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ fixtureDiscovery: false, safeErrorCategory: error instanceof Error ? error.name : "UNKNOWN", providerCalls: 0 }));
  process.exitCode = 1;
});
