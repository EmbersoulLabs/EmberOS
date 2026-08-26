/**
 * Sprint 3 Phase 2B PR 2B.4 — Open or return Review / Read Review projection.
 * POST opens (idempotent). GET returns safe read model.
 * Execution remains FAIL CLOSED.
 */
import { ExecutionPlanReviewRepository } from "@ceo-agent/db";
import { withBoundedTimeout } from "@ceo-agent/shared";
import { apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import {
  executionPlanRouteErrorResponse,
  resolveAuthorizedExecutionPlan,
} from "@/lib/ai-story-execution-plan-access";
import { normalizeReviewAssemblyApiError } from "@/lib/ai-story-review-assembly-errors";
import { buildExecutionPlanReviewAssemblyReadModel } from "@/lib/ai-story-review-assembly-read-model";

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
      // The full planning-review projection contains internal execution-plan
      // diagnostics. Product-facing runtime reads remain available separately.
      minRole: "operator",
    });
    const readModel = await buildExecutionPlanReviewAssemblyReadModel(ctx);
    return apiSuccess(readModel);
  } catch (error) {
    return executionPlanRouteErrorResponse(error) ?? handleApiError(normalizeReviewAssemblyApiError(error));
  }
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, executionPlanId } = await params;
    const ctx = await resolveAuthorizedExecutionPlan({
      userId: user.id,
      campaignId,
      storyId,
      executionPlanId,
      minRole: "operator",
    });

    const opened = await withBoundedTimeout(
      new ExecutionPlanReviewRepository(ctx.db).openReview({
        executionPlanId: ctx.executionPlanId,
        openedBy: user.id,
      })
    );
    const readModel = await withBoundedTimeout(
      buildExecutionPlanReviewAssemblyReadModel(ctx)
    );

    return apiSuccess({
      opened,
      ...readModel,
    });
  } catch (error) {
    return executionPlanRouteErrorResponse(error) ?? handleApiError(normalizeReviewAssemblyApiError(error));
  }
}
