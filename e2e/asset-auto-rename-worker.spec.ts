import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const workspaceSlug = process.env.E2E_WORKSPACE_SLUG?.trim() || "e2e-workspace";
const fixtures = [
  { file: "bouquet.png", semantic: /rose|flower|bouquet/i },
  { file: "flower-workspace.png", semantic: /flower|floral|shop|workbench|workspace|interior/i },
  { file: "lily-product-detail.png", semantic: /lily|flower|floral|product|detail/i },
] as const;

async function asset(request: APIRequestContext, campaignId: string, assetId: string) {
  const response = await request.get(`/api/campaigns/${campaignId}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = await response.json() as { assets?: Array<Record<string, any>> };
  return body.assets?.find((item) => item.id === assetId);
}

test("independent worker analyzes three images and preserves a concurrent manual name", async ({ request }) => {
  test.setTimeout(1_200_000);
  const me = await (await request.get("/api/me")).json() as {
    workspaces?: Array<{ id: string; slug: string }>;
  };
  const workspace = me.workspaces?.find((item) => item.slug === workspaceSlug);
  expect(workspace).toBeTruthy();
  const campaigns: string[] = [];
  const observed: Array<{ file: string; fallback: string; aiName: string }> = [];

  try {
    for (const fixture of fixtures) {
      const created = await request.post("/api/campaigns", { data: {
        workspaceId: workspace!.id,
        name: `E2E Asset Worker ${fixture.file} ${Date.now()}`,
        objective: "awareness",
        platforms: ["instagram"],
      }});
      expect(created.ok(), await created.text()).toBeTruthy();
      const campaignId = (await created.json()).campaign.id as string;
      campaigns.push(campaignId);

      const path = resolve("e2e/fixtures", fixture.file);
      const bytes = readFileSync(path);
      const prepared = await request.post(`/api/campaigns/${campaignId}/assets/upload-url`, {
        data: { filename: fixture.file, mimeType: "image/png", type: "image", fileSizeBytes: statSync(path).size },
      });
      expect(prepared.ok(), await prepared.text()).toBeTruthy();
      const upload = await prepared.json() as { assetId: string; uploadUrl: string; storagePath: string };
      expect((await request.put(upload.uploadUrl, { data: bytes, headers: { "content-type": "image/png" } })).ok()).toBeTruthy();
      const confirmed = await request.post(`/api/campaigns/${campaignId}/assets/${upload.assetId}/confirm`, { data: { fileSizeBytes: bytes.length } });
      expect(confirmed.ok(), await confirmed.text()).toBeTruthy();
      const fallback = (await confirmed.json()).asset.displayName as string;

      let analyzed: Record<string, any> | undefined;
      for (let attempt = 0; attempt < 150; attempt++) {
        analyzed = await asset(request, campaignId, upload.assetId);
        if (analyzed?.metadata?.displayNameSource === "ai") break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
      }
      expect(analyzed?.displayName).toMatch(fixture.semantic);
      expect(analyzed?.displayName).not.toBe(fallback);
      expect(analyzed?.originalFilename).toBe(fixture.file);
      expect(analyzed?.storagePath).toBe(upload.storagePath);
      expect(analyzed?.metadata?.assetAnalysis?.status).toBe("completed");
      observed.push({ file: fixture.file, fallback, aiName: analyzed!.displayName });
    }

    const firstCampaign = campaigns[0]!;
    const firstResponse = await request.get(`/api/campaigns/${firstCampaign}`);
    const first = ((await firstResponse.json()).assets as Array<Record<string, any>>)[0]!;
    const manualName = `Manual Rose Selection ${Date.now()}`;
    const renamed = await request.patch(`/api/workspaces/${workspace!.id}/library/${first.id}`, {
      data: { displayName: manualName },
    });
    expect(renamed.ok(), await renamed.text()).toBeTruthy();
    await request.post(`/api/campaigns/${firstCampaign}/assets/${first.id}/confirm`, { data: {} });
    await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));
    const afterManual = await asset(request, firstCampaign, first.id);
    expect(afterManual?.displayName).toBe(manualName);
    expect(afterManual?.metadata?.displayNameSource).toBe("manual");
    test.info().annotations.push({ type: "observed-auto-names", description: JSON.stringify(observed) });
  } finally {
    for (const campaignId of campaigns) await request.delete(`/api/campaigns/${campaignId}`);
  }
});
