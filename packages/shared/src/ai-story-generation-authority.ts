import { z } from "zod";

export const AI_STORY_SCENE_GENERATION_STRATEGIES = [
  "TEXT_TO_VIDEO",
  "FIRST_FRAME_IMAGE_TO_VIDEO",
  "PRODUCT_GROUNDED_VIDEO",
] as const;

export const AI_STORY_SCENE_REFERENCE_SOURCES = [
  "SCENE_EXPLICIT",
  "STORY_INHERITED",
  "REFERENCE_FREE_T2V",
] as const;

const AssetId = z.string().uuid();

/**
 * Versioned planning authority. Absence is the backward-compatible equivalent
 * of STORY_INHERITED + PRODUCT_GROUNDED_VIDEO.
 */
export const AiStorySceneGenerationAuthoritySchema = z.union([
    z.object({
      strategy: z.literal("TEXT_TO_VIDEO"),
      referenceSource: z.literal("REFERENCE_FREE_T2V"),
      referenceAssetIds: z.array(AssetId).length(0).default([]),
      firstFrameAssetId: z.null().default(null),
      productVisualIdentityRequirement: z.enum(["NONE", "REQUIRED"]).default("NONE"),
    }).strict(),
    z.object({
      strategy: z.enum(["FIRST_FRAME_IMAGE_TO_VIDEO", "PRODUCT_GROUNDED_VIDEO"]),
      referenceSource: z.literal("SCENE_EXPLICIT"),
      referenceAssetIds: z.array(AssetId).min(1),
      firstFrameAssetId: AssetId,
      productVisualIdentityRequirement: z.literal("REQUIRED").default("REQUIRED"),
    }).strict().superRefine((value, context) => {
      if (!value.referenceAssetIds.includes(value.firstFrameAssetId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["firstFrameAssetId"],
          message: "First-frame authority must belong to the explicit Scene reference set",
        });
      }
    }),
    z.object({
      strategy: z.literal("PRODUCT_GROUNDED_VIDEO"),
      referenceSource: z.literal("STORY_INHERITED"),
      productVisualIdentityRequirement: z.literal("REQUIRED").default("REQUIRED"),
    }).strict(),
]);

/** Immutable execution-time result of resolving Scene authority. */
export const AiStoryEffectiveSceneGenerationAuthoritySchema = z.object({
  strategy: z.enum(AI_STORY_SCENE_GENERATION_STRATEGIES),
  referenceSource: z.enum(AI_STORY_SCENE_REFERENCE_SOURCES),
  effectiveReferenceIds: z.array(AssetId),
  firstFrameAssetId: AssetId.nullable(),
  productVisualIdentityRequirement: z.enum(["NONE", "REQUIRED"]),
}).strict();

export type AiStorySceneGenerationAuthority = z.infer<
  typeof AiStorySceneGenerationAuthoritySchema
>;
export type AiStoryEffectiveSceneGenerationAuthority = z.infer<
  typeof AiStoryEffectiveSceneGenerationAuthoritySchema
>;
