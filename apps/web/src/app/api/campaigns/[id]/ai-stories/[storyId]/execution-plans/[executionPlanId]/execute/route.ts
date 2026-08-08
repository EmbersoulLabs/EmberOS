/**
 * Sprint 3 PR 3.7 Phase D — Canonical product Execute entrypoint.
 *
 * POST /api/campaigns/:id/ai-stories/:storyId/execution-plans/:executionPlanId/execute
 *
 * Sole product-reachable authoritative Execute path.
 * Auth → ownership → authorizeAndExecuteExecutionPlan → STOP at API response.
 * Does NOT call Provider/Worker/Assembly/FSR directly.
 */
import {
  authorizeAndExecuteExecutionPlan,
  CanonicalExecuteError,
} from "@ceo-agent/agents";
import {
  CANONICAL_EXECUTE_FORBIDDEN_BODY_KEYS,
  CanonicalExecuteRequestSchema,
  PHASE1_EXECUTION_LOCKED,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import {
  executionPlanRouteErrorResponse,
  resolveAuthorizedExecutionPlan,
} from "@/lib/ai-story-execution-plan-access";
import { createCanonicalExecuteProviderRouter } from "@/lib/ai-story-canonical-execute-router";

type RouteParams = {
  params: Promise<{ id: string; storyId: string; executionPlanId: string }>;
};

function rejectForbiddenBodyKeys(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  for (const key of CANONICAL_EXECUTE_FORBIDDEN_BODY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return key;
    }
  }
  return null;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, executionPlanId } = await params;

    const raw = await request.text();
    let body: unknown = {};
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        return apiError("Invalid JSON body", "VALIDATION_ERROR", 422);
      }
    }

    const forbidden = rejectForbiddenBodyKeys(body);
    if (forbidden) {
      return apiError(
        `Forbidden Execute authority field: ${forbidden}`,
        "EXECUTE_FORBIDDEN_FIELD",
        422
      );
    }

    const parsed = CanonicalExecuteRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "Canonical Execute accepts an empty object body only",
        "VALIDATION_ERROR",
        422
      );
    }

    const ctx = await resolveAuthorizedExecutionPlan({
      userId: user.id,
      campaignId,
      storyId,
      executionPlanId,
      minRole: "operator",
    });

    const ownership = {
      orgId: ctx.orgId,
      workspaceId: ctx.workspaceId,
      campaignId: ctx.campaignId,
      storyId: ctx.storyId,
      storyVersionId: ctx.plan.storyVersionId,
      animationPackageId: ctx.plan.animationPackageId,
      executionPlanId: ctx.executionPlanId,
    };

    const result = await authorizeAndExecuteExecutionPlan({
      executionPlanId: ctx.executionPlanId,
      actorUserId: user.id,
      ownership,
      router: createCanonicalExecuteProviderRouter(),
    });

    return apiSuccess(
      {
        ...result.response,
        // Explicit lock stamp for legacy-path clarity; selective Execute is allowed.
        phase1LockRemainsOnLegacyPaths: true as const,
        selectiveUnlockPath: "canonical-execute" as const,
        executionLockCode: PHASE1_EXECUTION_LOCKED,
      },
      result.httpStatus
    );
  } catch (error) {
    if (error instanceof CanonicalExecuteError) {
      return apiError(error.message, error.code, error.status);
    }
    return (
      executionPlanRouteErrorResponse(error) ?? handleApiError(error)
    );
  }
}
