import { z } from "zod";
import type { AiStorySceneCompiledInstructions } from "@ceo-agent/shared";

export const PRODUCT_GROUNDED_VIDEO_MODE = "PRODUCT_GROUNDED_VIDEO" as const;
export const CREATIVE_T2V_MODE = "CREATIVE_T2V" as const;
export const PRIMARY_PRODUCT_REFERENCE_ROLE = "PRIMARY_PRODUCT" as const;

export const PRODUCT_LOCK_PROMPT = [
  "PRODUCT LOCK:",
  "Use Image 1 as the canonical Campaign Product Asset and primary product identity authority.",
  "Preserve the same exact product, wrapping or container, major composition, dominant colors, and every hero element.",
  "Do not add a gift box, remove wrapping, replace flowers or the product, redesign, morph, or reveal invented product structure.",
].join(" ");

export const ProductAuthorityConflictDimensionSchema = z.enum([
  "PRODUCT_CLASS",
  "MAJOR_ARRANGEMENT_STRUCTURE",
  "CONTAINER_OR_WRAPPING",
  "MAJOR_COLOR_COMPOSITION",
  "HERO_OBJECT_IDENTITY",
]);
export type ProductAuthorityConflictDimension = z.infer<
  typeof ProductAuthorityConflictDimensionSchema
>;

export const ProductGroundedProviderModeSchema = z.enum([
  "GENERIC_REFERENCE_T2V",
  "REFERENCE_IMAGE_T2V",
  "FIRST_FRAME_I2V",
  "FIRST_LAST_FRAME_I2V",
  "PROVIDER_GROUNDED_VIDEO",
]);
export type ProductGroundedProviderMode = z.infer<
  typeof ProductGroundedProviderModeSchema
>;

export const ProductAuthorityOperatorDecisionSchema = z.enum([
  "KEEP_CAMPAIGN_PRODUCT_ASSET_AS_CANONICAL",
  "REPLACE_CANONICAL_PRODUCT_ASSET_WITH_APPROVED_NEW_ASSET",
]);
export type ProductAuthorityOperatorDecision = z.infer<
  typeof ProductAuthorityOperatorDecisionSchema
>;

export const ProductGroundingContractSchema = z.object({
  contractVersion: z.literal("1"),
  generationMode: z.literal(PRODUCT_GROUNDED_VIDEO_MODE),
  primaryAuthority: z.object({
    kind: z.literal("CAMPAIGN_PRODUCT_ASSET"),
    assetId: z.string().uuid(),
    referenceRole: z.literal(PRIMARY_PRODUCT_REFERENCE_ROLE),
  }),
  secondaryAuthority: z
    .object({
      kind: z.literal("APPROVED_PREVIOUS_SCENE_MEDIA"),
      sceneId: z.string().min(1),
      mayOverrideProductIdentity: z.literal(false),
    })
    .optional(),
  authorityStatus: z.enum(["RESOLVED", "CONFLICT", "UNCERTIFIED"]),
  conflictDimensions: z.array(ProductAuthorityConflictDimensionSchema),
  operatorResolutionDecision: ProductAuthorityOperatorDecisionSchema.optional(),
  providerMode: ProductGroundedProviderModeSchema,
  providerModeCertified: z.boolean(),
  directorCameraPolicy: z.object({
    compatible: z.boolean(),
    cameraMoves: z.array(z.string().min(1)),
    violations: z.array(z.string().min(1)),
  }),
}).superRefine((value, ctx) => {
  if (value.authorityStatus === "CONFLICT" && value.conflictDimensions.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["conflictDimensions"],
      message: "A product authority conflict must identify at least one dimension",
    });
  }
  if (
    value.authorityStatus === "RESOLVED" &&
    value.conflictDimensions.length > 0 &&
    !value.operatorResolutionDecision
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["operatorResolutionDecision"],
      message: "Resolving a detected conflict requires an explicit operator decision",
    });
  }
});
export type ProductGroundingContract = z.infer<
  typeof ProductGroundingContractSchema
>;

export type ProductAuthorityAssessment = {
  readonly status: "RESOLVED" | "CONFLICT" | "UNCERTIFIED";
  readonly conflictDimensions?: readonly ProductAuthorityConflictDimension[];
  readonly operatorResolutionDecision?: ProductAuthorityOperatorDecision;
};

export type ProductGroundingGateResult = {
  readonly status: "ALLOWED" | "BLOCKED_PRE_DISPATCH";
  readonly blockers: readonly string[];
};

const FORBIDDEN_CAMERA_PATTERNS: readonly [RegExp, string][] = [
  [/\b(?:180|360)(?:-degree|\s*degree|°)?\b/i, "FULL_ORBIT_OR_REVERSAL"],
  [/\b(?:orbit|circle|circle-around|around the product)\b/i, "ORBIT_AROUND_PRODUCT"],
  [/\b(?:backside|back side|rear reveal|unseen)\b/i, "UNSEEN_GEOMETRY_REVEAL"],
  [/\b(?:morph|transform|reshape)\b/i, "PRODUCT_TRANSFORMATION"],
  [/\bdramatic (?:perspective|angle)\b/i, "DRAMATIC_PERSPECTIVE_CHANGE"],
];

const SAFE_CAMERA_PATTERN =
  /\b(?:static|locked|slow push|push[- ]?in|slow pull|pull[- ]?back|minor lateral|lateral dolly|small arc|10(?:–|-)20|close[- ]?up|rack focus|gentle parallax|subtle pan|no movement)\b/i;

