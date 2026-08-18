import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { executionPlanRouteErrorResponse } from "@/lib/ai-story-execution-plan-access";
import { createFinalStoryDelivery, FinalStoryDeliveryError } from "@/lib/ai-story-final-story-delivery";

type RouteParams = { params: Promise<{ id: string; storyId: string; executionPlanId: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, executionPlanId } = await params;
    return apiSuccess(await createFinalStoryDelivery({ userId: user.id, campaignId, storyId, executionPlanId }));
  } catch (error) {
    if (error instanceof FinalStoryDeliveryError) return apiError(error.message, error.code, error.status);
    const access = executionPlanRouteErrorResponse(error);
    if (access) return access;
    if (error instanceof Error && error.message === "Failed to create download URL") {
      return apiError("Unable to prepare final video download", "FINAL_STORY_DELIVERY_FAILED", 502);
    }
    return handleApiError(error);
  }
}
