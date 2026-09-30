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
  resolveProductVariantVisualGrounding,
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
    expect(open).toMatchObject({ status: "selection_required", variant: "Red", code: "PRODUCT_VARIANT_SELECTION_REQUIRED" });
    expect(frozen).toMatchObject({ status: "confirmed", variant: "Red" });
  });

  it("does not silently choose among multiple variants", () => {
    const resolution = resolveProductVariantMapping({
      candidates: extractProductVariantCandidates(many),
      confirmed: true,
    });
    expect(resolution.status).toBe("selection_required");
    expect(resolution.variant).toBeNull();
    expect(resolution.code).toBe("PRODUCT_VARIANT_SELECTION_REQUIRED");
  });

  it("proposes the appearance named by user intent when that candidate exists", () => {
    const resolution = resolveProductVariantMapping({
      candidates: extractProductVariantCandidates(many),
      userIntent: "Use the white one",
      confirmed: false,
    });
    expect(resolution).toMatchObject({ status: "selection_required", variant: "White" });
  });

  it("requires analysis instead of reporting conflict when durable variant facts are missing", () => {
    const resolution = resolveProductVariantMapping({
      candidates: [],
      userIntent: "Use the pink one",
      confirmed: true,
    });
    expect(resolution).toEqual({
      status: "analysis_required",
      variant: null,
      candidates: [],
      code: "PRODUCT_VARIANT_ANALYSIS_REQUIRED",
    });
  });

  it("conflicts when the requested appearance is not in the source facts", () => {
    const resolution = resolveProductVariantMapping({
      candidates: extractProductVariantCandidates(one),
      userIntent: "Use the white one",
      confirmed: true,
    });
    expect(resolution).toMatchObject({ status: "conflict", code: "PRODUCT_VARIANT_CONFLICT", variant: null });
  });

  it("requires a clear user reference for an ambiguous multi-variant source", () => {
    const resolution = resolveProductVariantMapping({
      candidates: ["Pink", "White"],
      userIntent: "Use Pink",
      selectedVariant: "Pink",
      confirmed: true,
    });
    expect(resolveProductVariantVisualGrounding({
      sourceAssetId: product,
      sourceAssetContentHash: hash,
      resolution,
    })).toEqual({
      status: "user_reference_required",
      visualReferenceId: null,
      visualReferenceContentHash: null,
      sourceMultiVariant: true,
      lineage: null,
      code: "PRODUCT_VARIANT_VISUAL_REFERENCE_REQUIRED",
    });
  });

  it("uses a single-variant source as the auditable visual reference", () => {
    const resolution = resolveProductVariantMapping({
      candidates: ["Pink"],
      userIntent: "Use Pink",
      confirmed: true,
    });
    expect(resolveProductVariantVisualGrounding({
      sourceAssetId: product,
      sourceAssetContentHash: hash,
      resolution,
    })).toMatchObject({
      status: "confirmed",
      visualReferenceId: product,
      visualReferenceContentHash: hash,
      sourceMultiVariant: false,
      lineage: {
        kind: "SOURCE_ASSET",
        sourceAssetId: product,
        sourceAssetContentHash: hash,
      },
    });
  });

  it("preserves exact source and analysis lineage for an authorized derived variant crop", () => {
    const derivedAssetId = "90000000-0000-4000-8000-000000000009";
    const snapshotId = "91000000-0000-4000-8000-000000000009";
    const derivedHash = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const resolution = resolveProductVariantMapping({
      candidates: ["Pink", "White"],
      selectedVariant: "Pink",
      confirmed: true,
    });
    expect(resolveProductVariantVisualGrounding({
      sourceAssetId: product,
      sourceAssetContentHash: hash,
      resolution,
      derivedReference: {
        assetId: derivedAssetId,
        contentHash: derivedHash,
        sourceAssetId: product,
        sourceAssetContentHash: hash,
        analysisSnapshotId: snapshotId,
        variant: "Pink",
      },
    })).toEqual({
      status: "confirmed",
      visualReferenceId: derivedAssetId,
      visualReferenceContentHash: derivedHash,
      sourceMultiVariant: true,
      lineage: {
        kind: "DERIVED_REGION",
        sourceAssetId: product,
        sourceAssetContentHash: hash,
        analysisSnapshotId: snapshotId,
      },
    });
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
        { assetId: product, label: "Sample", contentHash: hash, variantCandidates: ["Red"], variantAnalysisState: "READY" },
        { assetId: location, label: "Bench" },
      ],
      userIntent: "Show the product",
    });
    expect(authority.products[0]).toMatchObject({
      variant: "Red",
      variantStatus: "confirmed",
      role: "product_source",
      visualGroundingStatus: "confirmed",
      visualReferenceId: product,
    });
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
