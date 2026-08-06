import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  getDb,
  requireWorkspaceRole,
  schema,
  getBusinessProfileByWorkspace,
} from "@ceo-agent/db";
import {
  CampaignBriefAssistBodySchema,
  isUuid,
  normalizeBusinessProfileRecord,
  type BrandProfile,
} from "@ceo-agent/shared";
import { provideCampaignAIContext } from "@ceo-agent/agents";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { executeSkill, AiSkillError, CAMPAIGN_BRIEF_ASSIST_SKILL_ID } from "@/lib/campaign-brief-assist";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logAiSkillFailure } from "@/lib/ai-skill-log";

function profileSummary(raw: Record<string, unknown>): string {
  const profile = normalizeBusinessProfileRecord(raw);
  const parts = [
    profile.companyName,
    profile.industryDisplayName || profile.industryCustomValue,
    profile.businessDescription,
    profile.targetAudience,
    profile.services?.length ? `Services: ${profile.services.join(", ")}` : null,
    [profile.city, profile.stateProvince, profile.country].filter(Boolean).join(", ") || null,
  ].filter((p): p is string => Boolean(p?.trim()));
  return parts.join("\n").slice(0, 4000);
}

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

    const limited = await enforceRateLimit(request, "campaignBriefAssist", user.id);
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

    const [workspace] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, campaign.workspaceId))
      .limit(1);

    const row = await getBusinessProfileByWorkspace(campaign.workspaceId);
    const businessProfileSummary = row
      ? profileSummary(row as Record<string, unknown>)
      : undefined;

    const objective =
      parsed.data.objective ??
      (campaign.objective === "other"
        ? campaign.objectiveCustom ?? undefined
        : campaign.objective ?? undefined);
    const platforms = parsed.data.platforms ?? campaign.platforms ?? [];
    const targetAudience =
      parsed.data.targetAudience ?? campaign.targetAudienceOverride ?? null;
    const workspaceLanguage =
      parsed.data.workspaceLanguage ??
      campaign.outputLanguage ??
      (workspace?.brandProfile as { locale?: string } | null)?.locale ??
      "en";

    // PD-044 — build complete Campaign AI Context even though Assist may ignore unused fields.
    const campaignContext = provideCampaignAIContext({
      businessProfile: (workspace?.brandProfile ?? {}) as BrandProfile,
      campaignObjective: objective ?? campaign.goal ?? "",
      publishingPlatforms: platforms,
      targetAudience,
      campaignBrief: parsed.data.text,
      workspaceLanguage,
    });

    const correlationId = randomUUID();
    try {
      const result = await executeSkill("campaign-brief-assist", {
        action: parsed.data.action,
        text: parsed.data.text,
        campaignName: parsed.data.campaignName ?? campaign.name,
        objective: campaignContext.campaignObjective || undefined,
        platforms: campaignContext.publishingPlatforms,
        targetAudience: campaignContext.targetAudience ?? undefined,
        businessProfileSummary: businessProfileSummary,
        workspaceLanguage: String(campaignContext.workspaceLanguage),
      });
      return apiSuccess({
        text: result.text,
        action: parsed.data.action,
        // Proposal only — client must Accept before applying to Campaign Brief.
        proposal: true,
      });
    } catch (error) {
      const skillError = error instanceof AiSkillError ? error : null;
      const code = skillError?.code;
      const resultState =
        code === "PROVIDER_UNAVAILABLE"
          ? "unavailable"
          : code === "INVALID_INPUT"
            ? "invalid_input"
            : code === "NORMALIZE_FAILED"
              ? "normalize_failed"
              : "failed";

      logAiSkillFailure({
        correlationId,
        skillId: CAMPAIGN_BRIEF_ASSIST_SKILL_ID,
        action: parsed.data.action,
        campaignId,
        workspaceId: campaign.workspaceId,
        code: code ?? "UNKNOWN",
        resultState,
      });

      if (code === "PROVIDER_UNAVAILABLE") {
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
