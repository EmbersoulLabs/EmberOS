import { createHash } from "node:crypto";
import {
  AI_STORY_PRODUCT_BACKGROUND_SUITABILITY_CONTRACT_VERSION,
  PRODUCT_TRANSPARENCY_INSPECTION_POLICY,
  ProductBackgroundSuitabilityAuthoritySchema,
  type ProductBackgroundSuitabilityAuthority,
} from "./ai-story-product-background-suitability";
import { sha256CanonicalIntegrityHash } from "./canonical-integrity";
import { inspectProductImageBytes } from "./media-image-inspection.server";
import { SourceAssetContentHashSchema } from "./source-asset-content-hash";

export class ProductBackgroundSuitabilityAuthorityError extends Error {
  readonly code:
    | "PRODUCT_SOURCE_BYTE_HASH_MISMATCH"
    | "PRODUCT_SOURCE_AUTHORITY_INVALID";

  constructor(
    code:
      | "PRODUCT_SOURCE_BYTE_HASH_MISMATCH"
      | "PRODUCT_SOURCE_AUTHORITY_INVALID",
    message: string
  ) {
    super(message);
    this.name = "ProductBackgroundSuitabilityAuthorityError";
    this.code = code;
  }
}

export type ProductBackgroundSuitabilitySourceAuthority = {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  productAuthorityId: string;
  sourceAssetId: string;
  sourceAssetContentHash: string;
  mimeType: string;
};

export function deriveProductBackgroundSuitabilityAuthority(input: {
  source: ProductBackgroundSuitabilitySourceAuthority;
  bytes: Buffer;
}): ProductBackgroundSuitabilityAuthority {
  if (input.source.productAuthorityId !== input.source.sourceAssetId) {
    throw new ProductBackgroundSuitabilityAuthorityError(
      "PRODUCT_SOURCE_AUTHORITY_INVALID",
      "V1 Product authority must bind the exact canonical source Asset"
    );
  }
  const expectedHash = SourceAssetContentHashSchema.parse(
    input.source.sourceAssetContentHash
  );
  const actualHash = `sha256:${createHash("sha256").update(input.bytes).digest("hex")}`;
  if (actualHash !== expectedHash) {
    throw new ProductBackgroundSuitabilityAuthorityError(
      "PRODUCT_SOURCE_BYTE_HASH_MISMATCH",
      "Stored Product source bytes do not match canonical Asset content identity"
    );
  }

  const inspected = inspectProductImageBytes(input.bytes, input.source.mimeType);
  const outcome =
    inspected.status === "UNSUPPORTED"
      ? "INSPECTION_UNSUPPORTED"
      : inspected.status === "FAILED"
        ? "INSPECTION_FAILED"
        : inspected.transparencyState === "CERTIFIED_TRANSPARENT_BACKGROUND"
          ? "TRANSPARENT_BACKGROUND_CERTIFIED"
          : "OPAQUE_NOT_ISOLATED";
  const body = {
    contractVersion: AI_STORY_PRODUCT_BACKGROUND_SUITABILITY_CONTRACT_VERSION,
    orgId: input.source.orgId,
    workspaceId: input.source.workspaceId,
    campaignId: input.source.campaignId,
    productAuthorityId: input.source.productAuthorityId,
    sourceAssetId: input.source.sourceAssetId,
    sourceAssetContentHash: expectedHash,
    mimeType: input.source.mimeType,
    inspectionVersion: PRODUCT_TRANSPARENCY_INSPECTION_POLICY.version,
    inspection: {
      byteHashVerified: true as const,
      byteLength: inspected.byteLength,
      ...(inspected.width == null ? {} : { width: inspected.width }),
      ...(inspected.height == null ? {} : { height: inspected.height }),
      transparencyState: inspected.transparencyState,
      ...(inspected.transparentPixelRatio == null
        ? {}
        : { transparentPixelRatio: inspected.transparentPixelRatio }),
      ...(inspected.boundaryTransparentPixelRatio == null
        ? {}
        : { boundaryTransparentPixelRatio: inspected.boundaryTransparentPixelRatio }),
      ...(inspected.reason == null ? {} : { reason: inspected.reason }),
    },
    outcome,
  };
  return ProductBackgroundSuitabilityAuthoritySchema.parse({
    ...body,
    fingerprint: sha256CanonicalIntegrityHash({
      kind: AI_STORY_PRODUCT_BACKGROUND_SUITABILITY_CONTRACT_VERSION,
      authority: body,
    }),
  });
}

export function verifyProductBackgroundSuitabilityAuthority(
  authority: ProductBackgroundSuitabilityAuthority
): boolean {
  const parsed = ProductBackgroundSuitabilityAuthoritySchema.safeParse(authority);
  if (!parsed.success) return false;
  const { fingerprint, ...body } = parsed.data;
  return (
    fingerprint ===
    sha256CanonicalIntegrityHash({
      kind: AI_STORY_PRODUCT_BACKGROUND_SUITABILITY_CONTRACT_VERSION,
      authority: body,
    })
  );
}
