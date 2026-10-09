import { z } from "zod";
import {
  resolveProductVariantMapping,
  resolveProductVariantVisualGrounding,
  type AiStoryProductVariantStatus,
  type ProductVariantCandidateEvidence,
} from "./ai-story-product-variant";

export const AI_STORY_ASSET_USAGE_TYPES = [
  "reference",
  "product_source",
  "location_reference",
  "brand_reference",
  "style_reference",
  "generic_reference",
] as const;

/** Roles a new module intake may assign. Legacy rows stay stored as "reference". */
export const AI_STORY_MODULE_ASSET_ROLES = [
  "product_source",
  "location_reference",
  "brand_reference",
  "style_reference",
  "generic_reference",
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

export const AiStoryModuleAssetRoleSchema = z.enum(AI_STORY_MODULE_ASSET_ROLES);
export type AiStoryModuleAssetRole = z.infer<typeof AiStoryModuleAssetRoleSchema>;

export const AiStoryModuleAssetBindingSchema = z.object({
  assetId: z.string().uuid(),
  role: AiStoryModuleAssetRoleSchema,
}).strict();
export type AiStoryModuleAssetBinding = z.infer<typeof AiStoryModuleAssetBindingSchema>;

const ROLE_FIELDS = [
  ["productAssetIds", "product_source"],
  ["locationAssetIds", "location_reference"],
  ["brandAssetIds", "brand_reference"],
  ["styleAssetIds", "style_reference"],
  ["genericAssetIds", "generic_reference"],
] as const;

/** Explicit Story selection; no filename, label, media, or metadata inference is authority. */
export const AiStoryAssetSelectionSchema = z
  .object({
    assetIds: UniqueAssetIdsSchema.default([]),
    productAssetIds: UniqueAssetIdsSchema.default([]),
    locationAssetIds: UniqueAssetIdsSchema.default([]),
    brandAssetIds: UniqueAssetIdsSchema.default([]),
    styleAssetIds: UniqueAssetIdsSchema.default([]),
    genericAssetIds: UniqueAssetIdsSchema.default([]),
    assetBindings: z.array(AiStoryModuleAssetBindingSchema).max(32).optional(),
    characterPortraitAssetIds: UniqueAssetIdsSchema.default([]),
    productVariantSelections: z.array(z.object({
      assetId: z.string().uuid(),
      variant: z.string().trim().min(1).max(80),
    }).strict()).max(32).default([]),
    mappingConfirmed: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const selected = new Set(value.assetIds);
    const typed = [
      ...value.productAssetIds,
      ...value.locationAssetIds,
      ...value.brandAssetIds,
      ...value.styleAssetIds,
      ...value.genericAssetIds,
      ...(value.assetBindings ?? []).map((binding) => binding.assetId),
    ];
    for (const assetId of typed) {
      if (!selected.has(assetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assetIds"],
          message: `Asset ${assetId} must also be selected for the Story`,
        });
      }
    }
    const roleByAsset = new Map<string, string>();
    const claim = (assetId: string, role: string, path: string) => {
      const existing = roleByAsset.get(assetId);
      if (existing && existing !== role) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: `Asset ${assetId} cannot have both ${existing} and ${role}`,
        });
      }
      roleByAsset.set(assetId, role);
    };
    for (const [field, role] of ROLE_FIELDS) {
      for (const assetId of value[field]) claim(assetId, role, field);
    }
    for (const binding of value.assetBindings ?? []) {
      claim(binding.assetId, binding.role, "assetBindings");
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

/**
 * Read projection only. Stored legacy rows remain "reference".
 * New writes use generic_reference when the intake role is generic.
 */
export const AI_STORY_EXPLICIT_ROLE_HINTS = [
  "PRODUCT_SOURCE",
  "LOCATION_REFERENCE",
  "BRAND_REFERENCE",
  "STYLE_REFERENCE",
  "GENERIC_REFERENCE",
  "REFERENCE",
] as const;

export type AiStoryExplicitRoleHint = (typeof AI_STORY_EXPLICIT_ROLE_HINTS)[number];

/** Planning hint for one persisted usage. Legacy "reference" stays REFERENCE. */
export function explicitRoleHintForAiStoryUsage(usageType: string): AiStoryExplicitRoleHint {
  switch (usageType) {
    case "product_source":
      return "PRODUCT_SOURCE";
    case "location_reference":
      return "LOCATION_REFERENCE";
    case "brand_reference":
      return "BRAND_REFERENCE";
    case "style_reference":
      return "STYLE_REFERENCE";
    case "generic_reference":
      return "GENERIC_REFERENCE";
    default:
      return "REFERENCE";
  }
}

export function projectLegacyAiStoryAssetUsage(
  usageType: AiStoryAssetUsageType
): Exclude<AiStoryAssetUsageType, "reference"> {
  return usageType === "reference" ? "generic_reference" : usageType;
}

/**
 * Character portraits stay on Character Binding. They are removed from a
 * generic Story reference unless the same asset was explicitly given another
 * module role.
 */
export function omitCharacterPortraitGenericReferences(
  input: z.input<typeof AiStoryAssetSelectionSchema>,
  portraitAssetIds: readonly string[]
): AiStoryAssetSelection {
  const selection = AiStoryAssetSelectionSchema.parse(input);
  const portraits = new Set(portraitAssetIds);
  const explicit = new Set([
    ...selection.productAssetIds,
    ...selection.locationAssetIds,
    ...selection.brandAssetIds,
    ...selection.styleAssetIds,
  ]);
  const drop = (assetId: string) => portraits.has(assetId) && !explicit.has(assetId);
  return AiStoryAssetSelectionSchema.parse({
    ...selection,
    assetIds: selection.assetIds.filter((assetId) => !drop(assetId)),
    genericAssetIds: selection.genericAssetIds.filter((assetId) => !drop(assetId)),
    characterPortraitAssetIds: [...portraits],
    assetBindings: selection.assetBindings?.filter(
      (binding) => !(drop(binding.assetId) && binding.role === "generic_reference")
    ),
  });
}

/** Deterministic one-row-per-Asset persistence plan. Untyped legacy ids stay "reference". */
export function planAiStoryAssetLinkUsage(
  input: z.input<typeof AiStoryAssetSelectionSchema>
): AiStoryAssetLinkUsagePlan[] {
  const selection = omitCharacterPortraitGenericReferences(
    input,
    input.characterPortraitAssetIds ?? []
  );
  const roleByAsset = new Map<string, AiStoryAssetUsageType>();
  for (const assetId of selection.assetIds) roleByAsset.set(assetId, "reference");
  for (const [field, role] of ROLE_FIELDS) {
    for (const assetId of selection[field]) roleByAsset.set(assetId, role);
  }
  for (const binding of selection.assetBindings ?? []) {
    roleByAsset.set(binding.assetId, binding.role);
  }
  return [...roleByAsset.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([assetId, usageType]) =>
      AiStoryAssetLinkUsagePlanSchema.parse({ assetId, usageType })
    );
}

export type AiStoryIntakeAssetLabel = {
  assetId: string;
  label: string;
  contentHash?: string | null;
  variantCandidates?: readonly string[];
  variantCandidateEvidence?: readonly ProductVariantCandidateEvidence[];
  variantAnalysisState?: "MISSING" | "READY" | "INSUFFICIENT";
};

export type AiStoryIntakeAuthority = {
  character: {
    name: string;
    characterId: string;
    characterVersionId: string | null;
    portraitAssetId: string | null;
    identityLocked: true;
  } | null;
  products: {
    assetId: string;
    label: string;
    variant: string | null;
    variantStatus: AiStoryProductVariantStatus;
    role: "product_source";
    code?:
      | "PRODUCT_VARIANT_ANALYSIS_REQUIRED"
      | "PRODUCT_VARIANT_SELECTION_REQUIRED"
      | "PRODUCT_VARIANT_CONFLICT";
    analysisState: "MISSING" | "READY" | "INSUFFICIENT";
    sourceMultiVariant: boolean | null;
    visualGroundingStatus: "analysis_required" | "confirmed" | "user_reference_required";
    visualReferenceId: string | null;
    visualReferenceContentHash: string | null;
    visualReferenceLineage: import("./ai-story-product-variant").ProductVariantVisualGrounding["lineage"];
    visualGroundingCode?: "PRODUCT_VARIANT_ANALYSIS_REQUIRED" | "PRODUCT_VARIANT_VISUAL_REFERENCE_REQUIRED";
  }[];
  locations: { assetId: string; label: string; role: "location_reference" }[];
  other: { assetId: string; label: string; role: Exclude<AiStoryModuleAssetRole, "product_source" | "location_reference"> }[];
  offscreenSpeaker: { name: string; visualReference: false } | null;
  bindings: AiStoryAssetLinkUsagePlan[];
};

/** Preview and persistence use the same resolved selection. Unresolved variants stay null. */
export function compileAiStoryIntakeAuthority(input: {
  selection: z.input<typeof AiStoryAssetSelectionSchema>;
  assets: readonly AiStoryIntakeAssetLabel[];
  character?: {
    name: string;
    characterId: string;
    characterVersionId?: string | null;
    portraitAssetId?: string | null;
  } | null;
  offscreenSpeaker?: string | null;
  userIntent?: string | null;
}): AiStoryIntakeAuthority {
  const portraits = [
    ...(input.selection.characterPortraitAssetIds ?? []),
    ...(input.character?.portraitAssetId ? [input.character.portraitAssetId] : []),
  ];
  const selection = omitCharacterPortraitGenericReferences(input.selection, portraits);
  const labels = new Map(input.assets.map((asset) => [asset.assetId, asset]));
  const bindings = planAiStoryAssetLinkUsage(selection);
  const labelFor = (assetId: string) => labels.get(assetId)?.label ?? assetId;
  const variantFor = (assetId: string) => {
    const selected = selection.productVariantSelections.find((item) => item.assetId === assetId)?.variant;
    return resolveProductVariantMapping({
      candidates: labels.get(assetId)?.variantCandidates ?? [],
      userIntent: input.userIntent,
      selectedVariant: selected,
      confirmed: selection.mappingConfirmed === true,
    });
  };
  const productFor = (assetId: string) => {
    const asset = labels.get(assetId);
    const resolution = variantFor(assetId);
    const grounding = resolveProductVariantVisualGrounding({
      sourceAssetId: assetId,
      sourceAssetContentHash: asset?.contentHash,
      resolution,
    });
    return {
      resolution,
      grounding,
      analysisState: asset?.variantAnalysisState
        ?? (resolution.candidates.length > 0 ? "READY" as const : "MISSING" as const),
    };
  };
  return {
    character: input.character
      ? {
          name: input.character.name,
          characterId: input.character.characterId,
          characterVersionId: input.character.characterVersionId ?? null,
          portraitAssetId: input.character.portraitAssetId ?? null,
          identityLocked: true,
        }
      : null,
    products: bindings
      .filter((binding) => binding.usageType === "product_source")
      .map((binding) => {
        const product = productFor(binding.assetId);
        return {
          assetId: binding.assetId,
          label: labelFor(binding.assetId),
          variant: product.resolution.variant,
          variantStatus: product.resolution.status,
          ...(product.resolution.code ? { code: product.resolution.code } : {}),
          role: "product_source" as const,
          analysisState: product.analysisState,
          sourceMultiVariant: product.grounding.sourceMultiVariant,
          visualGroundingStatus: product.grounding.status,
          visualReferenceId: product.grounding.visualReferenceId,
          visualReferenceContentHash: product.grounding.visualReferenceContentHash,
          visualReferenceLineage: product.grounding.lineage,
          ...(product.grounding.code ? { visualGroundingCode: product.grounding.code } : {}),
        };
      }),
    locations: bindings
      .filter((binding) => binding.usageType === "location_reference")
      .map((binding) => ({
        assetId: binding.assetId,
        label: labelFor(binding.assetId),
        role: "location_reference" as const,
      })),
    other: bindings
      .filter((binding) =>
        binding.usageType === "brand_reference"
        || binding.usageType === "style_reference"
        || binding.usageType === "generic_reference"
      )
      .map((binding) => ({
        assetId: binding.assetId,
        label: labelFor(binding.assetId),
        role: binding.usageType as Exclude<AiStoryModuleAssetRole, "product_source" | "location_reference">,
      })),
    offscreenSpeaker: input.offscreenSpeaker?.trim()
      ? { name: input.offscreenSpeaker.trim(), visualReference: false }
      : null,
    bindings,
  };
}
