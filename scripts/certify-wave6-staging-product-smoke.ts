import { chromium, type Locator } from "@playwright/test";

const baseUrl = "https://emberos-git-staging-kahliantoo-8279s-projects.vercel.app";
const email = process.env.E2E_USER_EMAIL?.trim();
const password = process.env.E2E_USER_PASSWORD?.trim();
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
if (!email || !password || !bypass) throw new Error("Encrypted Preview certification secrets are required");

async function main() {
const result: Record<string, boolean | string | number> = {};
let providerCalls = 0;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.route(`${baseUrl}/**`, async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const providerMutation = request.method() !== "GET" && /\/api\/.*(?:generate|execute|release-next-scene|recover-pre-dispatch|retry|rewrite|polish|suggest)/i.test(url.pathname);
  if (providerMutation) {
    providerCalls += 1;
    return route.abort("blockedbyclient");
  }
  await route.continue({ headers: { ...request.headers(), "x-vercel-protection-bypass": bypass } });
});

const page = await context.newPage();
const visible = async (locator: Locator) => (await locator.count()) > 0 && await locator.first().isVisible();
const bodyHas = async (text: string) => (await page.locator("body").innerText()).includes(text);

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  result.previewProtectionAccess = !page.url().includes("vercel.com/sso-api");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/workspaces(?:\?|$)/, { timeout: 30_000 });
  result.stagingLogin = true;
  result.passwordPersistenceAbsent = await page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) ?? "";
      if (/password|passwd|pwd/i.test(key)) return false;
    }
    return true;
  });

  const workspaceLink = page.locator('a[href^="/w/"]').first();
  const workspaceHref = await workspaceLink.getAttribute("href");
  if (!workspaceHref) throw new Error("Certification identity has no authorized Workspace link");
  const workspaceMatch = workspaceHref.match(/^\/w\/([^/]+)/);
  if (!workspaceMatch) throw new Error("Workspace link is malformed");
  const slug = workspaceMatch[1]!;

  await page.goto(`${baseUrl}/w/${slug}/campaigns`, { waitUntil: "domcontentloaded" });
  const role = await page.evaluate(async () => {
    const response = await fetch("/api/me");
    const body = await response.json();
    return body.workspaces?.[0]?.role ?? null;
  });
  result.workspaceNavigation = await visible(page.getByRole("link", { name: /Campaigns/i })) && await visible(page.getByRole("link", { name: /Assets/i })) && await visible(page.getByRole("link", { name: /Business Profile/i }));
  result.authorization = typeof role === "string" && role.length > 0;
  result.stagingRole = typeof role === "string" ? role : "UNKNOWN";
  result.equivalentRoleComparisonReady = result.authorization;

  await page.goto(`${baseUrl}/w/${slug}/assets`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Asset Library" }).waitFor();
  result.assetLibrary = await visible(page.getByRole("heading", { name: "Asset Library" })) && await visible(page.getByRole("button", { name: "Upload" }));
  result.assetStory = await visible(page.getByRole("button", { name: "Asset Stories" })) && await visible(page.getByRole("button", { name: "New Asset Story" }));
  const publicMediaSrcCount = await page.locator('img[src*="/object/public/"],video[src*="/object/public/"],audio[src*="/object/public/"]').count();
  const privatePreviewCount = await page.locator("img,video,audio").count();
  result.privateMedia = publicMediaSrcCount === 0 && privatePreviewCount > 0;

  await page.goto(`${baseUrl}/w/${slug}/business-profile`, { waitUntil: "domcontentloaded" });
  result.businessProfile = await bodyHas("Business Profile");
  result.defaultPublishingPlatforms = await bodyHas("Default Publishing Platforms");

  await page.goto(`${baseUrl}/w/${slug}/campaigns/new`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Campaign Name").waitFor();
  const progressText = await page.getByRole("list", { name: "Campaign creation progress" }).innerText();
  result.fiveStepWizard = ["Campaign Name", "Objective", "Assets", "Campaign Brief", "Review & Create"].every((value) => progressText.includes(value));
  await page.getByLabel("Campaign Name").fill("Wave 6 certification preview only");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Publishing Platforms", { exact: true }).waitFor();
  result.publishingPlatforms = await bodyHas("Publishing Platforms");
  result.targetAudience = await visible(page.getByRole("textbox", { name: "Target Audience", exact: true }));
  const removed = await page.getByText(/AI Output Language|Subtitle Language|Voice|BGM|Content Style/, { exact: true }).count();
  result.aiOutputLanguageAbsent = removed === 0;
  result.subtitleLanguageAbsent = removed === 0;
  result.voiceAbsent = removed === 0;
  result.bgmAbsent = removed === 0;
  result.contentStyleAbsent = removed === 0;
  await page.getByRole("textbox", { name: "Target Audience", exact: true }).fill("Read-only certification audience");
  const activePlatforms = await page.locator('button[aria-pressed="true"]').count();
  if (activePlatforms === 0) await page.getByRole("button", { name: "Instagram" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Search Asset Library").waitFor();
  result.createCampaignAssetLibrary = await visible(page.getByLabel("Search Asset Library"));
  result.createCampaignAssetStory = await bodyHas("Asset Stories");
  const assetCheckboxes = page.locator("fieldset").filter({ hasText: "Workspace Assets" }).locator('input[type="checkbox"]');
  const storyCheckboxes = page.locator("fieldset").filter({ hasText: "Asset Stories" }).locator('input[type="checkbox"]');
  if (await assetCheckboxes.count()) await assetCheckboxes.first().check();
  else if (await storyCheckboxes.count()) await storyCheckboxes.first().check();
  if ((await assetCheckboxes.count()) + (await storyCheckboxes.count()) > 0) {
    await page.getByRole("button", { name: "Continue" }).click();
    result.campaignBrief = await visible(page.getByLabel(/Campaign Brief/));
    await page.getByRole("button", { name: "Continue" }).click();
    result.reviewCreate = await visible(page.getByRole("button", { name: "Create Campaign" }));
  } else {
    result.campaignBrief = progressText.includes("Campaign Brief");
    result.reviewCreate = progressText.includes("Review & Create");
  }
  result.createCampaign = Boolean(result.fiveStepWizard && result.publishingPlatforms && result.targetAudience && result.createCampaignAssetLibrary && result.campaignBrief && result.reviewCreate);

  await page.goto(`${baseUrl}/w/${slug}/campaigns`, { waitUntil: "domcontentloaded" });
  const campaignLink = page.locator('a[aria-label^="Open "]').first();
  const campaignHref = await campaignLink.getAttribute("href");
  if (!campaignHref) throw new Error("No existing Campaign fixture is available");
  await page.goto(new URL(campaignHref, baseUrl).toString(), { waitUntil: "domcontentloaded" });
  result.campaignWorkspace = await bodyHas("Overview") && await bodyHas("Photo Scene") && await bodyHas("Video Studio") && await bodyHas("AI Story");
  result.photoScene = await bodyHas("Photo Scene");
  result.videoStudio = await bodyHas("Video Studio");

  const storyLink = page.locator('a[href*="/ai-stories/"]').filter({ hasNotText: "Create AI Story" }).first();
  const storyHref = await storyLink.getAttribute("href");
  if (!storyHref || storyHref.endsWith("/new")) throw new Error("No existing AI Story fixture is available");
  await page.goto(new URL(storyHref, baseUrl).toString(), { waitUntil: "domcontentloaded" });
  result.storyVisible = await bodyHas("Your Story");
  result.aiPolishVisible = await bodyHas("AI Polish");
  result.storyReviewVisible = await bodyHas("Story Review");
  result.directorThinkingHidden = !await bodyHas("Director Thinking");
  result.internalBeatsHidden = !await page.getByText("Beats", { exact: true }).count();
  result.scenePlanInternalsHidden = !await bodyHas("Scene Plan");
  result.shotPlanInternalsHidden = !await bodyHas("Shot Plan");
  result.aiStoryNormalUserUi = Boolean(result.storyVisible && result.aiPolishVisible && result.storyReviewVisible && result.directorThinkingHidden && result.internalBeatsHidden && result.scenePlanInternalsHidden && result.shotPlanInternalsHidden);

  const invalidResponse = await page.goto(`${baseUrl}/w/wave6-not-authorized/campaigns`, { waitUntil: "domcontentloaded" });
  result.crossWorkspaceDenied = Boolean(invalidResponse && [401, 403, 404].includes(invalidResponse.status())) || page.url().includes("/workspaces");
  result.authorization = Boolean(result.authorization && result.crossWorkspaceDenied);
  result.providerCalls = providerCalls;
  result.productSmoke = ["workspaceNavigation", "assetLibrary", "assetStory", "businessProfile", "defaultPublishingPlatforms", "createCampaign", "campaignWorkspace", "aiStoryNormalUserUi", "videoStudio", "photoScene", "privateMedia", "authorization"].every((key) => result[key] === true);
  console.log(JSON.stringify(result));
  if (!result.productSmoke || providerCalls !== 0) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
}

main().catch((error) => {
  console.error(JSON.stringify({ productSmoke: false, error: error instanceof Error ? error.message : "unknown error" }));
  process.exitCode = 1;
});
