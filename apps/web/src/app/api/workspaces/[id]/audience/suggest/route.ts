import { z } from "zod";
import { callStructuredJsonModel } from "@ceo-agent/agents";
import { getBusinessProfileByWorkspace, requireWorkspaceRole } from "@ceo-agent/db";
import {
  CampaignAudienceSuggestBodySchema,
  isUuid,
  normalizeBusinessProfileRecord,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";

const SuggestionSchema = z.object({ text: z.string().trim().min(1).max(2000) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    if (!isUuid(workspaceId)) return apiError("Invalid Workspace", "VALIDATION_ERROR", 400);
    const limited = await enforceRateLimit(request, "campaignAssist", user.id);
    if (limited) return limited;
    await requireWorkspaceRole(workspaceId, user.id, "operator");
    const parsed = CampaignAudienceSuggestBodySchema.safeParse(await request.json());
    if (!parsed.success) return apiError("Invalid suggestion request", "VALIDATION_ERROR", 400);

    const rawProfile = await getBusinessProfileByWorkspace(workspaceId);
    const profile = normalizeBusinessProfileRecord((rawProfile ?? {}) as Record<string, unknown>);
    // Controlled self-use deliberately rejects provider HTTP calls that do not
    // carry a persisted execution/certification grant. Campaign assistance is
    // an optional authoring aid, so fail before the provider boundary with an
    // actionable response instead of allowing that denial to become a generic
    // INTERNAL_ERROR.
    if (process.env.AI_STORY_PROVIDER_DISPATCH_MODE === "allowlisted_self_use") {
      return apiError(
        "AI audience suggestions are unavailable while controlled self-use mode is active. Enter the target audience manually or ask a Platform Superadmin to enable an authorized Campaign-assistance provider path.",
        "AI_UNAVAILABLE",
        503,
      );
    }
    const completion = await callStructuredJsonModel({
      system:
        "Suggest one concise, concrete campaign target audience. Return JSON only. Do not persist or claim the suggestion was accepted.",
      user: JSON.stringify({
        objective: parsed.data.objective,
        platforms: parsed.data.platforms,
        campaignBrief: parsed.data.campaignBrief,
        currentAudience: parsed.data.currentAudience,
        language: parsed.data.workspaceLanguage,
        business: {
          name: profile.companyName,
          industry: profile.industryDisplayName || profile.industryCustomValue,
          description: profile.businessDescription,
          existingAudience: profile.targetAudience,
        },
      }),
      schema: SuggestionSchema,
      schemaName: "campaign_target_audience_suggestion",
      maxOutputTokens: 300,
    });
    if (completion.decodeIssue) {
      return apiError("Audience suggestion is unavailable", "AI_UNAVAILABLE", 503);
    }
    const result = SuggestionSchema.safeParse(completion.result);
    if (!result.success) return apiError("Audience suggestion failed", "AI_OUTPUT_INVALID", 502);
    return apiSuccess({ text: result.data.text, proposal: true });
  } catch (error) {
    return handleApiError(error);
  }
}
