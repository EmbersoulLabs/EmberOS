import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_EXACT_PRODUCT_DERIVATIVE_RESOLUTION_VERSION,
  AI_STORY_PRODUCT_BACKGROUND_SUITABILITY_CONTRACT_VERSION,
  AI_STORY_PRODUCT_VISUAL_MATERIAL_SELECTION_CONTRACT_VERSION,
  PHOTO_SCENE_EXTRACTION_CONTRACT,
  PHOTO_SCENE_EXTRACTION_CONTRACT_VERSION,
  PHOTO_SCENE_EXTRACTION_POLICY,
  PRODUCT_TRANSPARENCY_INSPECTION_POLICY,
  type ExactProductDerivativeResolution,
  type ProductBackgroundSuitabilityAuthority,
} from "../packages/shared/src/index";
import {
  ProductVisualMaterialSelectionAuthorityError,
  deriveProductVisualMaterialSelectionAuthority,
  sha256CanonicalIntegrityHash,
  verifyProductVisualMaterialSelectionAuthority,
} from "../packages/shared/src/server";

const ID = {
  org: "00000000-0000-4000-8000-000000000001",
  workspace: "00000000-0000-4000-8000-000000000002",
  campaign: "00000000-0000-4000-8000-000000000003",
  story: "00000000-0000-4000-8000-000000000004",
  storyVersion: "00000000-0000-4000-8000-000000000005",
  scene: "00000000-0000-4000-8000-000000000006",
  sceneVersion: "00000000-0000-4000-8000-000000000007",
  productA: "00000000-0000-4000-8000-000000000008",
  productB: "00000000-0000-4000-8000-000000000009",
  derivative: "00000000-0000-4000-8000-000000000010",
  generation: "00000000-0000-4000-8000-000000000011",
} as const;

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_D = `sha256:${"d".repeat(64)}`;
const HASH_G = `sha256:${"e".repeat(64)}`;

type Outcome = ProductBackgroundSuitabilityAuthority["outcome"];

function suitability(
  outcome: Outcome,
  productId = ID.productA,
  sourceHash = HASH_A
): ProductBackgroundSuitabilityAuthority {
  const transparencyState =
    outcome === "TRANSPARENT_BACKGROUND_CERTIFIED"
      ? "CERTIFIED_TRANSPARENT_BACKGROUND"
      : outcome === "OPAQUE_NOT_ISOLATED"
        ? "FULLY_OPAQUE"
        : "UNINSPECTABLE";
  const body = {
    contractVersion: AI_STORY_PRODUCT_BACKGROUND_SUITABILITY_CONTRACT_VERSION,
    orgId: ID.org,
    workspaceId: ID.workspace,
    campaignId: ID.campaign,
    productAuthorityId: productId,
    sourceAssetId: productId,
    sourceAssetContentHash: sourceHash,
    mimeType: outcome === "INSPECTION_UNSUPPORTED" ? "image/webp" : "image/png",
    inspectionVersion: PRODUCT_TRANSPARENCY_INSPECTION_POLICY.version,
    inspection: {
      byteHashVerified: true as const,
      byteLength: 128,
      transparencyState,
      ...(transparencyState === "UNINSPECTABLE"
        ? { reason: outcome === "INSPECTION_FAILED" ? "MALFORMED_IMAGE" : "FORMAT_UNSUPPORTED" }
        : {}),
    },
    outcome,
  };
  return {
    ...body,
    fingerprint: sha256CanonicalIntegrityHash({
      kind: AI_STORY_PRODUCT_BACKGROUND_SUITABILITY_CONTRACT_VERSION,
      authority: body,
    }),
  } as ProductBackgroundSuitabilityAuthority;
}

function derivative(
  status: "FOUND" | "NOT_FOUND",
  productId = ID.productA,
  sourceHash = HASH_A,
  reason: "NO_READY_EXTRACTION" | "CANDIDATE_NOT_REUSABLE" | "OUTPUT_UNAVAILABLE" =
    "NO_READY_EXTRACTION"
): ExactProductDerivativeResolution {
  const base = {
    contractVersion: AI_STORY_EXACT_PRODUCT_DERIVATIVE_RESOLUTION_VERSION,
    productAuthorityId: productId,
    sourceAssetId: productId,
    sourceAssetContentHash: sourceHash,
  };
  return status === "FOUND"
    ? {
        ...base,
        status,
        derivative: {
          assetId: ID.derivative,
          contentHash: HASH_D,
          generationId: ID.generation,
          generationFingerprint: HASH_G,
          operation: "product_extraction",
        },
      }
    : { ...base, status, reason };
}

