import { z } from "zod";
import { callStructuredJsonModel } from "@ceo-agent/agents";
import { getBusinessProfileByWorkspace, requireWorkspaceRole } from "@ceo-agent/db";
import {
  CampaignBriefAssistBodySchema,
  isUuid,
  normalizeBusinessProfileRecord,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";

const BriefResultSchema = z.object({ text: z.string().trim().min(1).max(10000) });

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
    const parsed = CampaignBriefAssistBodySchema.safeParse(await request.json());
    if (!parsed.success) return apiError("Invalid Brief request", "VALIDATION_ERROR", 400);
    const rawProfile = await getBusinessProfileByWorkspace(workspaceId);
    const profile = normalizeBusinessProfileRecord((rawProfile ?? {}) as Record<string, unknown>);
    const completion = await callStructuredJsonModel({
      system:
        "Rewrite the supplied Campaign Brief using only the requested action. Preserve facts and intent. Return JSON only. This is a proposal requiring human acceptance.",
      user: JSON.stringify({
        action: parsed.data.action,
        text: parsed.data.text,
        campaignName: parsed.data.campaignName,
        objective: parsed.data.objective,
        platforms: parsed.data.platforms,
        targetAudience: parsed.data.targetAudience,
        language: parsed.data.workspaceLanguage,
        business: {
          name: profile.companyName,
          industry: profile.industryDisplayName || profile.industryCustomValue,
          description: profile.businessDescription,
        },
      }),
      schema: BriefResultSchema,
      schemaName: "campaign_brief_assist_proposal",
    });
    if (completion.decodeIssue) return apiError("Brief assistance is unavailable", "AI_UNAVAILABLE", 503);
    const result = BriefResultSchema.safeParse(completion.result);
    if (!result.success) return apiError("Brief assistance failed", "AI_OUTPUT_INVALID", 502);
    return apiSuccess({ text: result.data.text, action: parsed.data.action, proposal: true });
  } catch (error) {
    return handleApiError(error);
  }
}
