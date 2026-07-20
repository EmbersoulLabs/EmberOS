import {
  getBusinessProfileByWorkspace,
  requireWorkspaceRole,
} from "@ceo-agent/db";
import {
  BusinessProfileAiAnalyzeRequestSchema,
  assessBusinessProfileAiSources,
  isUuid,
  type BusinessProfileAiAnalyzeRequest,
} from "@ceo-agent/shared";
import { executeSkill, AiSkillError } from "@/lib/business-profile-ai";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";

function rowToAnalyzeInput(row: Record<string, unknown>): BusinessProfileAiAnalyzeRequest {
  return {
    companyName: (row.companyName as string | null) ?? null,
    industryId: (row.industryId as string | null) ?? null,
    industryDisplayName: (row.industryDisplayName as string | null) ?? null,
    industryCustomValue: (row.industryCustomValue as string | null) ?? null,
    services: (row.services as string[] | undefined) ?? [],
    businessDescription: (row.businessDescription as string | null) ?? null,
    targetAudience: (row.targetAudience as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    facebook: (row.facebook as string | null) ?? null,
    instagram: (row.instagram as string | null) ?? null,
    tiktok: (row.tiktok as string | null) ?? null,
    youtube: (row.youtube as string | null) ?? null,
    redNote: (row.redNote as string | null) ?? null,
    linkedIn: (row.linkedIn as string | null) ?? null,
    logo: (row.logo as string | null) ?? null,
    brandColors: (row.brandColors as string[] | undefined) ?? [],
    brandKeywords: (row.brandKeywords as string[] | undefined) ?? [],
    brandPersonality: (row.brandPersonality as string[] | undefined) ?? [],
    country: (row.country as string | null) ?? null,
  };
}

function mergeAnalyzeInput(
  base: BusinessProfileAiAnalyzeRequest,
  overlay: BusinessProfileAiAnalyzeRequest
): BusinessProfileAiAnalyzeRequest {
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(overlay).filter(([, value]) => value !== undefined)
    ),
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;

    if (!isUuid(workspaceId)) {
      return apiError("workspace id must be a valid UUID", "VALIDATION_ERROR", 400);
    }

    await requireWorkspaceRole(workspaceId, user.id, "operator");

    const row = await getBusinessProfileByWorkspace(workspaceId);
    if (!row) {
      return apiError("Business profile not found", "NOT_FOUND", 404);
    }

    let body: unknown = {};
    try {
      const text = await request.text();
      if (text.trim()) body = JSON.parse(text);
    } catch {
      return apiError("Invalid JSON body", "VALIDATION_ERROR", 400);
    }

    const parsed = BusinessProfileAiAnalyzeRequestSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid analyze request";
      return apiError(message, "VALIDATION_ERROR", 400);
    }

    const input = mergeAnalyzeInput(
      rowToAnalyzeInput(row as Record<string, unknown>),
      parsed.data
    );

    // Never fail solely because optional fields are empty — only when there is
    // essentially no business signal at all.
    const metaPreview = assessBusinessProfileAiSources(input);
    if (metaPreview.sourcesUsed.length === 0) {
      return apiError(
        "Add a business name, industry, or description before analyzing with AI.",
        "INSUFFICIENT_CONTEXT",
        400
      );
    }

    try {
      const result = await executeSkill("business-profile-analyzer", input);
      // Preserve PD-013 HTTP response shape (no API contract change).
      return apiSuccess({
        brandSummary: result.brandSummary,
        brandPersonality: result.brandPersonality,
        brandTone: result.brandTone,
        brandKeywords: result.brandKeywords,
        targetAudience: result.targetAudience,
        confidence: result.confidence,
        sourcesUsed: result.metadata.sourcesUsed,
        missingSources: result.metadata.missingSources,
        usage: result.metadata.usage,
      });
    } catch (error) {
      if (error instanceof AiSkillError && error.code === "PROVIDER_UNAVAILABLE") {
        return apiError(
          "AI analysis is unavailable right now. Please try again later.",
          "AI_UNAVAILABLE",
          503
        );
      }
      const message = (error as Error).message ?? "AI analysis failed";
      if (/OPENAI_API_KEY/i.test(message)) {
        return apiError(
          "AI analysis is unavailable right now. Please try again later.",
          "AI_UNAVAILABLE",
          503
        );
      }
      return apiError(
        "AI analysis failed. Please try again.",
        "AI_ANALYSIS_FAILED",
        502
      );
    }
  } catch (error) {
    return handleApiError(error);
  }
}
