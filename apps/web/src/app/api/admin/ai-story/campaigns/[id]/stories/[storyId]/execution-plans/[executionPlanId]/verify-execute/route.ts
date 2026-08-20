import {
  authorizeAndExecuteExecutionPlan,
  authorizeAiStoryExecution,
  AiStoryExecutionDeniedError,
  CanonicalExecuteError,
  resolveCanonicalExecuteRoutingPolicy,
} from "@ceo-agent/agents";
import { AI_STORY_PRODUCTION_VERIFICATION_POLICY_VERSION } from "@ceo-agent/db";
import { CanonicalExecuteRequestSchema, PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import {
  executionPlanRouteErrorResponse,
  resolveAuthorizedExecutionPlan,
} from "@/lib/ai-story-execution-plan-access";
import { createCanonicalExecuteProviderRouter } from "@/lib/ai-story-canonical-execute-router";
import { requirePlatformAdmin } from "@/lib/platform-admin-auth";

type RouteParams = {
  params: Promise<{ id: string; storyId: string; executionPlanId: string }>;
};

/**
 * PROD-VERIFY-01 server capability.
 *
 * This is deliberately a separate Platform Admin route, not a mode or flag on
 * product Execute. It runs the canonical service while binding the resulting
 * outbox to a durable, initially-CANCELLED verification identity.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { user } = await requirePlatformAdmin();
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
    if (!CanonicalExecuteRequestSchema.safeParse(body).success) {
      return apiError(
        "Production verification Execute accepts an empty object body only",
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
    const executionAuthorization = await authorizeAiStoryExecution({
      user,
      orgId: ctx.orgId,
      workspaceId: ctx.workspaceId,
      minRole: "operator",
      clientClaims: {},
    });
    if (executionAuthorization.authorizedBy !== "ACTIVE_PLATFORM_ADMIN") {
      return apiError(
        "Production verification requires an active Platform Admin grant",
        "AI_STORY_PRODUCTION_VERIFICATION_DENIED",
        403
      );
    }

    const result = await authorizeAndExecuteExecutionPlan({
      executionPlanId: ctx.executionPlanId,
      actorUserId: user.id,
      ownership: {
        orgId: ctx.orgId,
        workspaceId: ctx.workspaceId,
        campaignId: ctx.campaignId,
        storyId: ctx.storyId,
        storyVersionId: ctx.plan.storyVersionId,
        animationPackageId: ctx.plan.animationPackageId,
        executionPlanId: ctx.executionPlanId,
      },
      router: createCanonicalExecuteProviderRouter(),
      routingPolicy: resolveCanonicalExecuteRoutingPolicy(),
      executionAuthorization,
      productionVerification: {
        verificationMode: true,
        verificationPolicyVersion:
          AI_STORY_PRODUCTION_VERIFICATION_POLICY_VERSION,
        authorizedBy: "ACTIVE_PLATFORM_ADMIN",
        createdBy: user.id,
      },
    });

    return apiSuccess(
      {
        ...result.response,
        verificationMode: true as const,
        verificationPolicyVersion:
          AI_STORY_PRODUCTION_VERIFICATION_POLICY_VERSION,
        providerDispatchSuppressed: true as const,
        executionLockCode: PHASE1_EXECUTION_LOCKED,
      },
      result.httpStatus
    );
  } catch (error) {
    if (error instanceof AiStoryExecutionDeniedError) {
      return apiError(error.message, error.code, error.status);
    }
    if (error instanceof CanonicalExecuteError) {
      return apiError(error.message, error.code, error.status);
    }
    return executionPlanRouteErrorResponse(error) ?? handleApiError(error);
  }
}
