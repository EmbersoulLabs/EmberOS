/**
 * Sprint 3 Phase 2B PR 2B.4 — Append Story-level review decision (append-only).
 * Approval does not unlock execution.
 */
import { ExecutionPlanReviewRepository } from "@ceo-agent/db";
import { ReviewDecisionRequestSchema } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import {
  executionPlanRouteErrorResponse,
  resolveAuthorizedExecutionPlan,
} from "@/lib/ai-story-execution-plan-access";
import { normalizeReviewAssemblyApiError } from "@/lib/ai-story-review-assembly-errors";
import { buildExecutionPlanReviewAssemblyReadModel } from "@/lib/ai-story-review-assembly-read-model";

type RouteParams = { params: Promise<{ id: string; storyId: string; executionPlanId: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, executionPlanId } = await params;

    const body = await request.json().catch(() => null);
    if (body && typeof body === "object" && ("reviewedBy" in body || "reviewerId" in body)) {
      return apiError(
        "reviewer identity cannot be supplied by the client",
        "VALIDATION_ERROR",
        400
      );
    }

    const parsed = ReviewDecisionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("Invalid story review decision payload", "VALIDATION_ERROR", 422);
    }

    const ctx = await resolveAuthorizedExecutionPlan({
      userId: user.id,
      campaignId,
      storyId,
      executionPlanId,
      minRole: "operator",
    });

    const decision = await new ExecutionPlanReviewRepository(ctx.db).appendStoryDecision({
      executionPlanId: ctx.executionPlanId,
      decision: parsed.data.decision,
      reviewedBy: user.id,
      rationale: parsed.data.comment ?? parsed.data.rationale,
    });
    const readModel = await buildExecutionPlanReviewAssemblyReadModel(ctx);

    return apiSuccess({
      decision,
      ...readModel,
      executionAllowed: false as const,
    });
  } catch (error) {
    return executionPlanRouteErrorResponse(error) ?? handleApiError(normalizeReviewAssemblyApiError(error));
  }
}