export function evaluateProductGroundedCameraPolicy(
  instructions: Pick<AiStorySceneCompiledInstructions, "shots">
): ProductGroundingContract["directorCameraPolicy"] {
  const cameraMoves = instructions.shots.map((shot) =>
    `${shot.cameraType}: ${shot.cameraMovement}`.trim()
  );
  const violations: string[] = [];
  for (const move of cameraMoves) {
    for (const [pattern, violation] of FORBIDDEN_CAMERA_PATTERNS) {
      if (pattern.test(move)) violations.push(`${violation}:${move}`);
    }
    if (!SAFE_CAMERA_PATTERN.test(move)) {
      violations.push(`UNCERTIFIED_PRODUCT_CAMERA_MOVE:${move}`);
    }
  }
  return {
    compatible: violations.length === 0,
    cameraMoves,
    violations: [...new Set(violations)],
  };
}

export function buildProductGroundingContract(input: {
  readonly productAssetId: string;
  readonly instructions: Pick<AiStorySceneCompiledInstructions, "shots">;
  readonly continuityFromSceneId?: string;
  readonly authorityAssessment?: ProductAuthorityAssessment;
  readonly providerMode?: ProductGroundedProviderMode;
  readonly providerModeCertified?: boolean;
}): ProductGroundingContract {
  const authorityAssessment = input.authorityAssessment ?? {
    status: input.continuityFromSceneId ? "UNCERTIFIED" : "RESOLVED",
    conflictDimensions: [],
  };
  return ProductGroundingContractSchema.parse({
    contractVersion: "1",
    generationMode: PRODUCT_GROUNDED_VIDEO_MODE,
    primaryAuthority: {
      kind: "CAMPAIGN_PRODUCT_ASSET",
      assetId: input.productAssetId,
      referenceRole: PRIMARY_PRODUCT_REFERENCE_ROLE,
    },
    ...(input.continuityFromSceneId
      ? {
          secondaryAuthority: {
            kind: "APPROVED_PREVIOUS_SCENE_MEDIA",
            sceneId: input.continuityFromSceneId,
            mayOverrideProductIdentity: false,
          },
        }
      : {}),
    authorityStatus: authorityAssessment.status,
    conflictDimensions: authorityAssessment.conflictDimensions ?? [],
    ...(authorityAssessment.operatorResolutionDecision
      ? {
          operatorResolutionDecision:
            authorityAssessment.operatorResolutionDecision,
        }
      : {}),
    providerMode: input.providerMode ?? "GENERIC_REFERENCE_T2V",
    providerModeCertified: input.providerModeCertified ?? false,
    directorCameraPolicy: evaluateProductGroundedCameraPolicy(input.instructions),
  });
}

export function evaluateProductGroundingPreDispatch(input: {
  readonly grounding: ProductGroundingContract;
  readonly prompt: string;
  readonly assetReferences: readonly {
    readonly assetId: string;
    readonly role: string;
  }[];
}): ProductGroundingGateResult {
  const blockers: string[] = [];
  const grounding = ProductGroundingContractSchema.parse(input.grounding);
  const primaryReferences = input.assetReferences.filter(
    (reference) =>
      reference.role === PRIMARY_PRODUCT_REFERENCE_ROLE &&
      reference.assetId === grounding.primaryAuthority.assetId
  );

  if (grounding.authorityStatus !== "RESOLVED") {
    blockers.push(
      grounding.authorityStatus === "CONFLICT"
        ? "PRODUCT_VISUAL_AUTHORITY_CONFLICT"
        : "PRODUCT_VISUAL_AUTHORITY_UNCERTIFIED"
    );
  }
  if (primaryReferences.length !== 1) {
    blockers.push("CANONICAL_PRODUCT_REFERENCE_INVALID");
  }
  if (!/\bImage 1\s*=\s*the canonical Campaign Product Asset\b/i.test(input.prompt)) {
    blockers.push("EXPLICIT_IMAGE_1_BINDING_MISSING");
  }
  if (!grounding.providerModeCertified) {
    blockers.push("PRODUCT_GROUNDED_PROVIDER_MODE_UNCERTIFIED");
  }
  if (
    grounding.providerMode === "GENERIC_REFERENCE_T2V" ||
    grounding.providerMode === "REFERENCE_IMAGE_T2V"
  ) {
    blockers.push("GENERIC_REFERENCE_T2V_INSUFFICIENT");
  }
  if (!grounding.directorCameraPolicy.compatible) {
    blockers.push("DIRECTOR_CAMERA_INCOMPATIBLE_WITH_PRODUCT_LOCK");
  }
  if (!input.prompt.includes(PRODUCT_LOCK_PROMPT)) {
    blockers.push("PRODUCT_LOCK_PROMPT_MISSING");
  }

  return {
    status: blockers.length === 0 ? "ALLOWED" : "BLOCKED_PRE_DISPATCH",
    blockers,
  };
}

export class ProductGroundingGateError extends Error {
  readonly code = "PRODUCT_GROUNDING_BLOCKED_PRE_DISPATCH";
  readonly status = 400;
  readonly blockers: readonly string[];

  constructor(blockers: readonly string[]) {
    super(`Product-grounded Provider dispatch blocked: ${blockers.join(", ")}`);
    this.name = "ProductGroundingGateError";
    this.blockers = [...blockers];
  }
}

export function assertProductGroundingPreDispatch(input: {
  readonly grounding: ProductGroundingContract;
  readonly prompt: string;
  readonly assetReferences: readonly {
    readonly assetId: string;
    readonly role: string;
  }[];
}): ProductGroundingGateResult {
  const result = evaluateProductGroundingPreDispatch(input);
  if (result.status !== "ALLOWED") {
    throw new ProductGroundingGateError(result.blockers);
  }
  return result;
}
