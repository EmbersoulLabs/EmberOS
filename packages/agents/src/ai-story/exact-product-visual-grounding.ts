import type { CanonicalScenePayloadForAdapter } from "./canonical-scene-payload-resolver";
import type { SeedanceModelArkCreateRequest } from "./seedance-request-mapping";

export type ProductVisualAuthorityComparison =
  | "MATCH"
  | "CONFLICT"
  | "NOT_CERTIFIED";

export type ProductVisualGroundingMode =
  | "T2V"
  | "ASSET_REFERENCED_T2V"
  | "FIRST_FRAME_I2V"
  | "FIRST_LAST_FRAME_I2V"
  | "OTHER";

export type ExactProductVisualGroundingCertification = {
  readonly productAssetId?: string;
  readonly productReferencePresent: boolean;
  readonly providerReferenceCount: number;
  readonly providerMode: ProductVisualGroundingMode;
  readonly previousSceneVisualReferencePresent: boolean;
  readonly explicitReferenceBindingPresent: boolean;
  readonly exactProductLockContractPresent: boolean;
  readonly providerCanEnforceExactProductContinuity: boolean;
  readonly authorityComparison: ProductVisualAuthorityComparison;
  readonly safeToAuthorize: boolean;
  readonly blockers: readonly string[];
};

function inferProviderMode(
  request: SeedanceModelArkCreateRequest
): ProductVisualGroundingMode {
  const images = request.content.filter((item) => item.type === "image_url");
  const firstFrames = images.filter((item) => item.role === "first_frame").length;
  const lastFrames = images.filter((item) => item.role === "last_frame").length;
  const references = images.filter((item) => item.role === "reference_image").length;
  if (firstFrames > 0 && lastFrames > 0) return "FIRST_LAST_FRAME_I2V";
  if (firstFrames > 0) return "FIRST_FRAME_I2V";
  if (references > 0) return "ASSET_REFERENCED_T2V";
  if (images.length === 0) return "T2V";
  return "OTHER";
}

/**
 * Pure, read-only pre-dispatch certification. It deliberately returns no URLs,
 * creates no Attempt/Outbox record, and performs no Provider call.
 *
 * A Campaign Asset reference is useful conditioning, but is not an exact visual
 * identity lock. Exact continuity is fail-closed unless the prior approved Scene
 * visual agrees with the Campaign Asset and the selected Provider contract can
 * actually enforce the required arrangement identity.
 */
export function certifyExactProductVisualGrounding(input: {
  readonly payload: CanonicalScenePayloadForAdapter;
  readonly providerRequest: SeedanceModelArkCreateRequest;
  readonly authorityComparison: ProductVisualAuthorityComparison;
  readonly previousSceneVisualReferencePresent: boolean;
  readonly exactProductLockContractPresent: boolean;
  readonly providerCanEnforceExactProductContinuity: boolean;
}): ExactProductVisualGroundingCertification {
  const productAssetId = input.payload.productIdentityCapsule.productAssetId;
  const productReferencePresent =
    input.payload.productIdentityCapsule.productReferencePresent &&
    Boolean(productAssetId) &&
    input.payload.assetReferences.some(
      (reference) => reference.assetId === productAssetId
    );
  const imageItems = input.providerRequest.content.filter(
    (item) => item.type === "image_url"
  );
  const providerReferenceCount = imageItems.length;
  const prompt = input.providerRequest.content.find(
    (item) => item.type === "text"
  )?.text;
  const explicitReferenceBindingPresent = Boolean(
    prompt && /\b(?:image|reference image)\s*\d+\b/i.test(prompt)
  );
  const blockers: string[] = [];

  if (!productReferencePresent) {
    blockers.push("CAMPAIGN_PRODUCT_REFERENCE_MISSING");
  }
  if (providerReferenceCount === 0) {
    blockers.push("PROVIDER_VISUAL_REFERENCE_MISSING");
  }
  if (!input.previousSceneVisualReferencePresent) {
    blockers.push("APPROVED_PREVIOUS_SCENE_VISUAL_REFERENCE_MISSING");
  }
  if (!explicitReferenceBindingPresent) {
    blockers.push("PROMPT_REFERENCE_ASSOCIATION_AMBIGUOUS");
  }
  if (input.authorityComparison !== "MATCH") {
    blockers.push(
      input.authorityComparison === "CONFLICT"
        ? "CAMPAIGN_ASSET_AND_APPROVED_SCENE_CONFLICT"
        : "VISUAL_AUTHORITY_MATCH_NOT_CERTIFIED"
    );
  }
  if (!input.exactProductLockContractPresent) {
    blockers.push("EXACT_PRODUCT_LOCK_CONTRACT_MISSING");
  }
  if (!input.providerCanEnforceExactProductContinuity) {
    blockers.push("PROVIDER_EXACT_CONTINUITY_NOT_ENFORCEABLE");
  }

  return {
    ...(productAssetId ? { productAssetId } : {}),
    productReferencePresent,
    providerReferenceCount,
    providerMode: inferProviderMode(input.providerRequest),
    previousSceneVisualReferencePresent:
      input.previousSceneVisualReferencePresent,
    explicitReferenceBindingPresent,
    exactProductLockContractPresent: input.exactProductLockContractPresent,
    providerCanEnforceExactProductContinuity:
      input.providerCanEnforceExactProductContinuity,
    authorityComparison: input.authorityComparison,
    safeToAuthorize: blockers.length === 0,
    blockers,
  };
}
