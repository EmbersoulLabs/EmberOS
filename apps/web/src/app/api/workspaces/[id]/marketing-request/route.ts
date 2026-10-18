import { z } from "zod";
import { getBusinessProfileByWorkspace, requireWorkspaceRole } from "@ceo-agent/db";
import {
  interpretMarketingRequest,
  isUuid,
  normalizeBusinessProfileRecord,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";

const MarketingRequestBodySchema = z.object({
  request: z.string().trim().min(1).max(500),
});

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
    const parsed = MarketingRequestBodySchema.safeParse(await request.json());
    if (!parsed.success) return apiError("Invalid marketing request", "VALIDATION_ERROR", 400);
    const rawProfile = await getBusinessProfileByWorkspace(workspaceId);
    const profile = rawProfile
      ? normalizeBusinessProfileRecord(rawProfile as Record<string, unknown>)
      : null;
    const draft = interpretMarketingRequest(parsed.data.request, {
      companyName: profile?.companyName,
      services: profile?.services,
      businessDescription: profile?.businessDescription,
      targetAudience: profile?.targetAudience,
      city: profile?.city,
    });
    return apiSuccess({
      draft,
      startsPaidGeneration: false,
      mediaGenerationAuthorized: false,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
