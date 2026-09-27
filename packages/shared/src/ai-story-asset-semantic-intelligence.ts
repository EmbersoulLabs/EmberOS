import { z } from "zod";
import {
  AiStoryAssetAnalysisSnapshotSchema,
  AiStoryAssetRegistryEntrySchema,
} from "./ai-story-asset-aware-execution-planner";

export const AI_STORY_VISUAL_SEMANTIC_SCHEMA_VERSION =
  "ai-story-asset-visual-semantics.v1" as const;
export const AI_STORY_ASSET_GROUNDING_CONTEXT_VERSION =
  "ai-story-asset-grounding-context.v1" as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const EvidenceText = z.string().trim().min(1).max(500);

export const AiStoryVisualSemanticCategorySchema = z.enum([
  "MENU_OR_CATALOG",
  "PRODUCT",
  "PACKAGING",
  "ADDON_OR_COMPONENT",
  "PERSON_OR_CHARACTER",
  "ENVIRONMENT_OR_LOCATION",
  "BRAND_OR_LOGO",
  "DOCUMENT_OR_SCREENSHOT",
  "OTHER",
]);

export const AiStoryVisualProductCandidateSchema = z
  .object({
    name: EvidenceText,
    relationship: z.enum([
      "PRIMARY_PRODUCT",
      "ADDON_OR_COMPONENT",
      "CATALOG_CHOICE",
      "UNSPECIFIED_PRODUCT",
    ]),
    confidence: z.number().min(0).max(1),
    evidence: z.array(EvidenceText).min(1),
  })
  .strict();

/**
 * Provider-neutral semantic payload. Observations are limited to directly
 * visible evidence; classifications remain explicitly inferred.
 */
export const AiStoryVisualSemanticFactsSchema = z
  .object({
    contractVersion: z.literal(AI_STORY_VISUAL_SEMANTIC_SCHEMA_VERSION),
    observed: z
      .object({
        visibleText: z.array(EvidenceText).default([]),
        namedItems: z.array(EvidenceText).default([]),
        objects: z.array(EvidenceText).default([]),
        people: z.array(EvidenceText).default([]),
        environmentCues: z.array(EvidenceText).default([]),
        brandOrLogoCues: z.array(EvidenceText).default([]),
      })
      .strict(),
    inferred: z
      .object({
        categories: z.array(AiStoryVisualSemanticCategorySchema).default([]),
        productCandidates: z.array(AiStoryVisualProductCandidateSchema).default([]),
        productGroundingSupported: z.boolean(),
        characterGroundingSupported: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const AiStoryStoryAssetGroundingEntrySchema = z
  .object({
    assetId: Id,
    contentHash: Hash,
    analysisSnapshotId: Id,
    explicitRoleHint: z.enum(["PRODUCT_SOURCE", "REFERENCE"]).nullable(),
    observed: AiStoryVisualSemanticFactsSchema.shape.observed,
    inferred: AiStoryVisualSemanticFactsSchema.shape.inferred,
  })
  .strict();

export const AiStoryStoryAssetGroundingContextSchema = z
  .object({
    contractVersion: z.literal(AI_STORY_ASSET_GROUNDING_CONTEXT_VERSION),
    orgId: Id,
    workspaceId: Id,
    assets: z.array(AiStoryStoryAssetGroundingEntrySchema).min(1),
    groundedNamedItems: z.array(EvidenceText),
  })
  .strict();

export type AiStoryVisualSemanticFacts = z.infer<
  typeof AiStoryVisualSemanticFactsSchema
>;
export type AiStoryStoryAssetGroundingContext = z.infer<
  typeof AiStoryStoryAssetGroundingContextSchema
>;

export class AiStoryAssetGroundingError extends Error {
  constructor(
    readonly code:
      | "ASSET_SEMANTIC_SNAPSHOT_REQUIRED"
      | "ASSET_SEMANTIC_SNAPSHOT_INVALID"
      | "ASSET_GROUNDING_SCOPE_MISMATCH",
    message: string
  ) {
    super(message);
    this.name = "AiStoryAssetGroundingError";
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

export function visualSemanticFactsFromSnapshot(
  snapshot: z.infer<typeof AiStoryAssetAnalysisSnapshotSchema>
): AiStoryVisualSemanticFacts {
  const facts = snapshot.analysis.facts.visualSemantics;
  const parsed = AiStoryVisualSemanticFactsSchema.safeParse(facts);
  if (!parsed.success) {
    throw new AiStoryAssetGroundingError(
      "ASSET_SEMANTIC_SNAPSHOT_INVALID",
      `Asset semantic Snapshot ${snapshot.snapshotId} has no valid visual semantic authority`
    );
  }
  return parsed.data;
}

/** Deterministic pre-Story projection; performs no inference and no raw-byte read. */
export function compileStoryAssetGroundingContext(input: {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly assets: readonly {
    readonly registry: z.infer<typeof AiStoryAssetRegistryEntrySchema>;
    readonly snapshot: z.infer<typeof AiStoryAssetAnalysisSnapshotSchema>;
    readonly explicitRoleHint?: "PRODUCT_SOURCE" | "REFERENCE" | null;
  }[];
}): AiStoryStoryAssetGroundingContext {
  if (input.assets.length === 0) {
    throw new AiStoryAssetGroundingError(
      "ASSET_SEMANTIC_SNAPSHOT_REQUIRED",
      "Selected Story Assets require semantic analysis before Story generation"
    );
  }
  const assets = input.assets.map(({ registry, snapshot, explicitRoleHint }) => {
    if (
      registry.orgId !== input.orgId ||
      snapshot.orgId !== input.orgId ||
      registry.workspaceId !== input.workspaceId ||
      snapshot.workspaceId !== input.workspaceId
    ) {
      throw new AiStoryAssetGroundingError(
        "ASSET_GROUNDING_SCOPE_MISMATCH",
        "Story grounding Asset and Snapshot must belong to the authorized Workspace"
      );
    }
    if (
      // A content-addressed Snapshot may have been first materialized by a
      // different Asset row with identical bytes in the same Workspace.
      registry.contentHash !== snapshot.analyzedContentHash ||
      !snapshot.analysis.usable
    ) {
      throw new AiStoryAssetGroundingError(
        "ASSET_SEMANTIC_SNAPSHOT_REQUIRED",
        "Story grounding requires usable semantic analysis for the exact Asset bytes"
      );
    }
    const semantics = visualSemanticFactsFromSnapshot(snapshot);
    return {
      assetId: registry.assetId,
      contentHash: registry.contentHash,
      analysisSnapshotId: snapshot.snapshotId,
      explicitRoleHint: explicitRoleHint ?? null,
      observed: semantics.observed,
      inferred: semantics.inferred,
    };
  });
  return AiStoryStoryAssetGroundingContextSchema.parse({
    contractVersion: AI_STORY_ASSET_GROUNDING_CONTEXT_VERSION,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    assets,
    groundedNamedItems: uniqueSorted(
      assets.flatMap((asset) => [
        ...asset.observed.namedItems,
        ...asset.inferred.productCandidates.map((candidate) => candidate.name),
      ])
    ),
  });
}
