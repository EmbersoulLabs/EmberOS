import {
  AiStoryEffectiveSceneGenerationAuthoritySchema,
  type AiStoryEffectiveSceneGenerationAuthority,
} from "./ai-story-generation-authority";
import {
  verifyProductBackgroundSuitabilityAuthority,
} from "./ai-story-product-background-suitability.server";
import {
  ProductBackgroundSuitabilityAuthoritySchema,
  type ProductBackgroundSuitabilityAuthority,
} from "./ai-story-product-background-suitability";
import {
  ExactProductDerivativeResolutionSchema,
  type ExactProductDerivativeResolution,
} from "./ai-story-product-derivative-resolution";
import {
  AI_STORY_PRODUCT_VISUAL_MATERIAL_SELECTION_CONTRACT_VERSION,
  ProductVisualMaterialSelectionAuthoritySchema,
  type ProductVisualMaterialSelectionAuthority,
} from "./ai-story-product-visual-material-selection";
import {
  AiStorySceneProductBindingSchema,
} from "./ai-story-scene";
import {
  AiStoryResolvedProductAuthoritySchema,
} from "./ai-story-scene-execution-package";
import {
  PhotoSceneExtractionInputCapsuleV1Schema,
  extractionFingerprintIdentity,
  type PhotoSceneExtractionInputCapsuleV1,
} from "./photo-scene-extraction";
import { fingerprintPhotoSceneExtractionIdentityV1 } from "./photo-scene-extraction.server";
import { sha256CanonicalIntegrityHash } from "./canonical-integrity";

export class ProductVisualMaterialSelectionAuthorityError extends Error {
  readonly code:
    | "PRODUCT_AUTHORITY_MISMATCH"
    | "SCENE_PRODUCT_AUTHORITY_REQUIRED"
    | "SUITABILITY_AUTHORITY_INVALID"
    | "DERIVATIVE_AUTHORITY_MISMATCH"
    | "PREPARATION_CAPABILITY_MISMATCH"
    | "EFFECTIVE_GENERATION_AUTHORITY_INVALID";

  constructor(
    code: ProductVisualMaterialSelectionAuthorityError["code"],
    message: string
  ) {
    super(message);
    this.name = "ProductVisualMaterialSelectionAuthorityError";
    this.code = code;
  }
}

export type ProductVisualMaterialSceneScope = {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  sceneId: string;
  sceneVersionId: string;
};

export type ProductVisualMaterialSelectionInput = {
  sceneScope: ProductVisualMaterialSceneScope;
  sceneProductBinding: {
    productAuthorityId: string;
    sourceAssetId: string;
    sourceAssetContentHash: string;
  };
  resolvedProductAuthority: {
    productAuthorityId: string;
    sourceAssetId: string;
    sourceAssetContentHash: string;
    displayName: string;
    identityFacts: string[];
    visibleEvidenceGoals: string[];
    sceneStateFacts: string[];
    mustKeep: string[];
    mustAvoid: string[];
    visualIdentityRequirement: "NONE" | "PREFERRED" | "REQUIRED";
  };
  effectiveGenerationAuthority: AiStoryEffectiveSceneGenerationAuthority;
  suitability: ProductBackgroundSuitabilityAuthority;
  derivativeResolution: ExactProductDerivativeResolution;
  preparationInput?: PhotoSceneExtractionInputCapsuleV1 | null;
};

function sameProduct(
  expected: {
    productAuthorityId: string;
    sourceAssetId: string;
    sourceAssetContentHash: string;
  },
  actual: {
    productAuthorityId: string;
    sourceAssetId: string;
    sourceAssetContentHash: string;
  }
): boolean {
  return (
    expected.productAuthorityId === actual.productAuthorityId &&
    expected.sourceAssetId === actual.sourceAssetId &&
    expected.sourceAssetContentHash === actual.sourceAssetContentHash
  );
}

function assertReferenceFreeAuthority(
  authority: AiStoryEffectiveSceneGenerationAuthority
): void {
  if (authority.referenceSource !== "REFERENCE_FREE_T2V") return;
  if (
    authority.strategy !== "TEXT_TO_VIDEO" ||
    authority.productVisualIdentityRequirement !== "NONE" ||
    authority.effectiveReferenceIds.length !== 0 ||
    authority.firstFrameAssetId !== null
  ) {
    throw new ProductVisualMaterialSelectionAuthorityError(
      "EFFECTIVE_GENERATION_AUTHORITY_INVALID",
      "REFERENCE_FREE_T2V must remain zero-reference, null-first-frame, and Product-visual NONE"
    );
  }
}

