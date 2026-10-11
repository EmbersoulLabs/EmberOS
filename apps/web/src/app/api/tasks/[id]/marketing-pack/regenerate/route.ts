import { eq } from "drizzle-orm";
import {
  BusinessProfileRequiredError,
  getDb,
  loadCanonicalBusinessContext,
  requireWorkspaceRole,
  schema,
} from "@ceo-agent/db";
import { regeneratePlatformAsset } from "@ceo-agent/agents";
import {
  MARKETING_PLATFORM_IDS,
  applyPlatformRegeneration,
  normalizeMarketingContentPackage,
  normalizeStrategyPlan,
  parseCampaignCreativeBrief,
  readMarketingPackRevision,
  resolvePipelineContentLocale,
  resolvePlatformAssets,
  selectBusinessFacts,
  type MarketingPackLocale,
  type MarketingPlatformId,
  type StepProgress,
  type VisionAnalysis,
} from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import {
  beginPaidMarketingCall,
  cancelPaidMarketingCall,
  finishPaidMarketingCall,
  saveMarketingPackIfCurrent,
} from "@/lib/marketing-pack-persistence";

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

    const body = (await request.json().catch(() => null)) as {
      platformId?: string;
      locale?: string;
      contentRevision?: number;
    } | null;
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
      }
    }
    const requestedLocale = body?.locale;
    if (requestedLocale !== undefined && !LOCALES.has(requestedLocale as MarketingPackLocale)) {
      return apiError("Invalid locale", "INVALID", 400);
    }
    const contentLocale = (requestedLocale as MarketingPackLocale | undefined) ?? resolvePipelineContentLocale(metadata, goal);

    let businessInformation: ReturnType<typeof selectBusinessFacts> | undefined;
    try {
      const { profile, brandProfile } = await loadCanonicalBusinessContext(task.workspaceId);
      businessInformation = selectBusinessFacts(profile, brandProfile);
    } catch (error) {
      if (!(error instanceof BusinessProfileRequiredError)) throw error;
    }

    const prevAssets = resolvePlatformAssets(existing);
    const previousCaption = prevAssets[platformId]?.caption;
    const gate = await beginPaidMarketingCall(id);
    if (!gate.ok) return apiError("Task AI budget is exhausted", "BUDGET_EXCEEDED", 402);

    let usageRecorded = false;
    try {
      const { asset, usage, failed } = await regeneratePlatformAsset({
        platformId,
        strategy,
        vision,
        campaignName,
        goal,
        userNotes,
        businessInformation,
        contentLocale,
        locale: contentLocale,
        previousCaption,
      });
      await finishPaidMarketingCall(gate.reservation, {
        orgId: task.orgId,
        workspaceId: task.workspaceId,
        agent: "marketing_regenerate",
        usage,
      });
      usageRecorded = true;
      if (failed || !asset?.caption?.trim()) {
        return apiError("Regeneration did not produce usable copy", "REGENERATION_FAILED", 422);
      }

      const contentPackage = applyPlatformRegeneration(existing, platformId, asset, contentLocale);
      const expectedRevision =
        typeof body?.contentRevision === "number" ? body.contentRevision : readMarketingPackRevision(progress);
      const saved = await saveMarketingPackIfCurrent({
        taskId: id,
        expectedRevision,
        contentPackage,
      });
      if (!saved.ok) return apiError("Marketing pack was updated by someone else.", "CONFLICT", 409);
      return apiSuccess({ contentPackage, contentRevision: saved.revision, usage });
    } catch (error) {
      if (!usageRecorded) await cancelPaidMarketingCall(gate.reservation);
      return handleApiError(error);
    }
  } catch (error) {
    return handleApiError(error);
  }
}
