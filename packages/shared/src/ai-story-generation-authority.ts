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
  "CHARACTER_SYNTHETIC_ANCHOR",
] as const;

const AssetId = z.string().uuid();

/** Historical readers may omit this authority; current execution must not infer it. */
export const AiStorySceneGenerationAuthoritySchema = z.union([
    z.object({
      strategy: z.literal("TEXT_TO_VIDEO"),
      referenceSource: z.literal("REFERENCE_FREE_T2V"),
      referenceAssetIds: z.array(AssetId).length(0).default([]),
      firstFrameAssetId: z.null().default(null),
      productVisualIdentityRequirement: z.enum(["NONE", "REQUIRED"]).default("NONE"),
    }).strict(),
    z.object({
      strategy: z.literal("TEXT_TO_VIDEO"),
      referenceSource: z.literal("CHARACTER_SYNTHETIC_ANCHOR"),
      referenceAssetIds: z.array(AssetId).length(1),
      firstFrameAssetId: z.null().default(null),
      productVisualIdentityRequirement: z.literal("NONE").default("NONE"),
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

export class AiStorySceneGenerationModeAuthorityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStorySceneGenerationModeAuthorityError";
  }
}

/** Current-write gate. Historical snapshots remain parseable without a mode. */
export function assertExplicitAiStorySceneGenerationMode(input: {
  generationAuthority?: AiStorySceneGenerationAuthority;
  productBindings: readonly { sourceAssetId: string }[];
}): AiStorySceneGenerationAuthority {
  const authority = input.generationAuthority;
  if (!authority) {
    throw new AiStorySceneGenerationModeAuthorityError(
      "CANONICAL_SCENE_GENERATION_MODE_AUTHORITY_MISSING",
      "Current Canonical Scene authority requires an explicit generation mode",
    );
  }
  if (authority.referenceSource === "STORY_INHERITED") {
    throw new AiStorySceneGenerationModeAuthorityError(
      "CANONICAL_SCENE_GENERATION_MODE_AUTHORITY_UNRESOLVED",
      "Inherited Story references do not identify an exact Scene first-frame material",
    );
  }
  if (authority.referenceSource === "SCENE_EXPLICIT" && (
    input.productBindings.length !== 1 ||
    authority.firstFrameAssetId !== input.productBindings[0]!.sourceAssetId
  )) {
    throw new AiStorySceneGenerationModeAuthorityError(
      "CANONICAL_SCENE_GENERATION_MODE_MATERIAL_MISMATCH",
      "Image-conditioned mode must name the exact current Scene Product source Asset",
    );
  }
  return authority;
}

/** Resolves only an explicit Scene decision; Story/Provider inventory is never a mode selector. */
export function resolveExplicitAiStorySceneGenerationAuthority(
  authority: AiStorySceneGenerationAuthority | undefined,
): AiStoryEffectiveSceneGenerationAuthority {
  if (!authority || authority.referenceSource === "STORY_INHERITED") {
    throw new AiStorySceneGenerationModeAuthorityError(
      "CANONICAL_SCENE_GENERATION_MODE_AUTHORITY_MISSING",
      "An exact explicit Scene generation decision is required",
    );
  }
  if (authority.referenceSource === "REFERENCE_FREE_T2V") {
    return {
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "REFERENCE_FREE_T2V",
      effectiveReferenceIds: [],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: authority.productVisualIdentityRequirement,
    };
  }
  if (authority.referenceSource === "CHARACTER_SYNTHETIC_ANCHOR") {
    return {
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "CHARACTER_SYNTHETIC_ANCHOR",
      effectiveReferenceIds: [...authority.referenceAssetIds],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE",
    };
  }
  return {
    strategy: authority.strategy,
    referenceSource: "SCENE_EXPLICIT",
    effectiveReferenceIds: [
      authority.firstFrameAssetId,
      ...[...new Set(authority.referenceAssetIds.filter((id) => id !== authority.firstFrameAssetId))].sort(),
    ],
    firstFrameAssetId: authority.firstFrameAssetId,
    productVisualIdentityRequirement: "REQUIRED",
  };
}
