import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CreativeContextSchema,
  PlanningProductAuthorityProjectionSchema,
  compileAiStoryIntakeAuthority,
  extractProductVariantCandidates,
  planAiStoryAssetLinkUsage,
  projectLegacyAiStoryAssetUsage,
  resolveProductVariantMapping,
} from "@ceo-agent/shared";
import {
  assertPlanningProductAuthorityCurrent,
  projectStoryProductSourcesToPlanning,
} from "@ceo-agent/agents";
import { productVisualIdentityFingerprint } from "@ceo-agent/shared/server";

const product = "20000000-0000-4000-8000-000000000002";
const location = "30000000-0000-4000-8000-000000000003";
const portrait = "70000000-0000-4000-8000-000000000007";
const hash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const many = {
  observed: { objects: ["pink sample", "white sample", "blue sample"] },
};
const one = {
  observed: { visibleText: ["red sample"] },
};

describe("product variant authority", () => {
  it("freezes the only source variant on confirmation", () => {
    const open = resolveProductVariantMapping({ candidates: extractProductVariantCandidates(one), confirmed: false });
    const frozen = resolveProductVariantMapping({ candidates: extractProductVariantCandidates(one), confirmed: true });
    expect(open).toMatchObject({ status: "proposed", variant: "Red" });
    expect(frozen).toMatchObject({ status: "confirmed", variant: "Red" });
  });

  it("does not silently choose among multiple variants", () => {
    const resolution = resolveProductVariantMapping({
      candidates: extractProductVariantCandidates(many),
      confirmed: true,
    });
    expect(resolution.status).toBe("unresolved");
    expect(resolution.variant).toBeNull();
    expect(resolution.code).toBe("PRODUCT_VARIANT_UNRESOLVED");
  });

  it("proposes the appearance named by user intent when that candidate exists", () => {
    const resolution = resolveProductVariantMapping({
      candidates: extractProductVariantCandidates(many),
      userIntent: "Use the white one",
      confirmed: false,
    });
    expect(resolution).toMatchObject({ status: "proposed", variant: "White" });
  });

  it("conflicts when the requested appearance is not in the source facts", () => {
    const resolution = resolveProductVariantMapping({
      candidates: extractProductVariantCandidates(one),
      userIntent: "Use the white one",
      confirmed: true,
    });
    expect(resolution).toMatchObject({ status: "conflict", code: "PRODUCT_VARIANT_CONFLICT", variant: null });
  });

  it("keeps a confirmed variant through preview and planning projection", () => {
    const authority = compileAiStoryIntakeAuthority({
      selection: {
        assetIds: [product, location],
        productAssetIds: [product],
        locationAssetIds: [location],
        characterPortraitAssetIds: [portrait],
        mappingConfirmed: true,
      },
      assets: [
        { assetId: product, label: "Sample", variantCandidates: ["Red"] },
        { assetId: location, label: "Bench" },
      ],
      userIntent: "Show the product",
    });
    expect(authority.products[0]).toMatchObject({ variant: "Red", variantStatus: "confirmed", role: "product_source" });
    expect(authority.bindings).toEqual(planAiStoryAssetLinkUsage({
      assetIds: [product, location],
      productAssetIds: [product],
      locationAssetIds: [location],
    }));
    expect(authority.bindings.some((binding) => binding.assetId === portrait)).toBe(false);
    const projected = projectStoryProductSourcesToPlanning([{
      assetId: product,
      usageType: "product_source",
      contentHash: hash,
      confirmedVariant: authority.products[0]?.variant,
    }]);
    expect(projected[0]?.confirmedVariant).toBe("Red");
    expect(PlanningProductAuthorityProjectionSchema.parse({
      productAuthorityId: product,
      sourceAssetId: product,
      sourceAssetContentHash: hash,
    }).confirmedVariant).toBeUndefined();
  });

  it("changes the visual fingerprint when the variant changes and leaves the script id set unchanged", () => {
    const pink = productVisualIdentityFingerprint({ productAuthorityId: product, sourceAssetContentHash: hash, confirmedVariant: "Red" });
    const blue = productVisualIdentityFingerprint({ productAuthorityId: product, sourceAssetContentHash: hash, confirmedVariant: "Blue" });
    const same = productVisualIdentityFingerprint({ productAuthorityId: product, sourceAssetContentHash: hash, confirmedVariant: "Red" });
    expect(pink).not.toBe(blue);
    expect(pink).toBe(same);
    const scriptFingerprint = readFileSync("packages/shared/src/ai-story-script.server.ts", "utf8");
    expect(scriptFingerprint).toContain("productAuthorityIds");
    expect(scriptFingerprint).not.toContain("confirmedVariant");
    const current = projectStoryProductSourcesToPlanning([{ assetId: product, usageType: "product_source", contentHash: hash, confirmedVariant: "Red" }]);
    const next = projectStoryProductSourcesToPlanning([{ assetId: product, usageType: "product_source", contentHash: hash, confirmedVariant: "Blue" }]);
    expect(() => assertPlanningProductAuthorityCurrent({
      creativeContext: CreativeContextSchema.parse({
        storyContext: {},
        characterContext: {},
        productAuthorities: current,
        worldContext: {},
        narrativeContext: {},
      }),
      productAuthorities: next,
    })).toThrow(/stale/i);
  });

  it("keeps legacy reference readable and does not special-case a product", () => {
    expect(projectLegacyAiStoryAssetUsage("reference")).toBe("generic_reference");
    expect(planAiStoryAssetLinkUsage({ assetIds: [location], locationAssetIds: [location] })[0]?.usageType).toBe("location_reference");
    const source = readFileSync("packages/shared/src/ai-story-product-variant.ts", "utf8");
    expect(source).not.toMatch(/Yuki|Mini Handheld|mini fan/i);
  });
});
