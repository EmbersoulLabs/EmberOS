/**
 * Sprint 3 Phase 2B PR 2B.4 — Create or return / Read Assembly Definition.
 * Allowed only when Review is APPROVED (repository enforced). Never unlocks execution.
 */
import { ExecutionPlanAssemblyRepository, ExecutionPlanReviewRepository } from "@ceo-agent/db";
import {
  AssemblyDefinitionCreateRequestSchema,
  PHASE1_EXECUTION_LOCKED,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
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
      minRole: "client_viewer",
    });

    const readModel = await buildExecutionPlanReviewAssemblyReadModel(ctx);
    return apiSuccess({
      assemblyDefinitionId: readModel.assemblyDefinition.id,
      executionPlanId: ctx.executionPlanId,
      sceneCount: readModel.assemblyDefinition.sceneCount,
      orderedSceneMemberships: readModel.assemblyDefinition.memberships,
      integrityHash: readModel.assemblyDefinition.integrityHash,
      assemblyPrerequisiteState: readModel.assemblyDefinition.prerequisites,
      executionReadiness: readModel.executionReadiness,
      executionAllowed: false as const,
      executionLockCode: PHASE1_EXECUTION_LOCKED,
      assemblyDefinition: readModel.assemblyDefinition,
      executionPlan: readModel.executionPlan,
      review: {
        status: readModel.review.status,
      },
    });
  } catch (error) {
    return executionPlanRouteErrorResponse(error) ?? handleApiError(normalizeReviewAssemblyApiError(error));
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, executionPlanId } = await params;

    const raw = await request.text();
    const body = raw.trim() ? JSON.parse(raw) : {};
    const parsed = AssemblyDefinitionCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("Invalid assembly definition payload", "VALIDATION_ERROR", 422);
    }

    const ctx = await resolveAuthorizedExecutionPlan({
      userId: user.id,
      campaignId,
      storyId,
      executionPlanId,
      minRole: "operator",
    });

    const review = await new ExecutionPlanReviewRepository(ctx.db).getLogicalProjection(
      ctx.executionPlanId
    );
    if (!review || review.status !== "APPROVED") {
      return apiError(
        "Story Assembly Definition requires an APPROVED logical Review for this Execution Plan",
        "ASSEMBLY_STATE_INVALID",
        409
      );
    }

    const created = await new ExecutionPlanAssemblyRepository(ctx.db).createOrReturnAssembly({
      executionPlanId: ctx.executionPlanId,
      createdBy: user.id,
      orderedSceneExecutionIds: parsed.data.orderedSceneExecutionIds,
    });
    const readModel = await buildExecutionPlanReviewAssemblyReadModel(ctx);

    return apiSuccess({
      definition: created.definition,
      memberships: created.memberships,
      replayed: created.replayed,
      ...readModel,
      executionAllowed: false as const,
      executionLockCode: PHASE1_EXECUTION_LOCKED,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return apiError("Invalid JSON body", "VALIDATION_ERROR", 422);
    }
    return executionPlanRouteErrorResponse(error) ?? handleApiError(normalizeReviewAssemblyApiError(error));
  }
}
