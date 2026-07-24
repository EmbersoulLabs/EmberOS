import { eq, and } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { isSubtitleLanguagePair, isSubtitleStylePreset } from "@ceo-agent/shared";
import { isLocale } from "@ceo-agent/shared/i18n";
import { validateCampaignAssetsForRun } from "@/lib/campaign-assets";
import { startOrReuseCampaignRun } from "@/lib/campaign-run";
import { enforceRateLimit } from "@/lib/rate-limit";

const MAX_CONCURRENT_CAMPAIGNS = 2;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const limited = await enforceRateLimit(request, "campaignRun", user.id);
    if (limited) return limited;
    const { id: campaignId } = await params;
    const db = getDb();

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);

    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const processing = await db
      .select()
      .from(schema.campaigns)
      .where(
        and(
          eq(schema.campaigns.orgId, campaign.orgId),
          eq(schema.campaigns.status, "processing")
        )
      );

    // Allow reuse of this campaign's active run even when org concurrency is at cap.
    if (processing.length >= MAX_CONCURRENT_CAMPAIGNS && campaign.status !== "processing") {
      return apiError(
        `Max ${MAX_CONCURRENT_CAMPAIGNS} concurrent campaigns per org`,
        "RATE_LIMIT",
        429
      );
    }

    const assetCheck = await validateCampaignAssetsForRun(db, campaignId, campaign.workspaceId);
    if (!assetCheck.ok) return apiError(assetCheck.error, "VALIDATION_ERROR", 400);

    let contentLocale: string | undefined;
    let renderPreferences: { subtitleStyle: string; subtitleLanguage: string } | undefined;
    try {
      const body = (await request.json()) as {
        locale?: string;
        subtitleStyle?: string;
        subtitleLanguage?: string;
      };
      if (body.locale && isLocale(body.locale)) contentLocale = body.locale;
      if (
        isSubtitleStylePreset(body.subtitleStyle ?? "") &&
        isSubtitleLanguagePair(body.subtitleLanguage ?? "")
      ) {
        renderPreferences = {
          subtitleStyle: body.subtitleStyle!,
          subtitleLanguage: body.subtitleLanguage!,
        };
      }
    } catch {
      /* empty body is fine */
    }

    const result = await startOrReuseCampaignRun(db, campaign, {
      contentLocale,
      renderPreferences,
    });

    if (!result.ok) {
      return apiError(result.error, result.code, result.status);
    }

    return apiSuccess(
      {
        taskId: result.taskId,
        status: result.status,
        reused: result.reused,
      },
      result.reused ? 200 : 202
    );
  } catch (error) {
    return handleApiError(error);
  }
}