function selectionInput(options: {
  productId?: string;
  sourceHash?: string;
  sceneRequirement?: "NONE" | "PREFERRED" | "REQUIRED";
  effectiveRequirement?: "NONE" | "REQUIRED";
  outcome?: Outcome;
  derivative?: ExactProductDerivativeResolution;
  preparationCertified?: boolean;
  referenceFree?: boolean;
} = {}) {
  const productId = options.productId ?? ID.productA;
  const sourceHash = options.sourceHash ?? HASH_A;
  const referenceFree = options.referenceFree ?? options.effectiveRequirement === "NONE";
  return {
    sceneScope: {
      orgId: ID.org,
      workspaceId: ID.workspace,
      campaignId: ID.campaign,
      storyId: ID.story,
      storyVersionId: ID.storyVersion,
      sceneId: ID.scene,
      sceneVersionId: ID.sceneVersion,
    },
    sceneProductBinding: {
      productAuthorityId: productId,
      sourceAssetId: productId,
      sourceAssetContentHash: sourceHash,
    },
    resolvedProductAuthority: {
      productAuthorityId: productId,
      sourceAssetId: productId,
      sourceAssetContentHash: sourceHash,
      displayName: "Display metadata only",
      identityFacts: ["Canonical Product"],
      visibleEvidenceGoals: [],
      sceneStateFacts: [],
      mustKeep: [],
      mustAvoid: [],
      visualIdentityRequirement: options.sceneRequirement ?? "REQUIRED",
    },
    effectiveGenerationAuthority: referenceFree
      ? {
          strategy: "TEXT_TO_VIDEO" as const,
          referenceSource: "REFERENCE_FREE_T2V" as const,
          effectiveReferenceIds: [],
          firstFrameAssetId: null,
          productVisualIdentityRequirement: "NONE" as const,
        }
      : {
          strategy: "PRODUCT_GROUNDED_VIDEO" as const,
          referenceSource: "STORY_INHERITED" as const,
          effectiveReferenceIds: [productId],
          firstFrameAssetId: productId,
          productVisualIdentityRequirement: options.effectiveRequirement ?? ("REQUIRED" as const),
        },
    suitability: suitability(options.outcome ?? "OPAQUE_NOT_ISOLATED", productId, sourceHash),
    derivativeResolution:
      options.derivative ?? derivative("NOT_FOUND", productId, sourceHash),
    ...(options.preparationCertified
      ? {
          preparationInput: {
            version: PHOTO_SCENE_EXTRACTION_CONTRACT_VERSION,
            contract: PHOTO_SCENE_EXTRACTION_CONTRACT,
            operation: "product_extraction" as const,
            policy: PHOTO_SCENE_EXTRACTION_POLICY,
            orgId: ID.org,
            workspaceId: ID.workspace,
            campaignId: ID.campaign,
            sourceAssetId: productId,
            sourceContentHash: sourceHash,
            storagePath: `${ID.workspace}/library/${productId}.png`,
            mimeType: "image/png",
          },
        }
      : {}),
  };
}

