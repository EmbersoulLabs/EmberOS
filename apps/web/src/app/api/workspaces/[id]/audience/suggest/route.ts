import { randomUUID } from "node:crypto";
import { requireWorkspaceRole, getBusinessProfileByWorkspace } from "@ceo-agent/db";
import {
  TargetAudienceSuggestBodySchema,
  isUuid,
  normalizeBusinessProfileRecord,
} from "@ceo-agent/shared";
import { executeSkill, AiSkillError, TARGET_AUDIENCE_SUGGEST_SKILL_ID } from "@ceo-agent/agents";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
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
    const { id: workspaceId } = await params;
    if (!isUuid(workspaceId)) {
      return apiError("Invalid workspace id", "VALIDATION_ERROR", 400);
    }

    const limited = await enforceRateLimit(request, "targetAudienceSuggest", user.id);
    if (limited) return limited;

    await requireWorkspaceRole(workspaceId, user.id, "operator");

    const parsed = TargetAudienceSuggestBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message ?? "Invalid request",
        "VALIDATION_ERROR",
        400
      );
    }

    const row = await getBusinessProfileByWorkspace(workspaceId);
    const businessProfileSummary = row
      ? profileSummary(row as Record<string, unknown>)
      : undefined;

    const correlationId = randomUUID();
    try {
      const result = await executeSkill("target-audience-suggest", {
        objective: parsed.data.objective,
        platforms: parsed.data.platforms,
        description: parsed.data.description,
        businessProfileSummary,
        workspaceLanguage: parsed.data.workspaceLanguage,
        currentAudience: parsed.data.currentAudience,
      });
      return apiSuccess({
        text: result.text,
        proposal: true,
      });
    } catch (error) {
      const skillError = error instanceof AiSkillError ? error : null;
      const code = skillError?.code;
      logAiSkillFailure({
        correlationId,
        skillId: TARGET_AUDIENCE_SUGGEST_SKILL_ID,
        action: "suggest",
        workspaceId,
        code: code ?? "UNKNOWN",
        resultState:
          code === "PROVIDER_UNAVAILABLE"
            ? "unavailable"
            : code === "INVALID_INPUT"
              ? "invalid_input"
              : code === "NORMALIZE_FAILED"
                ? "normalize_failed"
                : "failed",
      });
      if (code === "PROVIDER_UNAVAILABLE") {
        return apiError(
          "AI audience suggest is temporarily unavailable. Try again later.",
          "AI_UNAVAILABLE",
          503
        );
      }
      return apiError(
        "We could not suggest a Target Audience. Your text was preserved — retry when ready.",
        "AUDIENCE_SUGGEST_FAILED",
        502
      );
    }
  } catch (error) {
    return handleApiError(error);
  }
}
