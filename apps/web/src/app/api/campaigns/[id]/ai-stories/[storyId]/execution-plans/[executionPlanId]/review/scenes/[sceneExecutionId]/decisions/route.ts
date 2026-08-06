/**
 * Sprint 3 Phase 2B PR 2B.4 — Append Scene Intent review decision (append-only).
 * Reviewer identity always comes from authenticated context.
 */
import { ExecutionPlanReviewRepository } from "@ceo-agent/db";
import { isUuid, ReviewDecisionRequestSchema } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import {
  executionPlanRouteErrorResponse,
  resolveAuthorizedExecutionPlan,
} from "@/lib/ai-story-execution-plan-access";
import { normalizeReviewAssemblyApiError } from "@/lib/ai-story-review-assembly-errors";
import { buildExecutionPlanReviewAssemblyReadModel } from "@/lib/ai-story-review-assembly-read-model";

type RouteParams = {
  params: Promise<{
    id: string;
    storyId: string;
    executionPlanId: string;
    sceneExecutionId: string;
  }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, executionPlanId, sceneExecutionId } = await params;
    if (!isUuid(sceneExecutionId)) {
      return apiError("Invalid sceneExecutionId", "VALIDATION_ERROR", 400);
    }

    const body = await request.json().catch(() => null);
    if (body && typeof body === "object" && "reviewedBy" in body) {
      return apiError(
        "reviewedBy cannot be supplied by the client",
        "VALIDATION_ERROR",
        400
      );
    }
    if (body && typeof body === "object" && "reviewerId" in body) {
      return apiError(
        "reviewerId cannot be supplied by the client",
        "VALIDATION_ERROR",
        400
      );
    }

    const parsed = ReviewDecisionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("Invalid review decision payload", "VALIDATION_ERROR", 422);
    }

    const ctx = await resolveAuthorizedExecutionPlan({
      userId: user.id,
      campaignId,
      storyId,
      executionPlanId,
      minRole: "operator",
    });

    const decision = await new ExecutionPlanReviewRepository(ctx.db).appendSceneIntentDecision({
      executionPlanId: ctx.executionPlanId,
      sceneExecutionId,
      decision: parsed.data.decision,
      reviewedBy: user.id,
      rationale: parsed.data.comment ?? parsed.data.rationale,
    });
    const readModel = await buildExecutionPlanReviewAssemblyReadModel(ctx);

    return apiSuccess({
      decision,
      ...readModel,
    });
  } catch (error) {
    return executionPlanRouteErrorResponse(error) ?? handleApiError(normalizeReviewAssemblyApiError(error));
  }
}
