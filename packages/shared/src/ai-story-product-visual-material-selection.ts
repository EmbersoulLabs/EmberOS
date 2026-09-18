import { z } from "zod";
import { AI_STORY_SCENE_GENERATION_STRATEGIES, AI_STORY_SCENE_REFERENCE_SOURCES } from "./ai-story-generation-authority";
import { AI_STORY_VISUAL_IDENTITY_REQUIREMENTS } from "./ai-story-cast";
import { ProductBackgroundSuitabilityOutcomeSchema } from "./ai-story-product-background-suitability";
import { AI_STORY_EXACT_PRODUCT_DERIVATIVE_RESOLUTION_VERSION } from "./ai-story-product-derivative-resolution";
import { SourceAssetContentHashSchema } from "./source-asset-content-hash";

export const AI_STORY_PRODUCT_VISUAL_MATERIAL_SELECTION_CONTRACT_VERSION =
  "ai-story-product-visual-material-selection.v1" as const;

export const AI_STORY_PRODUCT_VISUAL_MATERIAL_SELECTIONS = [
  "NO_PRODUCT_VISUAL_INPUT",
  "SOURCE_ASSET",
  "EXTRACTED_DERIVATIVE",
  "PRODUCT_PREPARATION_REQUIRED",
  "PRODUCT_VISUAL_INPUT_UNUSABLE",
] as const;

export const ProductVisualMaterialSelectionReasonSchema = z.enum([
  "EFFECTIVE_GENERATION_REQUIRES_NO_PRODUCT_VISUAL_INPUT",
  "SCENE_PRODUCT_VISUAL_IDENTITY_NOT_REQUIRED",
  "SOURCE_TRANSPARENCY_CERTIFIED",
  "EXACT_DERIVATIVE_CERTIFIED",
  "EXACT_DERIVATIVE_NOT_FOUND_PREPARATION_REQUIRED",
  "INSPECTION_FAILED_WITHOUT_DERIVATIVE",
  "PHOTO_SCENE_PREPARATION_NOT_CERTIFIED",
]);

const Id = z.string().uuid();

const ProductAuthoritySchema = z
  .object({
    productAuthorityId: Id,
    sourceAssetId: Id,
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

const SelectedMaterialSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("SOURCE_ASSET"),
      assetId: Id,
      contentHash: SourceAssetContentHashSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("EXTRACTED_DERIVATIVE"),
      assetId: Id,
      contentHash: SourceAssetContentHashSchema,
      generationId: Id,
      generationFingerprint: SourceAssetContentHashSchema,
    })
    .strict(),
]);

