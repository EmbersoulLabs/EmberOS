import { z } from "zod";
import {
  CreativeContextSchema,
  PlanningProductAuthorityProjectionSchema,
  SourceAssetContentHashSchema,
  type CreativeContext,
  type PlanningProductAuthorityProjection,
} from "@ceo-agent/shared";

const ResolvedStoryProductSourceSchema = z
  .object({
    assetId: z.string().uuid(),
    usageType: z.literal("product_source"),
    contentHash: SourceAssetContentHashSchema,
  })
  .passthrough();

export type StoryProductSourceAuthorityForPlanning = {
  assetId: string;
  usageType: "product_source";
  contentHash: string;
};

export class AiStoryPlanningProductAuthorityError extends Error {
  constructor(
    readonly code:
      | "PRODUCT_AUTHORITY_SOURCE_INVALID"
      | "PRODUCT_AUTHORITY_DUPLICATE"
      | "PRODUCT_AUTHORITY_OVERRIDE"
      | "PRODUCT_AUTHORITY_STALE",
    message: string
  ) {
    super(message);
    this.name = "AiStoryPlanningProductAuthorityError";
  }
}

function canonicalProductAuthorities(
  input: readonly PlanningProductAuthorityProjection[]
): PlanningProductAuthorityProjection[] {
  const parsed = input
    .map((item) => PlanningProductAuthorityProjectionSchema.parse(item))
    .sort((left, right) =>
      left.productAuthorityId.localeCompare(right.productAuthorityId)
    );
  if (new Set(parsed.map((item) => item.productAuthorityId)).size !== parsed.length) {
    throw new AiStoryPlanningProductAuthorityError(
      "PRODUCT_AUTHORITY_DUPLICATE",
      "Planning Product authority contains a duplicate canonical Asset ID"
    );
  }
  return parsed;
}

function sameAuthorities(
  left: readonly PlanningProductAuthorityProjection[],
  right: readonly PlanningProductAuthorityProjection[]
): boolean {
  return JSON.stringify(canonicalProductAuthorities(left)) ===
    JSON.stringify(canonicalProductAuthorities(right));
}

/** Exact V1 mapping from persisted Story product_source rows into Planning. */
export function projectStoryProductSourcesToPlanning(
  sources: readonly StoryProductSourceAuthorityForPlanning[]
): PlanningProductAuthorityProjection[] {
  try {
    return canonicalProductAuthorities(
      sources.map((raw) => {
        const source = ResolvedStoryProductSourceSchema.parse(raw);
        return PlanningProductAuthorityProjectionSchema.parse({
          productAuthorityId: source.assetId,
          sourceAssetId: source.assetId,
          sourceAssetContentHash: source.contentHash,
        });
      })
    );
  } catch (error) {
    if (error instanceof AiStoryPlanningProductAuthorityError) throw error;
    throw new AiStoryPlanningProductAuthorityError(
      "PRODUCT_AUTHORITY_SOURCE_INVALID",
      `Story Product source cannot enter Planning authority: ${
        error instanceof Error ? error.message : "invalid canonical source"
      }`
    );
  }
}

/**
 * The LLM may describe narrative use, but it cannot add, remove, or rewrite the
 * server-owned Product authority projection.
 */
export function bindCreativeContextToProductAuthority(input: {
  creativeContext: CreativeContext;
  productAuthorities: readonly PlanningProductAuthorityProjection[];
}): CreativeContext {
  const creativeContext = CreativeContextSchema.parse(input.creativeContext);
  const authoritative = canonicalProductAuthorities(input.productAuthorities);
  if (
    creativeContext.productAuthorities.length > 0 &&
    !sameAuthorities(creativeContext.productAuthorities, authoritative)
  ) {
    throw new AiStoryPlanningProductAuthorityError(
      "PRODUCT_AUTHORITY_OVERRIDE",
      "Planning output attempted to replace exact server-owned Product authority"
    );
  }
  return CreativeContextSchema.parse({
    ...creativeContext,
    productAuthorities: authoritative,
  });
}

/** Persisted Planning may continue only while its complete Product set is current. */
export function assertPlanningProductAuthorityCurrent(input: {
  creativeContext: CreativeContext;
  productAuthorities: readonly PlanningProductAuthorityProjection[];
}): void {
  const creativeContext = CreativeContextSchema.parse(input.creativeContext);
  if (!sameAuthorities(creativeContext.productAuthorities, input.productAuthorities)) {
    throw new AiStoryPlanningProductAuthorityError(
      "PRODUCT_AUTHORITY_STALE",
      "Persisted Planning Product authority is stale; regenerate Creative Context from current Story Product sources"
    );
  }
}

export function planningProductAuthorityPrompt(
  productAuthorities: readonly PlanningProductAuthorityProjection[]
): string {
  const authoritative = canonicalProductAuthorities(productAuthorities);
  if (authoritative.length === 0) {
    return "No accepted Story Product source authority is currently available.";
  }
  return [
    "ACCEPTED STORY PRODUCT AUTHORITY (exact IDs and content hashes are immutable):",
    JSON.stringify(authoritative, null, 2),
    "Use a Product only by exact productAuthorityId. You may decide narrative role, presence, interaction, evidence intent, and story significance. Never redefine Product identity from a label, filename, prose description, generic prop, or visual guess. Product availability does not require visual conditioning or select a generation mode.",
  ].join("\n");
}
