import { eq } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { CampaignBriefAssistBodySchema, isUuid } from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { assistCampaignBrief } from "@/lib/campaign-brief-assist";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId } = await params;
    if (!isUuid(campaignId)) {
      return apiError("Invalid campaign id", "VALIDATION_ERROR", 400);
    }

    const limited = await enforceRateLimit(request, "uploadUrl", user.id);
    if (limited) return limited;

    const parsed = CampaignBriefAssistBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message ?? "Invalid request",
        "VALIDATION_ERROR",
        400
      );
    }

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    try {
      const text = await assistCampaignBrief({
        action: parsed.data.action,
        text: parsed.data.text,
        campaignName: parsed.data.campaignName ?? campaign.name,
        objective:
          parsed.data.objective ??
          (campaign.objective === "other"
            ? campaign.objectiveCustom ?? undefined
            : campaign.objective ?? undefined),
      });
      return apiSuccess({ text, action: parsed.data.action });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Brief assist failed";
      if (/OPENAI_API_KEY/i.test(message)) {
        return apiError(
          "AI writing assist is temporarily unavailable. Try again later.",
          "AI_UNAVAILABLE",
          503
        );
      }
      return apiError(
        "We could not update the Campaign Brief. Your text was preserved — retry when ready.",
        "BRIEF_ASSIST_FAILED",
        502
      );
    }
  } catch (error) {
    return handleApiError(error);
  }
}
