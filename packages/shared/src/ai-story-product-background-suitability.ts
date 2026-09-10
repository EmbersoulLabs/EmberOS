import { z } from "zod";
import { SourceAssetContentHashSchema } from "./source-asset-content-hash";

export const AI_STORY_PRODUCT_BACKGROUND_SUITABILITY_CONTRACT_VERSION =
  "ai-story-product-background-suitability.v1" as const;

export const PRODUCT_TRANSPARENCY_INSPECTION_POLICY = {
  version: "product-transparency-inspection.v1",
  maximumSourceBytes: 20 * 1024 * 1024,
  maximumDimension: 8_192,
  maximumDecodedPixels: 16_777_216,
  effectivelyTransparentAlphaMaximum: 16,
  minimumTransparentPixelCount: 16,
  minimumTransparentPixelRatio: 0.05,
  minimumBoundaryTransparentPixelRatio: 0.5,
} as const;
// V1 certification requires both useful image-wide alpha evidence and a mostly
// transparent outer perimeter. Threshold changes require a new policy version.

export const ProductBackgroundSuitabilityOutcomeSchema = z.enum([
  "TRANSPARENT_BACKGROUND_CERTIFIED",
  "OPAQUE_NOT_ISOLATED",
  "INSPECTION_UNSUPPORTED",
  "INSPECTION_FAILED",
]);

export const ProductTransparencyStateSchema = z.enum([
  "CERTIFIED_TRANSPARENT_BACKGROUND",
  "FULLY_OPAQUE",
  "INSUFFICIENT_TRANSPARENCY",
  "UNINSPECTABLE",
]);

export const ProductBackgroundSuitabilityAuthoritySchema = z
  .object({
    contractVersion: z.literal(
      AI_STORY_PRODUCT_BACKGROUND_SUITABILITY_CONTRACT_VERSION
    ),
    orgId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    campaignId: z.string().uuid(),
    productAuthorityId: z.string().uuid(),
    sourceAssetId: z.string().uuid(),
    sourceAssetContentHash: SourceAssetContentHashSchema,
    mimeType: z.string().min(1),
    inspectionVersion: z.literal(PRODUCT_TRANSPARENCY_INSPECTION_POLICY.version),
    inspection: z
      .object({
        byteHashVerified: z.literal(true),
        byteLength: z.number().int().nonnegative(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        transparencyState: ProductTransparencyStateSchema,
        transparentPixelRatio: z.number().min(0).max(1).optional(),
        boundaryTransparentPixelRatio: z.number().min(0).max(1).optional(),
        reason: z.string().min(1).optional(),
      })
      .strict(),
    outcome: ProductBackgroundSuitabilityOutcomeSchema,
    fingerprint: SourceAssetContentHashSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.productAuthorityId !== value.sourceAssetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "V1 Product authority ID must equal its canonical source Asset ID",
      });
    }
    const expectedOutcome =
      value.inspection.transparencyState === "CERTIFIED_TRANSPARENT_BACKGROUND"
        ? "TRANSPARENT_BACKGROUND_CERTIFIED"
        : value.inspection.transparencyState === "UNINSPECTABLE"
          ? value.outcome
          : "OPAQUE_NOT_ISOLATED";
    if (
      value.inspection.transparencyState === "UNINSPECTABLE"
        ? !["INSPECTION_UNSUPPORTED", "INSPECTION_FAILED"].includes(value.outcome)
        : value.outcome !== expectedOutcome
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Suitability outcome does not match deterministic inspection facts",
      });
    }
  });

export type ProductBackgroundSuitabilityOutcome = z.infer<
  typeof ProductBackgroundSuitabilityOutcomeSchema
>;
export type ProductBackgroundSuitabilityAuthority = z.infer<
  typeof ProductBackgroundSuitabilityAuthoritySchema
>;
