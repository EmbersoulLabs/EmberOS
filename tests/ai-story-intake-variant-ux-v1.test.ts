import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  extractProductVariantCandidates,
  resolveProductVariantMapping,
} from "@ceo-agent/shared";
import {
  VISUAL_SEMANTIC_ANALYZER_VERSION,
  VisualSemanticAssetAnalyzer,
} from "@ceo-agent/agents";

const source = "20000000-0000-4000-8000-000000000002";

describe("AI Story Intake UX V1 product variant closure", () => {
  it("extracts observable variant candidates and region evidence without catalogue invention", async () => {
    const analyzer = new VisualSemanticAssetAnalyzer(async () => ({
      observed: {
        visibleText: [],
        namedItems: ["Mini handheld fan"],
        objects: ["pink handheld fan"],
        people: [],
        environmentCues: [],
        brandOrLogoCues: [],
      },
      inferred: {
        categories: ["PRODUCT"],
        productCandidates: [{
          name: "Mini handheld fan",
          relationship: "PRIMARY_PRODUCT",
          confidence: 0.98,
          evidence: ["pink handheld fan"],
        }],
        productVariantCandidates: [{
          label: "Pink",
          observableAttributes: ["pink finish"],
          confidence: 0.97,
          evidence: ["pink handheld fan"],
          regionEvidence: { x: 0.1, y: 0.1, width: 0.4, height: 0.7, confidence: 0.91 },
        }],
        productGroundingSupported: true,
        characterGroundingSupported: false,
      },
    }));
    const result = await analyzer.analyze({
      asset: {
        id: source,
        orgId: "10000000-0000-4000-8000-000000000001",
        workspaceId: "10000000-0000-4000-8000-000000000002",
        type: "image",
        storagePath: "workspace/library/fan.png",
        contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        mimeType: "image/png",
        width: 1000,
        height: 1000,
        durationSec: null,
        fileSizeBytes: 100,
        metadata: null,
        status: "ready",
        deletedAt: null,
      },
      loadRawBytes: async () => new Uint8Array([1, 2, 3]),
    });
    expect(extractProductVariantCandidates(result.facts.visualSemantics)).toEqual(["Pink"]);
    expect(result.facts.visualSemantics).toMatchObject({
      inferred: {
        productVariantCandidates: [{
          label: "Pink",
          regionEvidence: { x: 0.1, y: 0.1, width: 0.4, height: 0.7 },
        }],
      },
    });
    expect(VISUAL_SEMANTIC_ANALYZER_VERSION).toBe("emberos-asset-visual-semantic-analyzer.v3");
  });

  it("preselects compatible intent but keeps confirmation human-controlled", () => {
    expect(resolveProductVariantMapping({
      candidates: ["Blue", "Pink", "White"],
      userIntent: "Use the Pink fan",
      confirmed: false,
    })).toMatchObject({
      status: "selection_required",
      variant: "Pink",
      code: "PRODUCT_VARIANT_SELECTION_REQUIRED",
    });
  });

  it("uses the existing content-addressed analyzer and exposes normal UX resolution", () => {
    const route = readFileSync("apps/web/src/app/api/campaigns/[id]/assets/[assetId]/variant-analysis/route.ts", "utf8");
    const grounding = readFileSync("apps/web/src/lib/ai-story-asset-semantic-grounding.ts", "utf8");
    const form = readFileSync("apps/web/src/components/ai-story/EpisodeCreateForm.tsx", "utf8");
    const page = readFileSync("apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/new/page.tsx", "utf8");
    expect(route).toContain("analyzeVisualSemanticAsset");
    expect(grounding).toContain("AiStoryAssetAwareExecutionPlannerRepository");
    expect(grounding).toContain("new VisualSemanticAssetAnalyzer()");
    expect(form).toContain("Analyzing product variants…");
    expect(form).toContain("Choose from Library");
    expect(form).toContain("Choose from Workspace Library");
    expect(form).toContain("Needs a clear");
    expect(page).toContain("/assets/attach");
    expect(page).toContain("/library?sort=newest");
    expect(page).toContain("Attached Asset was not returned by the Campaign authority readback");
    expect(form).not.toMatch(/Mini Handheld Fan|Yuki/);
  });

  it("can freeze and persist intake without starting planning or generation", () => {
    const page = readFileSync("apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/new/page.tsx", "utf8");
    const form = readFileSync("apps/web/src/components/ai-story/EpisodeCreateForm.tsx", "utf8");
    expect(form).toContain("Save intake without planning");
    expect(form).toContain("onSaveDraft(buildPayload())");
    expect(page).toContain("createEpisode(payload, false)");
    expect(page).toContain("if (startPlanning)");
    expect(page).toContain("/generate`");
  });

  it("keys intake readback by content identity and exact analyzer version", () => {
    const campaign = readFileSync("apps/web/src/app/api/campaigns/[id]/route.ts", "utf8");
    const confirmation = readFileSync("apps/web/src/lib/ai-story-service.ts", "utf8");
    for (const sourceText of [campaign, confirmation]) {
      expect(sourceText).toContain("analyzedContentHash");
      expect(sourceText).toContain("VISUAL_SEMANTIC_ANALYZER_VERSION");
    }
  });

  it("keeps location imagery optional and separates it from the world setting", () => {
    const form = readFileSync("apps/web/src/components/ai-story/EpisodeCreateForm.tsx", "utf8");
    expect(form).toContain("World setting");
    expect(form).toContain("Location reference (optional)");
    expect(form).toContain("A Location image is optional");
  });
});
