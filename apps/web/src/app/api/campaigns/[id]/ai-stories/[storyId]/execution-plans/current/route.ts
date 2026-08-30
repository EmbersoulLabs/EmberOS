import { apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import {
  executionPlanRouteErrorResponse,
} from "@/lib/ai-story-execution-plan-access";
import {
  AmbiguousCurrentExecutionPlanError,
  discoverCurrentExecutionPlan,
} from "@/lib/ai-story-execution-plan-discovery";

type RouteParams = { params: Promise<{ id: string; storyId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId } = await params;
    return apiSuccess(
      await discoverCurrentExecutionPlan({ userId: user.id, campaignId, storyId })
    );
  } catch (error) {
    if (error instanceof AmbiguousCurrentExecutionPlanError) {
      return new Response(JSON.stringify({ error: error.message, code: error.code }), {
        status: error.status,
        headers: { "content-type": "application/json" },
      });
    }
    return executionPlanRouteErrorResponse(error) ?? handleApiError(error);
  }
}
