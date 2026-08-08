import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const workspaceSlug = process.env.E2E_WORKSPACE_SLUG?.trim() || "e2e-workspace";
const fixtures = [
  { file: "bouquet.png", semantic: /rose|flower|bouquet/i },
  { file: "flower-workspace.png", semantic: /flower|floral|shop|workbench|workspace|interior/i },
  { file: "lily-product-detail.png", semantic: /lily|flower|floral|product|detail/i },
] as const;

async function createCampaign(request: APIRequestContext, workspaceId: string, suffix: string) {
  const response = await request.post("/api/campaigns", {
    data: {
      workspaceId,
      name: `E2E Marketing Auto Rename ${suffix} ${Date.now()}`,
      objective: "awareness",
      targetAudienceOverride: "Local flower customers",
      campaignBrief: "Analyze the uploaded floral image accurately.",
      platforms: ["instagram"],
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as { campaign: { id: string } }).campaign.id;
}

async function uploadCampaignImage(
  request: APIRequestContext,
  campaignId: string,
  filename: string
) {
  const path = resolve("e2e/fixtures", filename);
  const originalStorage = statSync(path);
  const prepare = await request.post(`/api/campaigns/${campaignId}/assets/upload-url`, {
    data: {
      filename,
      mimeType: "image/png",
      type: "image",
      fileSizeBytes: originalStorage.size,
    },
  });
  expect(prepare.ok(), await prepare.text()).toBeTruthy();
  const prepared = (await prepare.json()) as {
    uploadUrl: string;
    assetId: string;
    storagePath: string;
  };
  const upload = await request.put(prepared.uploadUrl, {
    data: readFileSync(path),
    headers: { "content-type": "image/png" },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const confirm = await request.post(
    `/api/campaigns/${campaignId}/assets/${prepared.assetId}/confirm`,
    { data: { fileSizeBytes: originalStorage.size } }
  );
  expect(confirm.ok(), await confirm.text()).toBeTruthy();
  const confirmed = (await confirm.json()) as {
    asset: { displayName: string; originalFilename: string; metadata?: Record<string, unknown> };
  };
  return { ...prepared, fallback: confirmed.asset.displayName, confirmed: confirmed.asset };
}

async function getCampaignAsset(request: APIRequestContext, campaignId: string, assetId: string) {
  const response = await request.get(`/api/campaigns/${campaignId}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as {
    assets?: Array<{
      id: string;
      displayName: string;
      originalFilename: string;
      storagePath: string;
      metadata?: Record<string, unknown>;
    }>;
  };
  return body.assets?.find((asset) => asset.id === assetId);
}

async function waitForAiName(
  request: APIRequestContext,
  campaignId: string,
  assetId: string
) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const asset = await getCampaignAsset(request, campaignId, assetId);
    if (asset?.metadata?.displayNameSource === "ai") return asset;
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  }
  throw new Error(`Asset ${assetId} did not receive an AI display name`);
}

test.describe("content-aware Asset Auto Rename", () => {
  test("three images receive semantic names and manual rename wins the real race", async ({ page }) => {
    test.setTimeout(1_200_000);
    const meResponse = await page.request.get("/api/me");
    expect(meResponse.ok()).toBeTruthy();
    const me = (await meResponse.json()) as { workspaces?: Array<{ id: string; slug: string }> };
    const workspace = me.workspaces?.find((item) => item.slug === workspaceSlug);
    expect(workspace).toBeTruthy();

    const observed: Array<{ filename: string; fallback: string; aiName: string }> = [];
    let postAiManualName = "";
    for (const fixture of fixtures) {
      const campaignId = await createCampaign(page.request, workspace!.id, fixture.file);
      const upload = await uploadCampaignImage(page.request, campaignId, fixture.file);
      expect(upload.confirmed.originalFilename).toBe(fixture.file);
      expect(upload.fallback).toBeTruthy();
      const storagePath = upload.storagePath;
      const asset = await waitForAiName(page.request, campaignId, upload.assetId);
      expect(asset.displayName).toMatch(fixture.semantic);
      expect(asset.displayName).not.toBe(upload.fallback);
      expect(asset.originalFilename).toBe(fixture.file);
      expect(asset.storagePath).toBe(storagePath);
      observed.push({ filename: fixture.file, fallback: upload.fallback, aiName: asset.displayName });

      await page.goto(`/w/${workspaceSlug}/campaigns/${campaignId}`);
      await expect(page.getByText(asset.displayName, { exact: true }).first()).toBeVisible();
      await page.goto(`/w/${workspaceSlug}/assets`);
      await expect(page.getByText(asset.displayName, { exact: true }).first()).toBeVisible();
      if (fixture.file === "bouquet.png") {
        postAiManualName = `Curated Pink Roses ${Date.now()}`;
        const renameAfterAi = await page.request.patch(
          `/api/workspaces/${workspace!.id}/library/${upload.assetId}`,
          { data: { displayName: postAiManualName } }
        );
        expect(renameAfterAi.ok(), await renameAfterAi.text()).toBeTruthy();
        const backgroundRefresh = await page.request.post(
          `/api/campaigns/${campaignId}/assets/${upload.assetId}/confirm`,
          { data: {} }
        );
        expect(backgroundRefresh.ok(), await backgroundRefresh.text()).toBeTruthy();
        const afterRefresh = await getCampaignAsset(page.request, campaignId, upload.assetId);
        expect(afterRefresh?.displayName).toBe(postAiManualName);
        expect(afterRefresh?.metadata?.displayNameSource).toBe("manual");
      }
      const cleanup = await page.request.delete(`/api/campaigns/${campaignId}`);
      expect(cleanup.ok(), await cleanup.text()).toBeTruthy();
    }

    // Real race: rename while the independent Asset analysis job is active.
    const raceCampaignId = await createCampaign(page.request, workspace!.id, "manual-race");
    const raceUpload = await uploadCampaignImage(page.request, raceCampaignId, "bouquet.png");
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = await getCampaignAsset(page.request, raceCampaignId, raceUpload.assetId);
      const state = current?.metadata?.assetAnalysis as
        | { status?: string }
        | undefined;
      if (state?.status === "pending" || state?.status === "analyzing") break;
      await page.waitForTimeout(2_000);
    }
    const manualName = `Manual Rose Selection ${Date.now()}`;
    const rename = await page.request.patch(
      `/api/workspaces/${workspace!.id}/library/${raceUpload.assetId}`,
      { data: { displayName: manualName } }
    );
    expect(rename.ok(), await rename.text()).toBeTruthy();
    // Re-confirming is an existing supported background refresh path and must
    // also respect the manual source marker.
    const refresh = await page.request.post(
      `/api/campaigns/${raceCampaignId}/assets/${raceUpload.assetId}/confirm`,
      { data: {} }
    );
    expect(refresh.ok(), await refresh.text()).toBeTruthy();
    await page.waitForTimeout(15_000);
    const afterRace = await getCampaignAsset(page.request, raceCampaignId, raceUpload.assetId);
    expect(afterRace?.displayName).toBe(manualName);
    expect(afterRace?.metadata?.displayNameSource).toBe("manual");
    expect(afterRace?.storagePath).toBe(raceUpload.storagePath);

    await page.goto(`/w/${workspaceSlug}/campaigns/${raceCampaignId}`);
    await expect(page.getByText(manualName, { exact: true }).first()).toBeVisible();
    await page.goto(`/w/${workspaceSlug}/assets`);
    await page.reload();
    await expect(page.getByText(manualName, { exact: true }).first()).toBeVisible();
    const raceCleanup = await page.request.delete(`/api/campaigns/${raceCampaignId}`);
    expect(raceCleanup.ok(), await raceCleanup.text()).toBeTruthy();
    test.info().annotations.push({
      type: "auto-rename-observed",
      description: JSON.stringify({ observed, postAiManualName, raceManualName: manualName }),
    });
  });
});
