/**
 * Production-auth Campaign generate path. Does not include AUTH-01 entitlement cutover.
 */
import { and, eq } from "drizzle-orm";
import {
  BillingAccountRepositoryImpl,
  ControlledSelfUseAuthorityService,
  PlatformAdminRepositoryImpl,
  getDb,
  schema,
} from "@ceo-agent/db";
import { enqueueControlledSelfUsePipeline, enqueuePipeline } from "@ceo-agent/queue";
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
  userId: string,
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

  let controlledEnqueue: typeof enqueuePipeline | undefined;
  if (process.env.AI_STORY_PROVIDER_DISPATCH_MODE === "allowlisted_self_use") {
    const grant = await new PlatformAdminRepositoryImpl(db).getActiveGrantForUser(userId);
    if (!grant) {
      return { ok: false, error: "Controlled Self-Use requires an active Platform Super Admin", code: "SELF_USE_DENIED", status: 403 };
    }
    const billing = await new BillingAccountRepositoryImpl(db).getByOrgId(campaign.orgId);
    if (!billing) {
      return { ok: false, error: "Billing Account is required for Controlled Self-Use", code: "BILLING_REQUIRED", status: 403 };
    }
    const selfUse = new ControlledSelfUseAuthorityService(db);
    await selfUse.assertWorkspaceEligible({
      environment: "PRODUCTION",
      organizationId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      capabilityKey: "campaign.generate",
      providerKey: "openai",
    });
    controlledEnqueue = async (taskId, campaignId, workspaceId, orgId) => {
      const reservedAt = new Date().toISOString();
      const reserved = await selfUse.reserve({
        environment: "PRODUCTION",
        organizationId: orgId,
        workspaceId,
        capabilityKey: "campaign.generate",
        executionIdentity: `campaign-task:${taskId}`,
        providerKey: "openai",
        maximumCostUsd: "0.50",
        retryOrdinal: 0,
        actorUserId: userId,
        reservedAt,
      });
      return enqueueControlledSelfUsePipeline(
        taskId,
        campaignId,
        workspaceId,
        orgId,
        reserved.reservation.reservationId
      );
    };
  }

  return startOrReuseCampaignRun(db, campaign, {
    contentLocale: options?.contentLocale,
    renderPreferences: options?.renderPreferences,
    enqueue: options?.enqueue ?? controlledEnqueue,
  });
}
