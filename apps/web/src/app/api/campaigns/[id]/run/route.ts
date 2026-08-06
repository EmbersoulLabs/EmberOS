import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { isSubtitleLanguagePair, isSubtitleStylePreset } from "@ceo-agent/shared";
import { isLocale } from "@ceo-agent/shared/i18n";
import { executeCampaignGenerate } from "@/lib/campaign-generate";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Compatibility alias — delegates to the authoritative Generate path.
 * Prefer POST /api/campaigns/:id/generate for new callers.
 */
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

    const result = await executeCampaignGenerate(db, campaign, user.id, {
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
        aiInvoked: true,
      },
      result.reused ? 200 : 202
    );
  } catch (error) {
    return handleApiError(error);
  }
}