describe("AI Story Product visual material selection authority", () => {
  it("hard-locks REFERENCE_FREE_T2V NONE to no visual input despite all material evidence", () => {
    const input = selectionInput({
      sceneRequirement: "REQUIRED",
      effectiveRequirement: "NONE",
      outcome: "TRANSPARENT_BACKGROUND_CERTIFIED",
      derivative: derivative("FOUND"),
      referenceFree: true,
    });
    const result = deriveProductVisualMaterialSelectionAuthority(input);
    expect(result.selection).toBe("NO_PRODUCT_VISUAL_INPUT");
    expect(result.selectedMaterial).toBeNull();
    expect(input.effectiveGenerationAuthority.effectiveReferenceIds).toEqual([]);
    expect(input.effectiveGenerationAuthority.firstFrameAssetId).toBeNull();
  });

  it.each(["NONE", "PREFERRED"] as const)(
    "%s Scene requirement does not create execution-time Product visual authority",
    (sceneRequirement) => {
      const result = deriveProductVisualMaterialSelectionAuthority(
        selectionInput({ sceneRequirement, effectiveRequirement: "NONE", referenceFree: true })
      );
      expect(result.selection).toBe("NO_PRODUCT_VISUAL_INPUT");
      expect(result.preparationCapability.status).toBe("NOT_CERTIFIED");
    }
  );

  it("does not turn Product presence with Scene requirement NONE into visual input", () => {
    const result = deriveProductVisualMaterialSelectionAuthority(
      selectionInput({
        sceneRequirement: "NONE",
        effectiveRequirement: "REQUIRED",
        outcome: "TRANSPARENT_BACKGROUND_CERTIFIED",
        referenceFree: false,
      })
    );
    expect(result.selection).toBe("NO_PRODUCT_VISUAL_INPUT");
    expect(result.reason).toBe("SCENE_PRODUCT_VISUAL_IDENTITY_NOT_REQUIRED");
  });

  it("selects the exact transparent canonical source when Product material is required", () => {
    const result = deriveProductVisualMaterialSelectionAuthority(
      selectionInput({
        outcome: "TRANSPARENT_BACKGROUND_CERTIFIED",
        effectiveRequirement: "REQUIRED",
        referenceFree: false,
      })
    );
    expect(result.selection).toBe("SOURCE_ASSET");
    expect(result.selectedMaterial).toEqual({
      kind: "SOURCE_ASSET",
      assetId: ID.productA,
      contentHash: HASH_A,
    });
  });

  it("prioritizes a certified transparent source over an existing derivative", () => {
    const result = deriveProductVisualMaterialSelectionAuthority(
      selectionInput({
        outcome: "TRANSPARENT_BACKGROUND_CERTIFIED",
        derivative: derivative("FOUND"),
        referenceFree: false,
      })
    );
    expect(result.selection).toBe("SOURCE_ASSET");
  });

  it.each(["OPAQUE_NOT_ISOLATED", "INSPECTION_UNSUPPORTED", "INSPECTION_FAILED"] as const)(
    "selects an independently certified derivative for %s source evidence",
    (outcome) => {
      const result = deriveProductVisualMaterialSelectionAuthority(
        selectionInput({ outcome, derivative: derivative("FOUND"), referenceFree: false })
      );
      expect(result.selection).toBe("EXTRACTED_DERIVATIVE");
      expect(result.productAuthority).toEqual({
        productAuthorityId: ID.productA,
        sourceAssetId: ID.productA,
        sourceAssetContentHash: HASH_A,
      });
      expect(result.selectedMaterial).toMatchObject({
        kind: "EXTRACTED_DERIVATIVE",
        assetId: ID.derivative,
        generationId: ID.generation,
      });
    }
  );

  it.each([
    "NO_READY_EXTRACTION",
    "CANDIDATE_NOT_REUSABLE",
    "OUTPUT_UNAVAILABLE",
  ] as const)("preserves %s while returning state-only preparation required", (notFoundReason) => {
    const result = deriveProductVisualMaterialSelectionAuthority(
      selectionInput({
        outcome: "OPAQUE_NOT_ISOLATED",
        derivative: derivative("NOT_FOUND", ID.productA, HASH_A, notFoundReason),
        preparationCertified: true,
        referenceFree: false,
      })
    );
    expect(result.selection).toBe("PRODUCT_PREPARATION_REQUIRED");
    expect(result.derivativeResolution.reason).toBe(notFoundReason);
    expect(result.selectedMaterial).toBeNull();
  });

  it("converges to the exact derivative without changing Product authority", () => {
    const before = deriveProductVisualMaterialSelectionAuthority(
      selectionInput({
        outcome: "OPAQUE_NOT_ISOLATED",
        derivative: derivative("NOT_FOUND", ID.productA, HASH_A, "OUTPUT_UNAVAILABLE"),
        preparationCertified: true,
        referenceFree: false,
      })
    );
    const after = deriveProductVisualMaterialSelectionAuthority(
      selectionInput({
        outcome: "OPAQUE_NOT_ISOLATED",
        derivative: derivative("FOUND"),
        preparationCertified: true,
        referenceFree: false,
      })
    );
    expect(before.selection).toBe("PRODUCT_PREPARATION_REQUIRED");
    expect(after.selection).toBe("EXTRACTED_DERIVATIVE");
    expect(after.productAuthority).toEqual(before.productAuthority);
  });

  it("requires certified Photo Scene input capability for unsupported source preparation", () => {
    const certified = deriveProductVisualMaterialSelectionAuthority(
      selectionInput({
        outcome: "INSPECTION_UNSUPPORTED",
        preparationCertified: true,
        referenceFree: false,
      })
    );
    const uncertified = deriveProductVisualMaterialSelectionAuthority(
      selectionInput({ outcome: "INSPECTION_UNSUPPORTED", referenceFree: false })
    );
    expect(certified.selection).toBe("PRODUCT_PREPARATION_REQUIRED");
    expect(uncertified.selection).toBe("PRODUCT_VISUAL_INPUT_UNUSABLE");
  });

  it("fails unusable after inspection failure when no exact derivative exists", () => {
    const result = deriveProductVisualMaterialSelectionAuthority(
      selectionInput({
        outcome: "INSPECTION_FAILED",
        preparationCertified: true,
        referenceFree: false,
      })
    );
    expect(result.selection).toBe("PRODUCT_VISUAL_INPUT_UNUSABLE");
    expect(result.reason).toBe("INSPECTION_FAILED_WITHOUT_DERIVATIVE");
  });

  it("fails closed for mismatched resolved, suitability, derivative, or preparation authority", () => {
    const resolvedMismatch = selectionInput({ referenceFree: false });
    resolvedMismatch.resolvedProductAuthority.sourceAssetContentHash = HASH_B;
    expect(() => deriveProductVisualMaterialSelectionAuthority(resolvedMismatch)).toThrowError(
      ProductVisualMaterialSelectionAuthorityError
    );

    expect(() =>
      deriveProductVisualMaterialSelectionAuthority({
        ...selectionInput({ referenceFree: false }),
        suitability: suitability("OPAQUE_NOT_ISOLATED", ID.productB, HASH_A),
      })
    ).toThrowError(ProductVisualMaterialSelectionAuthorityError);

    expect(() =>
      deriveProductVisualMaterialSelectionAuthority({
        ...selectionInput({ referenceFree: false }),
        derivativeResolution: derivative("FOUND", ID.productB, HASH_A),
      })
    ).toThrowError(ProductVisualMaterialSelectionAuthorityError);

    const preparationMismatch = selectionInput({
      preparationCertified: true,
      referenceFree: false,
    });
    preparationMismatch.preparationInput!.sourceAssetId = ID.productB;
    expect(() => deriveProductVisualMaterialSelectionAuthority(preparationMismatch)).toThrowError(
      ProductVisualMaterialSelectionAuthorityError
    );
  });

  it("rejects stale hash evidence and same-hash cross-Asset authority", () => {
    expect(() =>
      deriveProductVisualMaterialSelectionAuthority({
        ...selectionInput({ sourceHash: HASH_B, referenceFree: false }),
        suitability: suitability("OPAQUE_NOT_ISOLATED", ID.productA, HASH_A),
      })
    ).toThrowError(ProductVisualMaterialSelectionAuthorityError);
    expect(() =>
      deriveProductVisualMaterialSelectionAuthority({
        ...selectionInput({ productId: ID.productB, sourceHash: HASH_A, referenceFree: false }),
        derivativeResolution: derivative("FOUND", ID.productA, HASH_A),
      })
    ).toThrowError(ProductVisualMaterialSelectionAuthorityError);
  });

  it("binds Scene version identity and rejects reuse as another Scene version", () => {
    const result = deriveProductVisualMaterialSelectionAuthority(
      selectionInput({ referenceFree: false })
    );
    expect(verifyProductVisualMaterialSelectionAuthority(result, result)).toBe(true);
    expect(
      verifyProductVisualMaterialSelectionAuthority(result, {
        ...result,
        sceneVersionId: "00000000-0000-4000-8000-000000000099",
      })
    ).toBe(false);
  });

  it("selects multiple Products independently and deterministically", () => {
    const aInput = selectionInput({
      productId: ID.productA,
      sourceHash: HASH_A,
      outcome: "TRANSPARENT_BACKGROUND_CERTIFIED",
      referenceFree: false,
    });
    const bInput = selectionInput({
      productId: ID.productB,
      sourceHash: HASH_B,
      outcome: "OPAQUE_NOT_ISOLATED",
      preparationCertified: true,
      referenceFree: false,
    });
    const firstA = deriveProductVisualMaterialSelectionAuthority(aInput);
    const secondA = deriveProductVisualMaterialSelectionAuthority(aInput);
    const resultB = deriveProductVisualMaterialSelectionAuthority(bInput);
    expect(firstA).toEqual(secondA);
    expect(firstA.fingerprint).not.toBe(resultB.fingerprint);
    expect(firstA.productAuthority.productAuthorityId).toBe(ID.productA);
    expect(resultB.productAuthority.productAuthorityId).toBe(ID.productB);
  });

  it("rejects malformed REFERENCE_FREE_T2V authority rather than changing references", () => {
    const input = selectionInput({ effectiveRequirement: "NONE", referenceFree: true });
    input.effectiveGenerationAuthority.effectiveReferenceIds.push(ID.productA);
    expect(() => deriveProductVisualMaterialSelectionAuthority(input)).toThrowError(
      ProductVisualMaterialSelectionAuthorityError
    );
  });

  it("contains no preparation, persistence, Scene-frame, or Provider mapping path", () => {
    const source = readFileSync(
      "packages/shared/src/ai-story-product-visual-material-selection.server.ts",
      "utf8"
    );
    for (const forbidden of [
      "requestProductExtraction",
      "retryProductExtraction",
      "enqueuePhotoSceneExtract",
      "PreparedSceneFrameAuthority",
      "firstFrameAssetId =",
      "effectiveReferenceIds =",
      ".insert(",
      ".update(",
      ".delete(",
      "PhotoRoom",
      "Seedance",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("exports the V1 provider-neutral authority contract", () => {
    expect(AI_STORY_PRODUCT_VISUAL_MATERIAL_SELECTION_CONTRACT_VERSION).toBe(
      "ai-story-product-visual-material-selection.v1"
    );
  });
});
