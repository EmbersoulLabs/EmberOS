import { z } from "zod";
import { SourceAssetContentHashSchema } from "./source-asset-content-hash";

/**
 * Planning-only compatibility projection of accepted Story Product authority.
 * The canonical source Asset ID and content hash remain the authority.
 */
export const PlanningProductAuthorityProjectionSchema = z
  .object({
    productAuthorityId: z.string().uuid(),
    sourceAssetId: z.string().uuid(),
    sourceAssetContentHash: SourceAssetContentHashSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.productAuthorityId !== value.sourceAssetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "V1 Product authority ID must equal its canonical source Asset ID",
      });
    }
  });

export type PlanningProductAuthorityProjection = z.infer<
  typeof PlanningProductAuthorityProjectionSchema
>;
