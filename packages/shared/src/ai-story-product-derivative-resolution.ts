import { z } from "zod";
import { SourceAssetContentHashSchema } from "./source-asset-content-hash";

export const AI_STORY_EXACT_PRODUCT_DERIVATIVE_RESOLUTION_VERSION =
  "ai-story-exact-product-derivative-resolution.v1" as const;

const ExactProductDerivativeResolutionBaseSchema = z
  .object({
    contractVersion: z.literal(
      AI_STORY_EXACT_PRODUCT_DERIVATIVE_RESOLUTION_VERSION
    ),
    productAuthorityId: z.string().uuid(),
    sourceAssetId: z.string().uuid(),
    sourceAssetContentHash: SourceAssetContentHashSchema,
  })
  .strict();

export const ExactProductDerivativeResolutionSchema = z
  .discriminatedUnion("status", [
    ExactProductDerivativeResolutionBaseSchema.extend({
      status: z.literal("FOUND"),
      derivative: z
        .object({
          assetId: z.string().uuid(),
          contentHash: SourceAssetContentHashSchema,
          generationId: z.string().uuid(),
          generationFingerprint: SourceAssetContentHashSchema,
          operation: z.literal("product_extraction"),
        })
        .strict(),
    }).strict(),
    ExactProductDerivativeResolutionBaseSchema.extend({
      status: z.literal("NOT_FOUND"),
      reason: z.enum([
        "NO_READY_EXTRACTION",
        "CANDIDATE_NOT_REUSABLE",
        "OUTPUT_UNAVAILABLE",
      ]),
    }).strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.productAuthorityId !== value.sourceAssetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "V1 Product authority ID must equal its canonical source Asset ID",
      });
    }
  });

export type ExactProductDerivativeResolution = z.infer<
  typeof ExactProductDerivativeResolutionSchema
>;
