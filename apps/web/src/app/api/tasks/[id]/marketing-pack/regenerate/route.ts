import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { regeneratePlatformAsset, provideCampaignAIContext } from "@ceo-agent/agents";
import {
  MARKETING_PLATFORM_IDS,
  normalizeMarketingContentPackage,
  normalizeStrategyPlan,
  parseCampaignCreativeBrief,
  resolvePipelineContentLocale,
  resolvePlatformAssets,
  BrandProfileSchema,
  type BrandProfile,
  type MarketingCaptions,
  type MarketingPlatformId,
  type StepProgress,
  type VisionAnalysis,
} from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";

const CAPTION_KEYS = MARKETING_PLATFORM_IDS.filter(
  (id) => id !== "threads"
) as MarketingPlatformId[];

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

    const body = (await request.json().catch(() => null)) as { platformId?: string } | null;
    const platformId = body?.platformId as MarketingPlatformId | undefined;
    if (!platformId || !MARKETING_PLATFORM_IDS.includes(platformId)) {
      return apiError("Invalid platformId", "INVALID", 400);
    }

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
    let goal: string | undefined;
    let userNotes: string | undefined;
    let metadata: Record<string, unknown> | null = null;
    let platforms: string[] = [];
    let targetAudience: string | null = null;
    let brandProfile: BrandProfile = BrandProfileSchema.parse({});
    if (task.campaignId) {
      const [campaign] = await db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, task.campaignId))
        .limit(1);
      if (campaign) {
        campaignName = campaign.name;
        goal = campaign.campaignGoal ?? campaign.goal ?? undefined;
        metadata = campaign.metadata ?? null;
        userNotes = parseCampaignCreativeBrief(campaign).campaignBrief;
        platforms = campaign.platforms ?? [];
        targetAudience = campaign.targetAudienceOverride;
      }
      const [workspace] = await db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, task.workspaceId))
        .limit(1);
      brandProfile = (workspace?.brandProfile ?? brandProfile) as BrandProfile;
    }
    const contentLocale = resolvePipelineContentLocale(metadata, goal);

    const prevAssets = resolvePlatformAssets(existing);
    const previousCaption = prevAssets[platformId]?.caption;

    const campaignContext = provideCampaignAIContext({
      businessProfile: brandProfile,
      campaignObjective: goal ?? "",
      publishingPlatforms: platforms,
      targetAudience,
      campaignBrief: userNotes,
      workspaceLanguage: contentLocale,
      vision,
      strategy,
    });

    const { asset, usage } = await regeneratePlatformAsset({
      campaignContext,
      platformId,
      strategy,
      vision,
      campaignName,
      previousCaption,
    });

    const assets = { ...prevAssets };
    assets[platformId] = asset;

    const captions = { ...existing.captions } as MarketingCaptions;
    const captionsEn = { ...(existing.captionsEn ?? {}) } as Partial<MarketingCaptions>;
    const captionsMs = { ...(existing.captionsMs ?? {}) } as Partial<MarketingCaptions>;
    if (CAPTION_KEYS.includes(platformId)) {
      const key = platformId as keyof MarketingCaptions;
      captions[key] = asset.caption;
      captionsEn[key] = asset.caption;
      captionsMs[key] = asset.caption;
    }

    const updatedPackage = normalizeMarketingContentPackage({
      ...existing,
      platformAssets: assets,
      captions,
      captionsEn,
      captionsMs,
    });
    if (!updatedPackage) return apiError("Invalid marketing pack", "INVALID", 400);

    const updatedProgress: StepProgress = {
      ...progress,
      content_generate: { ...step, output: updatedPackage },
    };
    await db
      .update(schema.tasks)
      .set({ stepProgress: updatedProgress })
      .where(eq(schema.tasks.id, id));

    return apiSuccess({ contentPackage: updatedPackage, usage });
  } catch (error) {
    return handleApiError(error);
  }
}
