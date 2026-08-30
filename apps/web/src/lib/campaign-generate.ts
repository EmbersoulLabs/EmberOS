/**
 * Production-auth Campaign generate path. Does not include AUTH-01 entitlement cutover.
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { enqueuePipeline } from "@ceo-agent/queue";
import { isMergedSourceAsset } from "@ceo-agent/shared";
import { validateCampaignAssetsForRun, getCampaignAssets } from "@/lib/campaign-assets";
import { startOrReuseCampaignRun } from "@/lib/campaign-run";
import {
  requireFinalizedCampaignSourceAssets,
  SourceAssetIdentityNotFinalizedError,
} from "@/lib/source-asset-content-hash";

type Db = ReturnType<typeof getDb>;
type CampaignRow = typeof schema.campaigns.$inferSelect;

const MAX_CONCURRENT_CAMPAIGNS = 2;

export type ExecuteCampaignGenerateOptions = {
  contentLocale?: string;
  renderPreferences?: { subtitleStyle: string; subtitleLanguage: string };
  enqueue?: typeof enqueuePipeline;
};

export type ExecuteCampaignGenerateResult =
  | {
      ok: true;
      taskId: string;
      status: string;
      reused: boolean;
    }
  | { ok: false; error: string; code: string; status: number };

export async function executeCampaignGenerate(
  db: Db,
  campaign: CampaignRow,
  _userId: string,
  options?: ExecuteCampaignGenerateOptions
): Promise<ExecuteCampaignGenerateResult> {
  const processing = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(
      and(eq(schema.campaigns.orgId, campaign.orgId), eq(schema.campaigns.status, "processing"))
    );

  if (processing.length >= MAX_CONCURRENT_CAMPAIGNS && campaign.status !== "processing") {
    return {
      ok: false,
      error: `Max ${MAX_CONCURRENT_CAMPAIGNS} concurrent campaigns per org`,
      code: "RATE_LIMIT",
      status: 429,
    };
  }

  const assetCheck = await validateCampaignAssetsForRun(db, campaign.id, campaign.workspaceId);
  if (!assetCheck.ok) {
    return { ok: false, error: assetCheck.error, code: "VALIDATION_ERROR", status: 400 };
  }

  const assets = await getCampaignAssets(db, campaign.id, campaign.workspaceId);
  const sourceAssets = assets.filter(
    (asset) =>
      (asset.type === "video" || asset.type === "image") && !isMergedSourceAsset(asset.metadata)
  );
  try {
    await requireFinalizedCampaignSourceAssets(db, sourceAssets, {
      organizationId: campaign.orgId,
      workspaceId: campaign.workspaceId,
    });
  } catch (error) {
    if (error instanceof SourceAssetIdentityNotFinalizedError) {
      return { ok: false, error: error.message, code: error.code, status: 409 };
    }
    throw error;
  }

  return startOrReuseCampaignRun(db, campaign, {
    contentLocale: options?.contentLocale,
    renderPreferences: options?.renderPreferences,
    enqueue: options?.enqueue,
  });
}
