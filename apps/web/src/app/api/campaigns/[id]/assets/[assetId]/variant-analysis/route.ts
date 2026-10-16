import { and, eq, isNull, or } from "drizzle-orm";
import {
  AiStoryAssetAwareExecutionPlannerRepository,
  AiStoryAssetPlannerPersistenceError,
  ControlledSelfUseAuthorityService,
  ControlledSelfUseError,
  getDb,
  schema,
} from "@ceo-agent/db";
import {
  VISUAL_SEMANTIC_ANALYZER_VERSION,
  withControlledSelfUseProviderContext,
} from "@ceo-agent/agents";
import {
  AI_STORY_VISUAL_SEMANTIC_SCHEMA_VERSION,
  extractProductVariantCandidates,
  visualSemanticFactsFromSnapshot,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { requireControlledSelfUseWorkspaceOperator } from "@/lib/controlled-self-use-workspace-access";
import { analyzeVisualSemanticAsset } from "@/lib/ai-story-asset-semantic-grounding";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId, assetId } = await params;
    const db = getDb();
    const [campaign] = await db
      .select({ orgId: schema.campaigns.orgId, workspaceId: schema.campaigns.workspaceId })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireControlledSelfUseWorkspaceOperator({
      request,
      userId: user.id,
      workspaceId: campaign.workspaceId,
      capabilityKey: "campaign.generate",
      providerKey: "openai",
    });
    const [asset] = await db
      .select({
        id: schema.assets.id,
        contentHash: schema.assets.contentHash,
      })
      .from(schema.assets)
      .leftJoin(
        schema.campaignAssetRefs,
        and(
          eq(schema.campaignAssetRefs.assetId, schema.assets.id),
          eq(schema.campaignAssetRefs.campaignId, campaignId)
        )
      )
      .where(and(
        eq(schema.assets.id, assetId),
        eq(schema.assets.orgId, campaign.orgId),
        eq(schema.assets.workspaceId, campaign.workspaceId),
        eq(schema.assets.type, "image"),
        isNull(schema.assets.deletedAt),
        or(
          eq(schema.assets.campaignId, campaignId),
          eq(schema.campaignAssetRefs.campaignId, campaignId)
        )
      ))
      .limit(1);
    if (!asset) return apiError("Product reference not found", "NOT_FOUND", 404);
    if (!asset.contentHash) {
      return apiError(
        "Product reference is not finalized for analysis",
        "PRODUCT_VARIANT_ASSET_NOT_FINALIZED",
        409
      );
    }

    const respond = (outcome: Awaited<ReturnType<typeof analyzeVisualSemanticAsset>>) => {
      const facts = visualSemanticFactsFromSnapshot(outcome.snapshot);
      const candidates = extractProductVariantCandidates(facts);
      return apiSuccess({
        assetId,
        snapshotId: outcome.snapshot.snapshotId,
        analyzerVersion: outcome.snapshot.analyzerVersion,
        schemaVersion: outcome.snapshot.schemaVersion,
        cacheStatus: outcome.cacheStatus,
        analyzerInvoked: outcome.analyzerInvoked,
        variantAnalysisState: candidates.length > 0 ? "READY" : "INSUFFICIENT",
        variantCandidates: candidates,
        variantCandidateEvidence: facts.inferred.productVariantCandidates,
      });
    };

    const repository = new AiStoryAssetAwareExecutionPlannerRepository(db);
    const cached = await repository.findReusableAnalysis({
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      contentHash: asset.contentHash,
      analyzerVersion: VISUAL_SEMANTIC_ANALYZER_VERSION,
      schemaVersion: AI_STORY_VISUAL_SEMANTIC_SCHEMA_VERSION,
    });
    if (cached) {
      return respond(await analyzeVisualSemanticAsset({
        db,
        orgId: campaign.orgId,
        workspaceId: campaign.workspaceId,
        assetId,
      }));
    }

    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 128) {
      return apiError(
        "A bounded idempotency key is required before paid product analysis",
        "PRODUCT_VARIANT_ANALYSIS_AUTHORIZATION_REQUIRED",
        409
      );
    }

    const authority = new ControlledSelfUseAuthorityService(db);
    const executionIdentity = [
      "product-variant-analysis",
      campaign.workspaceId,
      asset.contentHash,
      VISUAL_SEMANTIC_ANALYZER_VERSION,
      AI_STORY_VISUAL_SEMANTIC_SCHEMA_VERSION,
    ].join(":");
    let reservation;
    try {
      reservation = (await authority.reserve({
        environment: "PRODUCTION",
        organizationId: campaign.orgId,
        workspaceId: campaign.workspaceId,
        capabilityKey: "ai_story.plan",
        executionIdentity,
        providerKey: "openai",
        maximumCostUsd: "0.10",
        retryOrdinal: 0,
        actorUserId: user.id,
        reservedAt: new Date().toISOString(),
      })).reservation;
    } catch (error) {
      if (error instanceof ControlledSelfUseError) {
        return apiError(
          "Product analysis requires an active, budgeted Production planning authority",
          error.code,
          403
        );
      }
      throw error;
    }
    if (reservation.status !== "RESERVED") {
      return apiError(
        "This product analysis authorization was already consumed; refresh for cached evidence or request a new explicit analysis",
        "PRODUCT_VARIANT_ANALYSIS_REPLAY_BLOCKED",
        409
      );
    }

    try {
      const outcome = await withControlledSelfUseProviderContext({
        reservationId: reservation.reservationId,
        organizationId: campaign.orgId,
        workspaceId: campaign.workspaceId,
        executionIdentity,
        providerKey: "openai",
      }, () => analyzeVisualSemanticAsset({
        db,
        orgId: campaign.orgId,
        workspaceId: campaign.workspaceId,
        assetId,
        onProviderCompletion: async (completion) => {
          await authority.settle(
            reservation.reservationId,
            completion.usage.costUsd.toFixed(2),
            new Date().toISOString(),
            completion.providerRequestId ?? undefined
          );
        },
      }));
      if (!outcome.analyzerInvoked) {
        await authority.release(reservation.reservationId, new Date().toISOString());
      }
      return respond(outcome);
    } catch (error) {
      const latest = await authority.getReservationById(reservation.reservationId);
      if (latest?.status === "RESERVED") {
        await authority.release(reservation.reservationId, new Date().toISOString());
      }
      if (error instanceof AiStoryAssetPlannerPersistenceError) {
        return apiError(
          "Product analysis failed before producing reusable evidence; no automatic retry was made",
          "PRODUCT_VARIANT_ANALYSIS_FAILED",
          502
        );
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
