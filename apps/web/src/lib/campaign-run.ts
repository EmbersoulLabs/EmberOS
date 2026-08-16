/**
 * Campaign Run helpers — one active run + frozen generation identity.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { enqueuePipeline } from "@ceo-agent/queue";
import {
  ACTIVE_CAMPAIGN_TASK_STATUSES,
  LLM_BUDGET_PER_TASK_USD,
  isActiveCampaignTaskStatus,
  isCanonicalSourceContentHash,
  isMergedSourceAsset,
  parseCampaignCreativeBrief,
  effectiveCampaignGoal,
  resolvePipelineContentLocale,
  resolveRenderPreferences,
  BrandProfileSchema,
  normalizeCampaignVideoGenerationIdentityV1,
  CAMPAIGN_VIDEO_EXECUTION_CONTRACT,
  freezeLogoObjectReference,
  type CampaignVideoGenerationIdentityV1,
  PlatformSchema,
} from "@ceo-agent/shared";
import { fingerprintCampaignVideoGenerationIdentityV1 } from "@ceo-agent/shared/server";
import { getCampaignAssets } from "@/lib/campaign-assets";

type Db = ReturnType<typeof getDb>;
type CampaignRow = typeof schema.campaigns.$inferSelect;
type TaskRow = typeof schema.tasks.$inferSelect;

export async function findActiveCampaignTask(
  db: Db,
  campaignId: string
): Promise<TaskRow | null> {
  const [task] = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.campaignId, campaignId),
        inArray(schema.tasks.status, [...ACTIVE_CAMPAIGN_TASK_STATUSES])
      )
    )
    .orderBy(desc(schema.tasks.createdAt))
    .limit(1);
  return task ?? null;
}

export type StartCampaignRunResult =
  | { ok: true; taskId: string; status: string; reused: boolean }
  | { ok: false; error: string; code: string; status: number };

function logoObjectReference(value: string | undefined): string | null {
  return freezeLogoObjectReference(value);
}

export async function startOrReuseCampaignRun(
  db: Db,
  campaign: CampaignRow,
  options?: {
    contentLocale?: string;
    renderPreferences?: { subtitleStyle: string; subtitleLanguage: string };
    enqueue?: typeof enqueuePipeline;
  }
): Promise<StartCampaignRunResult> {
  const transactionResult = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${campaign.id}))`);
    const [lockedCampaign] = await tx
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign.id))
      .limit(1);
    if (!lockedCampaign) throw new Error("Campaign not found while creating task identity");
    const [active] = await tx
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.campaignId, campaign.id),
          inArray(schema.tasks.status, [...ACTIVE_CAMPAIGN_TASK_STATUSES])
        )
      )
      .orderBy(desc(schema.tasks.createdAt))
      .limit(1);
    if (active && isActiveCampaignTaskStatus(active.status)) {
      return {
        result: {
          ok: true,
          taskId: active.id,
          status: active.status,
          reused: true,
        } satisfies StartCampaignRunResult,
        enqueue: active.status === "queued",
      };
    }

    if (options?.contentLocale || options?.renderPreferences) {
      const campaignMeta = (lockedCampaign.metadata ?? {}) as Record<string, unknown>;
      await tx
        .update(schema.campaigns)
        .set({
          metadata: {
            ...campaignMeta,
            ...(options.contentLocale ? { contentLocale: options.contentLocale } : {}),
            ...(options.renderPreferences ? { renderPreferences: options.renderPreferences } : {}),
          },
        })
        .where(eq(schema.campaigns.id, campaign.id));
    }

    const effectiveMetadata = {
      ...((lockedCampaign.metadata ?? {}) as Record<string, unknown>),
      ...(options?.contentLocale ? { contentLocale: options.contentLocale } : {}),
      ...(options?.renderPreferences ? { renderPreferences: options.renderPreferences } : {}),
    };
    const assets = await getCampaignAssets(tx, lockedCampaign.id, lockedCampaign.workspaceId);
    const sourceAssets = assets.filter(
      (asset) =>
        (asset.type === "video" || asset.type === "image") && !isMergedSourceAsset(asset.metadata)
    );
    if (sourceAssets.length === 0) throw new Error("Campaign has no identity-bearing source assets");
    for (const asset of sourceAssets) {
      const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
      if (
        asset.orgId !== lockedCampaign.orgId ||
        asset.workspaceId !== lockedCampaign.workspaceId ||
        metadata.rejected === true ||
        !isCanonicalSourceContentHash(asset.contentHash)
      ) {
        throw new Error(`SOURCE_ASSET_IDENTITY_NOT_FINALIZED:${asset.id}`);
      }
    }
    const [workspace] = await tx
      .select()
      .from(schema.workspaces)
      .where(
        and(
          eq(schema.workspaces.id, lockedCampaign.workspaceId),
          eq(schema.workspaces.orgId, lockedCampaign.orgId)
        )
      )
      .limit(1);
    if (!workspace) throw new Error("Workspace not found while creating task identity");
    const brand = BrandProfileSchema.parse(workspace.brandProfile ?? {});
    const brief = parseCampaignCreativeBrief({ ...lockedCampaign, metadata: effectiveMetadata });
    const contentLocale = resolvePipelineContentLocale(effectiveMetadata, lockedCampaign.goal);
    const renderPreferences = resolveRenderPreferences({ campaignMetadata: effectiveMetadata });
    const capsule = normalizeCampaignVideoGenerationIdentityV1({
      version: 1,
      executionContract: CAMPAIGN_VIDEO_EXECUTION_CONTRACT,
      authority: {
        organizationId: lockedCampaign.orgId,
        workspaceId: lockedCampaign.workspaceId,
        campaignId: lockedCampaign.id,
      },
      generation: {
        campaignName: lockedCampaign.name,
        effectiveGoal: effectiveCampaignGoal(brief, lockedCampaign.goal, contentLocale),
        campaignBrief: brief.campaignBrief ?? null,
        targetAudience: brand.targetAudience ?? null,
        platforms: PlatformSchema.array().parse(lockedCampaign.platforms),
        contentLocale,
        treatment: {
          contentStyle: brief.contentStyle ?? null,
          voicePreset: brief.voicePreset,
          bgmPreference: brief.bgmPreference ?? "auto",
          bgmStartPreference: brief.bgmStartPreference ?? "auto",
          renderPreferences,
        },
        businessContext: {
          industry: brand.industry ?? null,
          tone: brand.tone ?? null,
          bannedWords: brand.bannedWords,
          cta: brand.cta ?? null,
          targetAudience: brand.targetAudience ?? null,
          locale: brand.locale,
          logoObjectReference: logoObjectReference(brand.logoUrl),
        },
        sources: sourceAssets.map((asset) => ({
          assetId: asset.id,
          contentHash: asset.contentHash!,
          mediaKind: asset.type as "video" | "image",
        })),
      },
    } satisfies CampaignVideoGenerationIdentityV1);
    const fingerprint = fingerprintCampaignVideoGenerationIdentityV1(capsule);

    const [task] = await tx
      .insert(schema.tasks)
      .values({
        orgId: campaign.orgId,
        workspaceId: campaign.workspaceId,
        campaignId: campaign.id,
        status: "queued",
        costBudgetUsd: String(LLM_BUDGET_PER_TASK_USD),
        stepProgress: {},
        generationInputCapsule: capsule,
        generationInputFingerprint: fingerprint,
      })
      .returning();
    if (!task) {
      return {
        result: {
          ok: false,
          error: "Failed to create task",
          code: "INTERNAL",
          status: 500,
        } satisfies StartCampaignRunResult,
        enqueue: false,
      };
    }
    await tx
      .update(schema.campaigns)
      .set({ status: "processing" })
      .where(eq(schema.campaigns.id, campaign.id));
    return {
      result: {
        ok: true,
        taskId: task.id,
        status: "queued",
        reused: false,
      } satisfies StartCampaignRunResult,
      enqueue: true,
    };
  });

  if (transactionResult.enqueue && transactionResult.result.ok) {
    try {
      await (options?.enqueue ?? enqueuePipeline)(
        transactionResult.result.taskId,
        campaign.id,
        campaign.workspaceId,
        campaign.orgId
      );
    } catch {
      return {
        ok: false,
        error: "Task is queued but queue delivery failed; Generate may retry recovery",
        code: "QUEUE_ENQUEUE_FAILED",
        status: 503,
      };
    }
  }
  return transactionResult.result;
}
