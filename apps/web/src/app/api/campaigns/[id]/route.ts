import { eq, and, desc, asc, getTableColumns, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { extractProductVariantCandidates, type ProductVariantSemanticFacts } from "@ceo-agent/shared";
import { VISUAL_SEMANTIC_ANALYZER_VERSION } from "@ceo-agent/agents";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { isCampaignDeletable } from "@/lib/campaigns";
import { withSignedCreativeArtifacts, withSignedTaskExportProgress } from "@/lib/video-artifact-delivery";
import { deleteCampaignCascade } from "@/lib/campaign-delete";
import { requireControlledSelfUseWorkspaceOperator } from "@/lib/controlled-self-use-workspace-access";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const db = getDb();

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, id))
      .limit(1);

    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireControlledSelfUseWorkspaceOperator({ request, userId: user.id, workspaceId: campaign.workspaceId, capabilityKey: "campaign.generate", providerKey: "openai" });

    const legacyAssets = await db
      .select()
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.campaignId, id),
          eq(schema.assets.workspaceId, campaign.workspaceId),
          isNull(schema.assets.deletedAt)
        )
      );

    const referencedAssets = await db
      .select(getTableColumns(schema.assets))
      .from(schema.campaignAssetRefs)
      .innerJoin(schema.assets, eq(schema.assets.id, schema.campaignAssetRefs.assetId))
      .where(
        and(
          eq(schema.campaignAssetRefs.campaignId, id),
          eq(schema.assets.workspaceId, campaign.workspaceId),
          isNull(schema.assets.deletedAt)
        )
      )
      .orderBy(asc(schema.campaignAssetRefs.sortOrder));

    const assets = [...referencedAssets, ...legacyAssets].filter(
      (asset, index, rows) => rows.findIndex((candidate) => candidate.id === asset.id) === index
    );
    const contentHashes = assets.flatMap((asset) => asset.contentHash ? [asset.contentHash] : []);
    const snapshots = contentHashes.length === 0 ? [] : await db
      .select({
        analyzedContentHash: schema.assetAnalysisSnapshots.analyzedContentHash,
        analysis: schema.assetAnalysisSnapshots.analysis,
      })
      .from(schema.assetAnalysisSnapshots)
      .where(and(
        eq(schema.assetAnalysisSnapshots.workspaceId, campaign.workspaceId),
        inArray(schema.assetAnalysisSnapshots.analyzedContentHash, contentHashes),
        eq(schema.assetAnalysisSnapshots.analyzerVersion, VISUAL_SEMANTIC_ANALYZER_VERSION),
        eq(schema.assetAnalysisSnapshots.schemaVersion, "ai-story-asset-visual-semantics.v1")
      ))
      .orderBy(desc(schema.assetAnalysisSnapshots.createdAt));
    const variantCandidates = new Map<string, string[]>();
    const variantCandidateEvidence = new Map<string, NonNullable<ProductVariantSemanticFacts["inferred"]>["productVariantCandidates"]>();
    for (const row of snapshots) {
      if (variantCandidates.has(row.analyzedContentHash)) continue;
      const facts = row.analysis && typeof row.analysis === "object"
        ? (row.analysis as { facts?: { visualSemantics?: ProductVariantSemanticFacts } }).facts?.visualSemantics
        : null;
      variantCandidates.set(row.analyzedContentHash, extractProductVariantCandidates(facts));
      variantCandidateEvidence.set(row.analyzedContentHash, facts?.inferred?.productVariantCandidates ?? []);
    }
    const assetsWithVariants = assets.map((asset) => ({
      ...asset,
      variantCandidates: asset.contentHash ? variantCandidates.get(asset.contentHash) ?? [] : [],
      variantCandidateEvidence: asset.contentHash ? variantCandidateEvidence.get(asset.contentHash) ?? [] : [],
      variantAnalysisState: !asset.contentHash || !variantCandidates.has(asset.contentHash)
        ? "MISSING"
        : (variantCandidates.get(asset.contentHash)?.length ?? 0) > 0
          ? "READY"
          : "INSUFFICIENT",
    }));

    const assetStories = await db
      .select({
        id: schema.stories.id,
        name: schema.stories.name,
        status: schema.stories.status,
        coverAssetId: schema.stories.coverAssetId,
      })
      .from(schema.campaignStoryRefs)
      .innerJoin(schema.stories, eq(schema.stories.id, schema.campaignStoryRefs.storyId))
      .where(
        and(
          eq(schema.campaignStoryRefs.campaignId, id),
          eq(schema.stories.workspaceId, campaign.workspaceId),
          isNull(schema.stories.deletedAt)
        )
      );

    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.campaignId, id), eq(schema.tasks.workspaceId, campaign.workspaceId)))
      .orderBy(desc(schema.tasks.createdAt))
      .limit(1);

    const creatives = task
      ? await db
          .select()
          .from(schema.creatives)
          .where(eq(schema.creatives.taskId, task.id))
          .orderBy(asc(schema.creatives.createdAt))
      : [];

    const hasVideoAsset = assetsWithVariants.some((a) => a.type === "video");

    let campaignRecord = campaign;
    if (task?.status === "failed" && campaign.status === "processing") {
      const [synced] = await db
        .update(schema.campaigns)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(schema.campaigns.id, id))
        .returning();
      campaignRecord = synced ?? campaign;
    }

    const deliveredCreatives = await Promise.all(creatives.map((item) => withSignedCreativeArtifacts(item)));
    const deliveredProgress = task
      ? await withSignedTaskExportProgress(
          task.stepProgress as Record<string, unknown> | null,
          { taskId: task.id, workspaceId: task.workspaceId, campaignId: task.campaignId }
        )
      : null;
    return apiSuccess({
      campaign: campaignRecord,
      assets: assetsWithVariants,
      assetStories,
      task: task ? { ...task, stepProgress: deliveredProgress } : null,
      creative: deliveredCreatives[0] ?? null,
      creatives: deliveredCreatives,
      hasVideoAsset,
      clipCount: creatives.length,
      canDelete: isCampaignDeletable(
        campaignRecord.status,
        task?.status,
        (task?.stepProgress as Record<string, { status?: string }>) ?? null
      ),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const body = await request.json();
    const db = getDb();

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, id))
      .limit(1);

    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireControlledSelfUseWorkspaceOperator({ request, userId: user.id, workspaceId: campaign.workspaceId, capabilityKey: "campaign.generate", providerKey: "openai" });

    const [updated] = await db
      .update(schema.campaigns)
      .set({
        name: body.name ?? campaign.name,
        goal: body.goal ?? campaign.goal,
        platforms: body.platforms ?? campaign.platforms,
        updatedAt: new Date(),
      })
      .where(eq(schema.campaigns.id, id))
      .returning();

    return apiSuccess({ campaign: updated });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const db = getDb();

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, id))
      .limit(1);

    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireControlledSelfUseWorkspaceOperator({ request, userId: user.id, workspaceId: campaign.workspaceId, capabilityKey: "campaign.generate", providerKey: "openai" });

    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(eq(schema.tasks.campaignId, id), eq(schema.tasks.workspaceId, campaign.workspaceId))
      )
      .orderBy(desc(schema.tasks.createdAt))
      .limit(1);

    if (
      !isCampaignDeletable(
        campaign.status,
        task?.status,
        (task?.stepProgress as Record<string, { status?: string }>) ?? null
      )
    ) {
      return apiError(
        "This campaign cannot be deleted in its current state",
        "INVALID_STATE",
        400
      );
    }

    await deleteCampaignCascade(db, id, campaign.workspaceId);

    return apiSuccess({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