/**
 * Selects Product visual material from already-certified facts only.
 * It performs no I/O, persistence, preparation, queueing, or Provider mapping.
 */
export function deriveProductVisualMaterialSelectionAuthority(
  input: ProductVisualMaterialSelectionInput
): ProductVisualMaterialSelectionAuthority {
  const sceneBinding = AiStorySceneProductBindingSchema.parse(input.sceneProductBinding);
  const resolved = AiStoryResolvedProductAuthoritySchema.parse(
    input.resolvedProductAuthority
  );
  const effective = AiStoryEffectiveSceneGenerationAuthoritySchema.parse(
    input.effectiveGenerationAuthority
  );
  const suitability = ProductBackgroundSuitabilityAuthoritySchema.parse(
    input.suitability
  );
  const derivative = ExactProductDerivativeResolutionSchema.parse(
    input.derivativeResolution
  );

  const canonicalProduct = {
    productAuthorityId: sceneBinding.productAuthorityId,
    sourceAssetId: sceneBinding.sourceAssetId,
    sourceAssetContentHash: sceneBinding.sourceAssetContentHash,
  };
  if (
    canonicalProduct.productAuthorityId !== canonicalProduct.sourceAssetId ||
    !sameProduct(canonicalProduct, resolved)
  ) {
    throw new ProductVisualMaterialSelectionAuthorityError(
      "PRODUCT_AUTHORITY_MISMATCH",
      "Resolved Scene Product authority must match the exact canonical source Asset and content hash"
    );
  }
  if (
    !verifyProductBackgroundSuitabilityAuthority(suitability) ||
    suitability.orgId !== input.sceneScope.orgId ||
    suitability.workspaceId !== input.sceneScope.workspaceId ||
    suitability.campaignId !== input.sceneScope.campaignId ||
    !sameProduct(canonicalProduct, suitability)
  ) {
    throw new ProductVisualMaterialSelectionAuthorityError(
      "SUITABILITY_AUTHORITY_INVALID",
      "Product suitability must be valid and bind the exact Scene Product authority and scope"
    );
  }
  if (!sameProduct(canonicalProduct, derivative)) {
    throw new ProductVisualMaterialSelectionAuthorityError(
      "DERIVATIVE_AUTHORITY_MISMATCH",
      "Derivative evidence must bind the exact Scene Product authority"
    );
  }
  assertReferenceFreeAuthority(effective);

  let extractionInputFingerprint: string | null = null;
  if (input.preparationInput) {
    const preparation = PhotoSceneExtractionInputCapsuleV1Schema.parse(
      input.preparationInput
    );
    if (
      preparation.orgId !== input.sceneScope.orgId ||
      preparation.workspaceId !== input.sceneScope.workspaceId ||
      preparation.campaignId !== input.sceneScope.campaignId ||
      preparation.sourceAssetId !== canonicalProduct.sourceAssetId ||
      preparation.sourceContentHash !== canonicalProduct.sourceAssetContentHash
    ) {
      throw new ProductVisualMaterialSelectionAuthorityError(
        "PREPARATION_CAPABILITY_MISMATCH",
        "Photo Scene preparation capability must bind the exact Product source and scope"
      );
    }
    extractionInputFingerprint = fingerprintPhotoSceneExtractionIdentityV1(
      extractionFingerprintIdentity(preparation)
    );
  }

  let selection: ProductVisualMaterialSelectionAuthority["selection"];
  let selectedMaterial: ProductVisualMaterialSelectionAuthority["selectedMaterial"] = null;
  let reason: ProductVisualMaterialSelectionAuthority["reason"];

  if (effective.productVisualIdentityRequirement === "NONE") {
    selection = "NO_PRODUCT_VISUAL_INPUT";
    reason = "EFFECTIVE_GENERATION_REQUIRES_NO_PRODUCT_VISUAL_INPUT";
  } else if (resolved.visualIdentityRequirement === "NONE") {
    selection = "NO_PRODUCT_VISUAL_INPUT";
    reason = "SCENE_PRODUCT_VISUAL_IDENTITY_NOT_REQUIRED";
  } else if (suitability.outcome === "TRANSPARENT_BACKGROUND_CERTIFIED") {
    selection = "SOURCE_ASSET";
    selectedMaterial = {
      kind: "SOURCE_ASSET",
      assetId: canonicalProduct.sourceAssetId,
      contentHash: canonicalProduct.sourceAssetContentHash,
    };
    reason = "SOURCE_TRANSPARENCY_CERTIFIED";
  } else if (derivative.status === "FOUND") {
    selection = "EXTRACTED_DERIVATIVE";
    selectedMaterial = {
      kind: "EXTRACTED_DERIVATIVE",
      assetId: derivative.derivative.assetId,
      contentHash: derivative.derivative.contentHash,
      generationId: derivative.derivative.generationId,
      generationFingerprint: derivative.derivative.generationFingerprint,
    };
    reason = "EXACT_DERIVATIVE_CERTIFIED";
  } else if (suitability.outcome === "INSPECTION_FAILED") {
    selection = "PRODUCT_VISUAL_INPUT_UNUSABLE";
    reason = "INSPECTION_FAILED_WITHOUT_DERIVATIVE";
  } else if (extractionInputFingerprint) {
    selection = "PRODUCT_PREPARATION_REQUIRED";
    reason = "EXACT_DERIVATIVE_NOT_FOUND_PREPARATION_REQUIRED";
  } else {
    selection = "PRODUCT_VISUAL_INPUT_UNUSABLE";
    reason = "PHOTO_SCENE_PREPARATION_NOT_CERTIFIED";
  }

  const body = {
    contractVersion: AI_STORY_PRODUCT_VISUAL_MATERIAL_SELECTION_CONTRACT_VERSION,
    ...input.sceneScope,
    productAuthority: canonicalProduct,
    visualRequirement: {
      sceneRequirement: resolved.visualIdentityRequirement,
      effectiveGenerationRequirement: effective.productVisualIdentityRequirement,
      strategy: effective.strategy,
      referenceSource: effective.referenceSource,
    },
    suitability: {
      authorityFingerprint: suitability.fingerprint,
      outcome: suitability.outcome,
    },
    derivativeResolution: {
      contractVersion: derivative.contractVersion,
      status: derivative.status,
      ...(derivative.status === "NOT_FOUND" ? { reason: derivative.reason } : {}),
    },
    preparationCapability: extractionInputFingerprint
      ? {
          status: "CERTIFIED" as const,
          extractionInputFingerprint,
        }
      : { status: "NOT_CERTIFIED" as const },
    selection,
    selectedMaterial,
    reason,
  };
  return ProductVisualMaterialSelectionAuthoritySchema.parse({
    ...body,
    fingerprint: sha256CanonicalIntegrityHash({
      kind: AI_STORY_PRODUCT_VISUAL_MATERIAL_SELECTION_CONTRACT_VERSION,
      authority: body,
    }),
  });
}

