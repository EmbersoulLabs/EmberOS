import { CreateCampaignContextSchema } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { createCampaignAndStartWorkflow } from "@/lib/create-campaign-command";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireControlledSelfUseWorkspaceOperator } from "@/lib/controlled-self-use-workspace-access";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const limited = await enforceRateLimit(request, "campaignRun", user.id);
    if (limited) return limited;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError("Invalid JSON body", "VALIDATION_ERROR", 400);
    }
    const parsed = CreateCampaignContextSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message ?? "Invalid Campaign context",
        "VALIDATION_ERROR",
        400
      );
    }

    const workspaceAuthority = await requireControlledSelfUseWorkspaceOperator({
      request,
      userId: user.id,
      workspaceId: parsed.data.workspaceId,
      capabilityKey: "campaign.generate",
      providerKey: "openai",
    });
    try {
      const result = await createCampaignAndStartWorkflow({
        orgId: workspaceAuthority.orgId,
        userId: user.id,
        context: parsed.data,
      });
      if (!result.ok) {
        return apiError(result.error, result.code, result.status);
      }
      return apiSuccess(result, result.campaignReused ? 200 : 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/outside the authorized Workspace|not eligible/i.test(message)) {
        return apiError(
          "Asset reference is outside the authorized Workspace",
          "CAMPAIGN_ASSET_REF_DENIED",
          403
        );
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
