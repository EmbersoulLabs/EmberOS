import { test, expect } from "@playwright/test";
import { config } from "dotenv";
import { authenticateContext } from "./helpers/auth";
import { resolve } from "node:path";

config({ path: resolve(".env.e2e.local") });
config({ path: resolve(".env.local") });

const email = process.env.E2E_USER_EMAIL?.trim();
const password = process.env.E2E_USER_PASSWORD?.trim();
const workspaceSlug = process.env.E2E_WORKSPACE_SLUG?.trim() || "e2e-workspace";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const hasCredentials = Boolean(
  email &&
    password &&
    supabaseUrl &&
    supabaseAnon &&
    process.env.OPENAI_API_KEY?.trim()
);

test.describe("AI Story planning Sprint 2 (browser E2E)", () => {
  test.skip(
    !hasCredentials,
    "Set E2E_USER_EMAIL/E2E_USER_PASSWORD/Supabase env and OPENAI_API_KEY"
  );

  test("login → create story → approve → generate planning → approve planning", async ({
    page,
    context,
  }) => {
    test.setTimeout(900_000);

    await authenticateContext(context, { email: email!, password: password! });

    await page.goto(`/w/${workspaceSlug}/campaigns`, { waitUntil: "domcontentloaded" });
    const meRes = await page.request.get("/api/me");
    expect(meRes.ok()).toBeTruthy();
    const me = await meRes.json();
    const ws = (me.workspaces as Array<{ id: string; slug: string }> | undefined)?.find(
      (workspace) => workspace.slug === workspaceSlug
    );
    expect(ws?.id, `workspace ${workspaceSlug} missing for E2E user`).toBeTruthy();

    const campaignName = `E2E AI Story Planning ${Date.now()}`;
    const campaignRes = await page.request.post("/api/campaigns", {
      data: {
        workspaceId: ws!.id,
        name: campaignName,
        objective: "awareness",
        platforms: ["instagram"],
        outputLanguage: "en",
        subtitleLanguage: "en",
        ctaLanguage: "en",
        hashtagLanguage: "en",
        campaignBrief: "Short brand story for a helpful gifting product.",
        targetAudienceOverride: "Busy adults shopping for thoughtful gifts",
      },
    });
    expect(campaignRes.ok()).toBeTruthy();
    const campaignBody = await campaignRes.json();
    const campaignId = campaignBody.campaign?.id as string;
    expect(campaignId).toBeTruthy();

    const storyRes = await page.request.post(`/api/campaigns/${campaignId}/ai-stories`, {
      data: {
        title: "Planning story",
        originalIdea:
          "A busy customer needs a thoughtful gift, discovers the product, and feels relieved when the gift is loved.",
        assetIds: [],
      },
    });
    expect(storyRes.ok()).toBeTruthy();
    const storyBody = await storyRes.json();
    const storyId = storyBody.story?.id as string;
    expect(storyId).toBeTruthy();

    const polishRes = await page.request.post(
      `/api/campaigns/${campaignId}/ai-stories/${storyId}/generate`,
      { data: {} }
    );
    expect(polishRes.ok()).toBeTruthy();

    await page.goto(`/w/${workspaceSlug}/campaigns/${campaignId}/ai-stories/${storyId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "Story Draft" })).toBeVisible();

    await page.getByRole("button", { name: /Approve & freeze/i }).click();
    await expect(page.getByText("ready for animation", { exact: true })).toBeVisible({
      timeout: 120_000,
    });

    await expect(page.getByRole("button", { name: /Generate Creative Context/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Generate Director Thinking/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Generate Story Beats/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Generate Scene Plan/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Generate Shot Plan/i })).toBeVisible();

    await page.getByRole("button", { name: /Generate All Planning/i }).click();
    await expect(page.getByRole("button", { name: /Approve Planning/i })).toBeEnabled({
      timeout: 600_000,
    });
    await expect(page.getByRole("heading", { name: "Director Thinking", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Narrative Integration", exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Approve Planning/i }).click();
    await expect(page.getByText("ready for execution", { exact: true })).toBeVisible({
      timeout: 120_000,
    });
  });
});
