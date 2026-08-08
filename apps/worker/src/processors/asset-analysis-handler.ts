import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  provideCampaignAIContext,
  provideCampaignAIContextFromCampaign,
  runVisionAgent,
} from "@ceo-agent/agents";
import type { BrandProfile, VisionAnalysis } from "@ceo-agent/shared";
import { prepareVisionFromStorage } from "../media/vision-prep";
import {
  contentIntelligenceFromVision,
  refreshAssetDisplayNameFromVision,
} from "../asset-auto-name";

type AssetAnalysisJobData = { assetId: string; workspaceId: string };

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stateStatus(metadata: Record<string, unknown>): string | undefined {
  const state = metadata.assetAnalysis;
  if (!state || typeof state !== "object") return undefined;
  const status = (state as Record<string, unknown>).status;
  return typeof status === "string" ? status : undefined;
}

async function mergeMetadata(
  assetId: string,
  workspaceId: string,
  patch: Record<string, unknown>
) {
  const db = getDb();
  const encoded = JSON.stringify(patch);
  await db
    .update(schema.assets)
    .set({
      metadata: sql`coalesce(${schema.assets.metadata}, '{}'::jsonb) || ${encoded}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.assets.id, assetId),
        eq(schema.assets.workspaceId, workspaceId),
        isNull(schema.assets.deletedAt)
      )
    );
}

async function contextForAsset(
  asset: typeof schema.assets.$inferSelect,
  metadata: Record<string, unknown>
) {
  const db = getDb();
  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, asset.workspaceId))
    .limit(1);
  const brandProfile = (workspace?.brandProfile ?? {}) as BrandProfile;
  const campaignId =
    typeof metadata.uploadContextCampaignId === "string"
      ? metadata.uploadContextCampaignId
      : null;

  if (campaignId) {
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (campaign && campaign.workspaceId === asset.workspaceId) {
      return {
        campaignName: campaign.name,
        context: provideCampaignAIContextFromCampaign({
          brandProfile,
          campaign,
          assets: [{ id: asset.id, type: asset.type }],
        }),
      };
    }
  }

  return {
    campaignName: workspace?.name ?? "Asset Library",
    context: provideCampaignAIContext({
      businessProfile: brandProfile,
      campaignObjective: "Understand this uploaded asset",
      publishingPlatforms: [],
      targetAudience: brandProfile.targetAudience ?? null,
      campaignBrief: null,
      workspaceLanguage: brandProfile.locale ?? "en-SG",
      assets: [{ id: asset.id, type: asset.type }],
    }),
  };
}

export async function processAssetAnalysisJob(
  data: AssetAnalysisJobData,
  attempt = 1
): Promise<{ status: "completed" | "skipped" }> {
  const db = getDb();
  const [asset] = await db
    .select()
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.id, data.assetId),
        eq(schema.assets.workspaceId, data.workspaceId),
        isNull(schema.assets.deletedAt)
      )
    )
    .limit(1);

  if (!asset || asset.type !== "image") return { status: "skipped" };
  const metadata = metadataObject(asset.metadata);
  if (stateStatus(metadata) === "completed" && metadata.visionAnalysis) {
    return { status: "skipped" };
  }

  await mergeMetadata(asset.id, asset.workspaceId, {
    assetAnalysis: {
      status: "analyzing",
      queuedAt:
        metadata.assetAnalysis && typeof metadata.assetAnalysis === "object"
          ? (metadata.assetAnalysis as Record<string, unknown>).queuedAt
          : undefined,
      startedAt: new Date().toISOString(),
      attempts: attempt,
    },
  });

  try {
    const prepared = await prepareVisionFromStorage({
      storagePath: asset.storagePath,
      mediaType: "image",
    });
    const { context, campaignName } = await contextForAsset(asset, metadata);
    const { analysis } = await runVisionAgent({
      assetId: asset.id,
      mediaType: "image",
      frames: prepared.frames,
      campaignName,
      campaignContext: context,
    });
    const intelligence = contentIntelligenceFromVision(analysis);
    const completedAt = new Date().toISOString();
    await mergeMetadata(asset.id, asset.workspaceId, {
      visionAnalysis: analysis,
      ...intelligence,
      visionAnalyzedAt: completedAt,
      assetAnalysis: {
        status: "completed",
        completedAt,
        attempts: attempt,
      },
    });
    await refreshAssetDisplayNameFromVision({
      assetId: asset.id,
      workspaceId: asset.workspaceId,
      vision: analysis as VisionAnalysis,
    });
    return { status: "completed" };
  } catch (error) {
    const failedAt = new Date().toISOString();
    await mergeMetadata(asset.id, asset.workspaceId, {
      assetAnalysis: {
        status: "failed",
        failedAt,
        attempts: attempt,
        error: "Visual analysis failed. The upload is preserved and can be renamed manually.",
      },
    }).catch(() => undefined);
    throw error;
  }
}
