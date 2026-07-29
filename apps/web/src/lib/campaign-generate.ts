/**
 * Authoritative Campaign Generate path — enqueues production agent.pipeline.
 */
import { and, eq } from "drizzle-orm";
import { getCampaignAssets, getDb, schema } from "@ceo-agent/db";
import { enqueuePipeline } from "@ceo-agent/queue";
import { validateCampaignForGenerate } from "@ceo-agent/shared";
import { validateCampaignAssetsForRun } from "@/lib/campaign-assets";
import { startOrReuseCampaignRun } from "@/lib/campaign-run";

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
      summary: Record<string, string | number | boolean>;
    }
  | { ok: false; error: string; code: string; status: number };

export async function executeCampaignGenerate(
  db: Db,
  campaign: CampaignRow,
  userId: string,
  options?: ExecuteCampaignGenerateOptions
): Promise<ExecuteCampaignGenerateResult> {
  const assets = await getCampaignAssets(db, campaign.id, campaign.workspaceId);
  const storyRefs = await db
    .select({ storyId: schema.campaignStoryRefs.storyId })
    .from(schema.campaignStoryRefs)
    .innerJoin(schema.stories, eq(schema.stories.id, schema.campaignStoryRefs.storyId))
    .where(
      and(
        eq(schema.campaignStoryRefs.campaignId, campaign.id),
        eq(schema.stories.status, "ready")
      )
    );

  const validation = validateCampaignForGenerate({
    name: campaign.name,
    objective: campaign.objective,
    objectiveCustom: campaign.objectiveCustom,
    outputLanguage: campaign.outputLanguage,
    subtitleLanguage: campaign.subtitleLanguage,
    ctaLanguage: campaign.ctaLanguage,
    hashtagLanguage: campaign.hashtagLanguage,
    assetCount: assets.length,
    storyCount: storyRefs.length,
  });

  if (!validation.ok) {
    await db
      .update(schema.campaigns)
      .set({
        generateStatus: "failed",
        generateSummary: { errors: validation.errors, aiGeneration: false },
        updatedAt: new Date(),
      })
      .where(eq(schema.campaigns.id, campaign.id));
    return {
      ok: false,
      error: validation.errors.join("; "),
      code: "VALIDATION_ERROR",
      status: 400,
    };
  }

  const processing = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(
      and(
        eq(schema.campaigns.orgId, campaign.orgId),
        eq(schema.campaigns.status, "processing")
      )
    );

  if (processing.length >= MAX_CONCURRENT_CAMPAIGNS && campaign.status !== "processing") {
    return {
      ok: false,
      error: `Max ${MAX_CONCURRENT_CAMPAIGNS} concurrent campaigns per org`,
      code: "RATE_LIMIT",
      status: 429,
    };
  }

  const assetCheck = await validateCampaignAssetsForRun(
    db,
    campaign.id,
    campaign.workspaceId
  );
  if (!assetCheck.ok) {
    await db
      .update(schema.campaigns)
      .set({
        generateStatus: "failed",
        generateSummary: { error: assetCheck.error, aiGeneration: false },
        updatedAt: new Date(),
      })
      .where(eq(schema.campaigns.id, campaign.id));
    return {
      ok: false,
      error: assetCheck.error,
      code: "VALIDATION_ERROR",
      status: 400,
    };
  }

  const run = await startOrReuseCampaignRun(db, campaign, {
    contentLocale: options?.contentLocale,
    renderPreferences: options?.renderPreferences,
    enqueue: options?.enqueue,
  });

  if (!run.ok) {
    await db
      .update(schema.campaigns)
      .set({
        generateStatus: "failed",
        generateSummary: { error: run.error, aiGeneration: false },
        updatedAt: new Date(),
      })
      .where(eq(schema.campaigns.id, campaign.id));
    return run;
  }

  const summary = {
    ...validation.summary,
    validatedAt: new Date().toISOString(),
    validatedBy: userId,
    aiGeneration: true,
    marketingPackageGenerated: false,
    taskId: run.taskId,
    pipelineStartedAt: new Date().toISOString(),
    reused: run.reused,
  };

  await db
    .update(schema.campaigns)
    .set({
      generateStatus: "processing",
      generateSummary: summary,
      updatedAt: new Date(),
    })
    .where(eq(schema.campaigns.id, campaign.id));

  return {
    ok: true,
    taskId: run.taskId,
    status: run.status,
    reused: run.reused,
    summary,
  };
}
