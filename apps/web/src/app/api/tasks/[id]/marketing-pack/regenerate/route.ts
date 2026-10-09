import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole, getBusinessProfileByWorkspace } from "@ceo-agent/db";
import {
  regeneratePlatformAsset,
  provideCampaignAIContextFromCampaign,
  contentPackageToCopyVariants,
} from "@ceo-agent/agents";
import {
  MARKETING_PLATFORM_IDS,
  normalizeMarketingContentPackage,
  normalizeStrategyPlan,
  BrandProfileSchema,
  applyPlatformRegeneration,
  isTaskBudgetExhausted,
  readMarketingPackRevision,
  selectBusinessFacts,
  type BrandProfile,
  type ContentLocale,
  type MarketingPackLocale,
  type MarketingPlatformId,
  type Platform,
  type StepProgress,
  type VisionAnalysis,
  type CopyVariant,
} from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { recordMarketingModelUsage, saveMarketingPackIfCurrent } from "@/lib/marketing-pack-persistence";

const LOCALES = new Set<MarketingPackLocale>(["zh", "en", "ms"]);

/** Regenerate a single platform's marketing copy with AI (grounded in the asset). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const db = getDb();

    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).limit(1);
    if (!task) return apiError("Task not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(task.workspaceId, user.id, "editor");

    if (isTaskBudgetExhausted(task.costUsd, task.costBudgetUsd)) {
      return apiError("Task AI budget is exhausted", "BUDGET_EXCEEDED", 402);
    }

    const body = (await request.json().catch(() => null)) as {
      platformId?: string;
      locale?: string;
      contentRevision?: number;
    } | null;
    const platformId = body?.platformId as MarketingPlatformId | undefined;
    if (!platformId || !MARKETING_PLATFORM_IDS.includes(platformId)) {
      return apiError("Invalid platformId", "INVALID", 400);
    }
    if (body?.locale !== undefined && !LOCALES.has(body.locale as MarketingPackLocale)) {
      return apiError("Invalid locale", "INVALID", 400);
    }
    const locale = (body?.locale as MarketingPackLocale | undefined) ?? "zh";

    const progress = (task.stepProgress as StepProgress) ?? {};
    const step = progress.content_generate;
    if (step?.status !== "completed" || !step.output) {
      return apiError("Marketing pack not ready", "NOT_READY", 400);
    }
    const existing = normalizeMarketingContentPackage(step.output);
    if (!existing) return apiError("Invalid marketing pack", "INVALID", 400);

    const vision = progress.vision_analyze?.output as VisionAnalysis | undefined;
    const rawStrategy = task.strategyJson ?? progress.strategy_plan?.output;
    if (!vision || !rawStrategy) {
      return apiError("Strategy or vision analysis missing", "NOT_READY", 400);
    }
    const strategy = normalizeStrategyPlan(rawStrategy);

    let campaignName: string | undefined;
    let campaignRow: typeof schema.campaigns.$inferSelect | null = null;
    let brandProfile: BrandProfile = BrandProfileSchema.parse({});
    if (task.campaignId) {
      const [campaign] = await db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, task.campaignId))
        .limit(1);
      if (campaign) {
        campaignRow = campaign;
        campaignName = campaign.name;
      }
      const [workspace] = await db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, task.workspaceId))
        .limit(1);
      brandProfile = (workspace?.brandProfile ?? brandProfile) as BrandProfile;
    }
    if (!campaignRow) {
      return apiError("Campaign not found", "NOT_FOUND", 404);
    }

    const profile = await getBusinessProfileByWorkspace(task.workspaceId);
    const businessInformation = selectBusinessFacts(profile, brandProfile);
    const campaignContext = provideCampaignAIContextFromCampaign({
      brandProfile,
      campaign: campaignRow,
      vision,
      strategy,
      transcript: vision.transcriptSummary ?? null,
    });

    const { asset, usage } = await regeneratePlatformAsset({
      campaignContext,
      platformId,
      strategy,
      vision,
      campaignName,
      previousCaption: existing.platformAssets?.[platformId]?.caption,
      businessInformation: { ...businessInformation } as Record<string, unknown>,
      locale: locale as ContentLocale,
    });

    await recordMarketingModelUsage({
      orgId: task.orgId,
      workspaceId: task.workspaceId,
      taskId: id,
      agent: "marketing_regenerate",
      usage,
    });

    const updatedPackage = applyPlatformRegeneration(existing, platformId, asset, locale);
    const expectedRevision =
      typeof body?.contentRevision === "number" ? body.contentRevision : readMarketingPackRevision(progress);
    const saved = await saveMarketingPackIfCurrent({
      taskId: id,
      expectedRevision,
      contentPackage: updatedPackage,
    });
    if (!saved.ok) {
      return apiError(
        "Marketing pack was updated by someone else. Regeneration was not saved.",
        "CONFLICT",
        409
      );
    }

    if (locale === "zh" || platformId === "xiaohongshu") {
      const platforms = (campaignRow.platforms?.length ? campaignRow.platforms : ["tiktok"]) as Platform[];
      const refreshedVariants = contentPackageToCopyVariants(updatedPackage, strategy, platforms);
      const creatives = await db.select().from(schema.creatives).where(eq(schema.creatives.taskId, id));
      for (const creative of creatives) {
        const prior = (creative.copyVariants ?? []) as CopyVariant[];
        await db
          .update(schema.creatives)
          .set({
            copyVariants: refreshedVariants.length > 0 ? refreshedVariants : prior,
            updatedAt: new Date(),
          })
          .where(eq(schema.creatives.id, creative.id));
      }
    }

    return apiSuccess({ contentPackage: updatedPackage, contentRevision: saved.revision, usage });
  } catch (error) {
    return handleApiError(error);
  }
}
