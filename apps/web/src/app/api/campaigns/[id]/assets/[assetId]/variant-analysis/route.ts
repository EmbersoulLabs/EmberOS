import { and, eq, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
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
      .select({ id: schema.assets.id })
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

    const outcome = await analyzeVisualSemanticAsset({
      db,
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      assetId,
    });
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
  } catch (error) {
    return handleApiError(error);
  }
}