export const ProductVisualMaterialSelectionAuthoritySchema = z
  .object({
    contractVersion: z.literal(
      AI_STORY_PRODUCT_VISUAL_MATERIAL_SELECTION_CONTRACT_VERSION
    ),
    orgId: Id,
    workspaceId: Id,
    campaignId: Id,
    storyId: Id,
    storyVersionId: Id,
    sceneId: Id,
    sceneVersionId: Id,
    productAuthority: ProductAuthoritySchema,
    visualRequirement: z
      .object({
        sceneRequirement: z.enum(AI_STORY_VISUAL_IDENTITY_REQUIREMENTS),
        effectiveGenerationRequirement: z.enum(["NONE", "REQUIRED"]),
        strategy: z.enum(AI_STORY_SCENE_GENERATION_STRATEGIES),
        referenceSource: z.enum(AI_STORY_SCENE_REFERENCE_SOURCES),
      })
      .strict(),
    suitability: z
      .object({
        authorityFingerprint: SourceAssetContentHashSchema,
        outcome: ProductBackgroundSuitabilityOutcomeSchema,
      })
      .strict(),
    derivativeResolution: z
      .object({
        contractVersion: z.literal(
          AI_STORY_EXACT_PRODUCT_DERIVATIVE_RESOLUTION_VERSION
        ),
        status: z.enum(["FOUND", "NOT_FOUND"]),
        reason: z
          .enum([
            "NO_READY_EXTRACTION",
            "CANDIDATE_NOT_REUSABLE",
            "OUTPUT_UNAVAILABLE",
          ])
          .optional(),
      })
      .strict(),
    preparationCapability: z.discriminatedUnion("status", [
      z.object({ status: z.literal("NOT_CERTIFIED") }).strict(),
      z
        .object({
          status: z.literal("CERTIFIED"),
          extractionInputFingerprint: SourceAssetContentHashSchema,
        })
        .strict(),
    ]),
    selection: z.enum(AI_STORY_PRODUCT_VISUAL_MATERIAL_SELECTIONS),
    selectedMaterial: SelectedMaterialSchema.nullable(),
    reason: ProductVisualMaterialSelectionReasonSchema,
    fingerprint: SourceAssetContentHashSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const selected = value.selectedMaterial;
    if (value.selection === "SOURCE_ASSET") {
      if (
        selected?.kind !== "SOURCE_ASSET" ||
        selected.assetId !== value.productAuthority.sourceAssetId ||
        selected.contentHash !== value.productAuthority.sourceAssetContentHash
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "SOURCE_ASSET selection must retain the canonical Product source",
        });
      }
    } else if (value.selection === "EXTRACTED_DERIVATIVE") {
      if (selected?.kind !== "EXTRACTED_DERIVATIVE") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "EXTRACTED_DERIVATIVE selection requires certified derivative material",
        });
      }
    } else if (selected !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Non-material selection states cannot carry selected material",
      });
    }
    if (
      value.derivativeResolution.status === "FOUND" &&
      value.derivativeResolution.reason !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "FOUND derivative evidence cannot carry a non-reuse reason",
      });
    }
    if (
      value.derivativeResolution.status === "NOT_FOUND" &&
      value.derivativeResolution.reason === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "NOT_FOUND derivative evidence must preserve its exact reason",
      });
    }
    const expected =
      value.visualRequirement.effectiveGenerationRequirement === "NONE"
        ? {
            selection: "NO_PRODUCT_VISUAL_INPUT" as const,
            reason: "EFFECTIVE_GENERATION_REQUIRES_NO_PRODUCT_VISUAL_INPUT" as const,
          }
        : value.visualRequirement.sceneRequirement === "NONE"
          ? {
              selection: "NO_PRODUCT_VISUAL_INPUT" as const,
              reason: "SCENE_PRODUCT_VISUAL_IDENTITY_NOT_REQUIRED" as const,
            }
          : value.suitability.outcome === "TRANSPARENT_BACKGROUND_CERTIFIED"
            ? {
                selection: "SOURCE_ASSET" as const,
                reason: "SOURCE_TRANSPARENCY_CERTIFIED" as const,
              }
          : value.derivativeResolution.status === "FOUND"
            ? {
                selection: "EXTRACTED_DERIVATIVE" as const,
                reason: "EXACT_DERIVATIVE_CERTIFIED" as const,
              }
            : value.suitability.outcome === "INSPECTION_FAILED"
              ? {
                  selection: "PRODUCT_VISUAL_INPUT_UNUSABLE" as const,
                  reason: "INSPECTION_FAILED_WITHOUT_DERIVATIVE" as const,
                }
              : value.preparationCapability.status === "CERTIFIED"
                ? {
                    selection: "PRODUCT_PREPARATION_REQUIRED" as const,
                    reason: "EXACT_DERIVATIVE_NOT_FOUND_PREPARATION_REQUIRED" as const,
                  }
                : {
                    selection: "PRODUCT_VISUAL_INPUT_UNUSABLE" as const,
                    reason: "PHOTO_SCENE_PREPARATION_NOT_CERTIFIED" as const,
                  };
    if (value.selection !== expected.selection || value.reason !== expected.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Selection and reason do not match the deterministic V1 decision policy",
      });
    }
  });

export type ProductVisualMaterialSelection =
  (typeof AI_STORY_PRODUCT_VISUAL_MATERIAL_SELECTIONS)[number];
export type ProductVisualMaterialSelectionAuthority = z.infer<
  typeof ProductVisualMaterialSelectionAuthoritySchema
>;
