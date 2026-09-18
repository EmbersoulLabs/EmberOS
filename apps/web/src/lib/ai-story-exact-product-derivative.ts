import { and, eq } from "drizzle-orm";
import {
  findReusablePhotoSceneExtraction,
  getDb,
  schema,
} from "@ceo-agent/db";
import { fingerprintPhotoSceneExtractionIdentityV1 } from "@ceo-agent/shared/photo-scene-extraction.server";
import {
  AI_STORY_EXACT_PRODUCT_DERIVATIVE_RESOLUTION_VERSION,
  ExactProductDerivativeResolutionSchema,
  PHOTO_SCENE_EXTRACTION_CONTRACT,
  PHOTO_SCENE_EXTRACTION_CONTRACT_VERSION,
  PHOTO_SCENE_EXTRACTION_POLICY,
  evaluateExtractionReuse,
  type ExactProductDerivativeResolution,
  type PhotoSceneAssetSnapshot,
  type PhotoSceneExtractionInputCapsuleV1,
  type PhotoSceneGenerationSnapshot,
} from "@ceo-agent/shared";
import { resolveStoryProductSources } from "@/lib/ai-story-product-sources";

type Db = ReturnType<typeof getDb>;
type Generation = typeof schema.photoSceneGenerations.$inferSelect;
type Asset = typeof schema.assets.$inferSelect;

export class AiStoryExactProductDerivativeAuthorityError extends Error {
  readonly code = "EXACT_STORY_PRODUCT_AUTHORITY_REQUIRED" as const;

  constructor(message: string) {
    super(message);
    this.name = "AiStoryExactProductDerivativeAuthorityError";
  }
}

type OutputCandidate = {
  asset: Asset | null;
  currentCampaignAuthorized: boolean;
};

type Dependencies = {
  resolveSources: typeof resolveStoryProductSources;
  findReady: typeof findReusablePhotoSceneExtraction;
  loadOutput: (
    db: Db,
    input: { outputAssetId: string | null; campaignId: string }
  ) => Promise<OutputCandidate>;
};

function generationSnapshot(row: Generation): PhotoSceneGenerationSnapshot {
  return {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    campaignId: row.campaignId,
    operation: row.operation,
    status: row.status,
    sourceAssetId: row.sourceAssetId,
    sourceContentHash: row.sourceContentHash,
    inputCapsule: row.inputCapsule as PhotoSceneExtractionInputCapsuleV1,
    inputFingerprint: row.inputFingerprint,
    outputAssetId: row.outputAssetId,
    providerKey: row.providerKey,
    attemptCount: row.attemptCount,
    errorCode: row.errorCode,
    boundedError: row.boundedError,
    costUsd: row.costUsd,
  };
}

async function loadOutputCandidate(
  db: Db,
  input: { outputAssetId: string | null; campaignId: string }
): Promise<OutputCandidate> {
  if (!input.outputAssetId) {
    return { asset: null, currentCampaignAuthorized: false };
  }
  const [asset, campaignRef] = await Promise.all([
    db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, input.outputAssetId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({ assetId: schema.campaignAssetRefs.assetId })
      .from(schema.campaignAssetRefs)
      .where(
        and(
          eq(schema.campaignAssetRefs.campaignId, input.campaignId),
          eq(schema.campaignAssetRefs.assetId, input.outputAssetId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);
  return { asset, currentCampaignAuthorized: campaignRef != null };
}

function notFound(
  source: { assetId: string; contentHash: string },
  reason: "NO_READY_EXTRACTION" | "CANDIDATE_NOT_REUSABLE" | "OUTPUT_UNAVAILABLE"
): ExactProductDerivativeResolution {
  return ExactProductDerivativeResolutionSchema.parse({
    contractVersion: AI_STORY_EXACT_PRODUCT_DERIVATIVE_RESOLUTION_VERSION,
    status: "NOT_FOUND",
    productAuthorityId: source.assetId,
    sourceAssetId: source.assetId,
    sourceAssetContentHash: source.contentHash,
    reason,
  });
}

/**
 * Resolves existing exact-source derivative evidence using SELECTs only.
 * Selection, extraction, retries, queueing, and Campaign-link creation are absent.
 */
export async function resolveExactStoryProductDerivative(
  db: Db,
  input: {
    storyId: string;
    orgId: string;
    workspaceId: string;
    campaignId: string;
    productAuthorityId: string;
  },
  dependencies: Dependencies = {
    resolveSources: resolveStoryProductSources,
    findReady: findReusablePhotoSceneExtraction,
    loadOutput: loadOutputCandidate,
  }
): Promise<ExactProductDerivativeResolution> {
  const sources = await dependencies.resolveSources(db, input);
  const source = sources.find(
    (candidate) =>
      candidate.assetId === input.productAuthorityId &&
      candidate.usageType === "product_source" &&
      candidate.orgId === input.orgId &&
      candidate.workspaceId === input.workspaceId &&
      candidate.campaignId === input.campaignId &&
      candidate.status === "ready"
  );
  if (!source) {
    throw new AiStoryExactProductDerivativeAuthorityError(
      "Product authority is not an exact current Story product_source"
    );
  }
  const fingerprint = fingerprintPhotoSceneExtractionIdentityV1({
    version: PHOTO_SCENE_EXTRACTION_CONTRACT_VERSION,
    contract: PHOTO_SCENE_EXTRACTION_CONTRACT,
    operation: "product_extraction",
    policy: PHOTO_SCENE_EXTRACTION_POLICY,
    workspaceId: source.workspaceId,
    sourceContentHash: source.contentHash,
  });
  const generation = await dependencies.findReady(db, {
    workspaceId: source.workspaceId,
    sourceAssetId: source.assetId,
    fingerprint,
  });
  if (!generation) return notFound(source, "NO_READY_EXTRACTION");
  if (generation.orgId !== input.orgId || generation.workspaceId !== input.workspaceId) {
    return notFound(source, "CANDIDATE_NOT_REUSABLE");
  }

  const output = await dependencies.loadOutput(db, {
    outputAssetId: generation.outputAssetId,
    campaignId: input.campaignId,
  });
  const asset = output.asset;
  if (
    !asset ||
    !output.currentCampaignAuthorized ||
    asset.orgId !== input.orgId ||
    asset.workspaceId !== input.workspaceId ||
    asset.deletedAt != null ||
    asset.status !== "ready" ||
    asset.type !== "image" ||
    asset.mimeType?.toLowerCase().trim() !== "image/png"
  ) {
    return notFound(source, "OUTPUT_UNAVAILABLE");
  }

  const decision = evaluateExtractionReuse({
    workspaceId: source.workspaceId,
    expectedSourceAssetId: source.assetId,
    fingerprint,
    sourceContentHash: source.contentHash,
    candidate: {
      generation: generationSnapshot(generation),
      outputAsset: asset as PhotoSceneAssetSnapshot,
    },
  });
  if (!decision.reuse) return notFound(source, "CANDIDATE_NOT_REUSABLE");

  return ExactProductDerivativeResolutionSchema.parse({
    contractVersion: AI_STORY_EXACT_PRODUCT_DERIVATIVE_RESOLUTION_VERSION,
    status: "FOUND",
    productAuthorityId: source.assetId,
    sourceAssetId: source.assetId,
    sourceAssetContentHash: source.contentHash,
    derivative: {
      assetId: asset.id,
      contentHash: asset.contentHash,
      generationId: generation.id,
      generationFingerprint: generation.inputFingerprint,
      operation: "product_extraction",
    },
  });
}