export function verifyProductVisualMaterialSelectionAuthority(
  authority: ProductVisualMaterialSelectionAuthority,
  expected: Pick<
    ProductVisualMaterialSelectionAuthority,
    | "orgId"
    | "workspaceId"
    | "campaignId"
    | "storyId"
    | "storyVersionId"
    | "sceneId"
    | "sceneVersionId"
    | "productAuthority"
  >
): boolean {
  const parsed = ProductVisualMaterialSelectionAuthoritySchema.safeParse(authority);
  if (!parsed.success) return false;
  const { fingerprint, ...body } = parsed.data;
  return (
    fingerprint ===
      sha256CanonicalIntegrityHash({
        kind: AI_STORY_PRODUCT_VISUAL_MATERIAL_SELECTION_CONTRACT_VERSION,
        authority: body,
      }) &&
    parsed.data.orgId === expected.orgId &&
    parsed.data.workspaceId === expected.workspaceId &&
    parsed.data.campaignId === expected.campaignId &&
    parsed.data.storyId === expected.storyId &&
    parsed.data.storyVersionId === expected.storyVersionId &&
    parsed.data.sceneId === expected.sceneId &&
    parsed.data.sceneVersionId === expected.sceneVersionId &&
    sameProduct(parsed.data.productAuthority, expected.productAuthority)
  );
}
