/**
 * Sprint 3 Phase 2B PR 2B.4 — Review history (derived from append-only facts).
 */
import { apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import {
  executionPlanRouteErrorResponse,
  resolveAuthorizedExecutionPlan,
} from "@/lib/ai-story-execution-plan-access";
import { normalizeReviewAssemblyApiError } from "@/lib/ai-story-review-assembly-errors";
import { buildReviewHistoryReadModel } from "@/lib/ai-story-review-assembly-read-model";

type RouteParams = { params: Promise<{ id: string; storyId: string; executionPlanId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, executionPlanId } = await params;
    const ctx = await resolveAuthorizedExecutionPlan({
      userId: user.id,
      campaignId,
      storyId,
      executionPlanId,
      minRole: "client_viewer",
    });
    const history = await buildReviewHistoryReadModel(ctx);
    return apiSuccess(history);
  } catch (error) {
    return executionPlanRouteErrorResponse(error) ?? handleApiError(normalizeReviewAssemblyApiError(error));
  }
}
