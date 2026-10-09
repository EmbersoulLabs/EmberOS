import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CreateCampaignContextSchema,
  compileAiStoryIntakeAuthority,
  omitCharacterPortraitGenericReferences,
  explicitRoleHintForAiStoryUsage,
  planAiStoryAssetLinkUsage,
  projectLegacyAiStoryAssetUsage,
} from "@ceo-agent/shared";

const character = "10000000-0000-4000-8000-000000000001";
const product = "20000000-0000-4000-8000-000000000002";
const location = "30000000-0000-4000-8000-000000000003";
const brand = "40000000-0000-4000-8000-000000000004";
const style = "50000000-0000-4000-8000-000000000005";
const generic = "60000000-0000-4000-8000-000000000006";
const portrait = "70000000-0000-4000-8000-000000000007";

const campaign = {
  idempotencyKey: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
  name: "Container",
  objective: "awareness" as const,
  publishingPlatforms: ["tiktok"] as const,
  targetAudience: { summary: "Local buyers", demographics: [], interests: [], needs: [], locations: [] },
  assetReferences: [] as string[],
  assetStoryReferences: [] as string[],
};

describe("module-first intake authority", () => {
  it("creates a Campaign with zero assets and does not start generation from the standard UI", () => {
    expect(CreateCampaignContextSchema.safeParse(campaign).success).toBe(true);
    const wizard = readFileSync("apps/web/src/components/campaign/CreateCampaignWizard.tsx", "utf8");
    const command = readFileSync("apps/web/src/lib/create-campaign-command.ts", "utf8");
    const container = readFileSync("apps/web/src/app/api/campaigns/container/route.ts", "utf8");
    expect(wizard).toContain('fetch("/api/campaigns/container"');
    expect(wizard).toContain("/campaigns/${body.campaignId}");
    expect(wizard).not.toContain("executeCampaignGenerate");
    expect(container).toContain("createCampaign(");
    expect(container).not.toContain("createCampaignAndStartWorkflow");
    expect(command).toContain("export async function createCampaign");
    expect(command).toContain("executeCampaignGenerate");
  });

  it("exposes a module chooser and does not preselect every Story asset", () => {
    const dashboard = readFileSync("apps/web/src/components/campaign/CampaignDashboard.tsx", "utf8");
    const form = readFileSync("apps/web/src/components/ai-story/EpisodeCreateForm.tsx", "utf8");
    expect(dashboard).toContain("What do you want to create?");
    expect(dashboard).toContain("AI Story");
    expect(dashboard).toContain("Photo Scene");
    expect(dashboard).toContain("Video Studio");
    expect(dashboard).toContain("Marketing");
    expect(form).toContain("useState<string[]>([])");
    expect(form).not.toContain("assets.map((asset) => asset.id)");
    expect(form).toContain("episode-authority-preview");
    expect(form).toContain("Confirm this mapping");
  });

  it("keeps a character portrait off the generic Story reference list", () => {
    const selection = omitCharacterPortraitGenericReferences({
      assetIds: [portrait, product],
      productAssetIds: [product],
      genericAssetIds: [portrait],
      characterPortraitAssetIds: [portrait],
    }, [portrait]);
    expect(selection.assetIds).toEqual([product]);
    expect(planAiStoryAssetLinkUsage(selection)).toEqual([
      { assetId: product, usageType: "product_source" },
    ]);
  });

  it("persists distinct product, location, brand, style, and generic roles", () => {
    const plan = planAiStoryAssetLinkUsage({
      assetIds: [product, location, brand, style, generic],
      productAssetIds: [product],
      locationAssetIds: [location],
      brandAssetIds: [brand],
      styleAssetIds: [style],
      genericAssetIds: [generic],
    });
    expect(plan).toEqual([
      { assetId: product, usageType: "product_source" },
      { assetId: location, usageType: "location_reference" },
      { assetId: brand, usageType: "brand_reference" },
      { assetId: style, usageType: "style_reference" },
      { assetId: generic, usageType: "generic_reference" },
    ]);
    expect(projectLegacyAiStoryAssetUsage("reference")).toBe("generic_reference");
    expect(projectLegacyAiStoryAssetUsage("product_source")).toBe("product_source");
    expect(explicitRoleHintForAiStoryUsage("location_reference")).toBe("LOCATION_REFERENCE");
    expect(explicitRoleHintForAiStoryUsage("reference")).toBe("REFERENCE");
  });

  it("lets one asset take a different role in another selection without changing the id", () => {
    const story = planAiStoryAssetLinkUsage({ assetIds: [product], productAssetIds: [product] });
    const photo = planAiStoryAssetLinkUsage({ assetIds: [product], styleAssetIds: [product] });
    expect(story[0]).toEqual({ assetId: product, usageType: "product_source" });
    expect(photo[0]).toEqual({ assetId: product, usageType: "style_reference" });
  });

  it("builds the confirmation preview from the same plan that would be persisted", () => {
    const selection = {
      assetIds: [product, location],
      productAssetIds: [product],
      locationAssetIds: [location],
      characterPortraitAssetIds: [portrait],
      mappingConfirmed: true,
    };
    const authority = compileAiStoryIntakeAuthority({
      selection,
      assets: [
        {
          assetId: product,
          label: "Mini Handheld Fan",
          contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          variantCandidates: ["Pink"],
          variantAnalysisState: "READY",
        },
        { assetId: location, label: "Florist workbench" },
      ],
      character: { name: "Yuki", characterId: character, characterVersionId: null, portraitAssetId: portrait },
      offscreenSpeaker: "Boss",
    });
    expect(authority.character).toMatchObject({ name: "Yuki", characterId: character, identityLocked: true });
    expect(authority.products).toEqual([{
      assetId: product,
      label: "Mini Handheld Fan",
      variant: "Pink",
      variantStatus: "confirmed",
      role: "product_source",
      analysisState: "READY",
      sourceMultiVariant: false,
      visualGroundingStatus: "confirmed",
      visualReferenceId: product,
      visualReferenceContentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      visualReferenceLineage: {
        kind: "SOURCE_ASSET",
        sourceAssetId: product,
        sourceAssetContentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    }]);
    expect(authority.locations).toEqual([{ assetId: location, label: "Florist workbench", role: "location_reference" }]);
    expect(authority.offscreenSpeaker).toEqual({ name: "Boss", visualReference: false });
    expect(authority.bindings).toEqual(planAiStoryAssetLinkUsage(selection));
    expect(authority.bindings.some((binding) => binding.assetId === portrait)).toBe(false);
  });
});
