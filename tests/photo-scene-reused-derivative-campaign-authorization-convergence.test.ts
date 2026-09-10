import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isCurrentCampaignReusableOutput } from "../apps/web/src/lib/photo-scene-extraction";

const ORG = "71000000-0000-4000-8000-000000000001";
const WORKSPACE = "72000000-0000-4000-8000-000000000001";
const CAMPAIGN_ORIGIN = "73000000-0000-4000-8000-000000000001";
const CAMPAIGN_CURRENT = "73000000-0000-4000-8000-000000000002";
const SOURCE = "74000000-0000-4000-8000-000000000001";
const OUTPUT = "75000000-0000-4000-8000-000000000001";

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_CURRENT,
    orgId: ORG,
    workspaceId: WORKSPACE,
    ...overrides,
  } as never;
}

function generation(overrides: Record<string, unknown> = {}) {
  return {
    id: "76000000-0000-4000-8000-000000000001",
    orgId: ORG,
    workspaceId: WORKSPACE,
    campaignId: CAMPAIGN_ORIGIN,
    sourceAssetId: SOURCE,
    outputAssetId: OUTPUT,
    ...overrides,
  } as never;
}

function output(overrides: Record<string, unknown> = {}) {
  return {
    id: OUTPUT,
    orgId: ORG,
    workspaceId: WORKSPACE,
    campaignId: CAMPAIGN_ORIGIN,
    status: "ready",
    deletedAt: null,
    type: "image",
    mimeType: "image/png",
    ...overrides,
  } as never;
}

describe("Photo Scene reused derivative Campaign authorization convergence", () => {
  it("accepts an unchanged origin Campaign when exact current scope and output state are safe", () => {
    expect(
      isCurrentCampaignReusableOutput({
        campaign: campaign(),
        generation: generation(),
        outputAsset: output(),
      })
    ).toBe(true);
    expect(generation()).toMatchObject({ campaignId: CAMPAIGN_ORIGIN });
    expect(output()).toMatchObject({ campaignId: CAMPAIGN_ORIGIN });
  });

  it.each([
    ["generation org", generation({ orgId: crypto.randomUUID() }), output()],
    ["generation workspace", generation({ workspaceId: crypto.randomUUID() }), output()],
    ["output identity", generation(), output({ id: crypto.randomUUID() })],
    ["output org", generation(), output({ orgId: crypto.randomUUID() })],
    ["output workspace", generation(), output({ workspaceId: crypto.randomUUID() })],
    ["output status", generation(), output({ status: "processing" })],
    ["deleted output", generation(), output({ deletedAt: new Date() })],
    ["output type", generation(), output({ type: "video" })],
    ["output MIME", generation(), output({ mimeType: "image/jpeg" })],
  ])("denies unsafe %s before Campaign authorization", (_label, candidate, asset) => {
    expect(
      isCurrentCampaignReusableOutput({
        campaign: campaign(),
        generation: candidate,
        outputAsset: asset,
      })
    ).toBe(false);
  });

  it("authorizes only after exact reuse evaluation and uses one shared normal/race policy", () => {
    const source = readFileSync("apps/web/src/lib/photo-scene-extraction.ts", "utf8");
    const helperStart = source.indexOf("async function certifyAndAuthorizeReadyReuse");
    const helperEnd = source.indexOf("export async function requestProductExtraction");
    const helper = source.slice(helperStart, helperEnd);
    expect(helperStart).toBeGreaterThan(-1);
    expect(helper.indexOf("evaluateExtractionReuse")).toBeLessThan(
      helper.indexOf("authorizeCertifiedReusableDerivativeForCampaign")
    );
    expect(helper).toContain("isCurrentCampaignReusableOutput");
    expect(source).toContain("persistSameWorkspaceCampaignAssetRef(db");
    expect(source.match(/await certifyAndAuthorizeReadyReuse\(db/g)).toHaveLength(2);
  });

  it("limits convergence to an idempotent campaign_asset_refs insert", () => {
    const persistence = readFileSync("packages/db/src/queries/campaign-asset-refs.ts", "utf8");
    expect(persistence).toContain("persistSameWorkspaceCampaignAssetRef");
    expect(persistence).toContain(".insert(schema.campaignAssetRefs)");
    expect(persistence).toContain(".onConflictDoNothing()");
    expect(persistence).toContain("campaign.workspaceId !== input.workspaceId");
    expect(persistence).toContain("asset.workspaceId !== input.workspaceId");
  });

  it("keeps the AI Story resolver read-only and Campaign authorization explicit", () => {
    const resolver = readFileSync(
      "apps/web/src/lib/ai-story-exact-product-derivative.ts",
      "utf8"
    );
    expect(resolver).toContain("currentCampaignAuthorized");
    expect(resolver).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(resolver).not.toContain("persistSameWorkspaceCampaignAssetRef");
  });
});
