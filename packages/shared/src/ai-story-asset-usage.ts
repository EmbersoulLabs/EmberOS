import { z } from "zod";

export const AI_STORY_ASSET_USAGE_TYPES = [
  "reference",
  "product_source",
] as const;

export const AiStoryAssetUsageTypeSchema = z.enum(AI_STORY_ASSET_USAGE_TYPES);
export type AiStoryAssetUsageType = z.infer<typeof AiStoryAssetUsageTypeSchema>;

const UniqueAssetIdsSchema = z
  .array(z.string().uuid())
  .max(32)
  .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Asset IDs must be unique",
      });
    }
  });

/** Explicit Story selection; no filename, label, media, or metadata inference is authority. */
export const AiStoryAssetSelectionSchema = z
  .object({
    assetIds: UniqueAssetIdsSchema.default([]),
    productAssetIds: UniqueAssetIdsSchema.default([]),
  })
  .superRefine((value, ctx) => {
    const selected = new Set(value.assetIds);
    for (const productAssetId of value.productAssetIds) {
      if (!selected.has(productAssetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["productAssetIds"],
          message: `Product Asset ${productAssetId} must also be selected for the Story`,
        });
      }
    }
  });

export type AiStoryAssetSelection = z.infer<typeof AiStoryAssetSelectionSchema>;

export const AiStoryAssetLinkUsagePlanSchema = z.object({
  assetId: z.string().uuid(),
  usageType: AiStoryAssetUsageTypeSchema,
}).strict();

export type AiStoryAssetLinkUsagePlan = z.infer<
  typeof AiStoryAssetLinkUsagePlanSchema
>;

/** Deterministic one-row-per-Asset persistence plan. product_source implies reference availability. */
export function planAiStoryAssetLinkUsage(
  input: AiStoryAssetSelection
): AiStoryAssetLinkUsagePlan[] {
  const selection = AiStoryAssetSelectionSchema.parse(input);
  const products = new Set(selection.productAssetIds);
  return [...selection.assetIds]
    .sort((left, right) => left.localeCompare(right))
    .map((assetId) =>
      AiStoryAssetLinkUsagePlanSchema.parse({
        assetId,
        usageType: products.has(assetId) ? "product_source" : "reference",
      })
    );
}
