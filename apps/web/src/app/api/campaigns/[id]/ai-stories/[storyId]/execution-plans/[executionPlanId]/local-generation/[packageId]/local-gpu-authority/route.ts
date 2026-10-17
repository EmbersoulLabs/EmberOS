import { authorizeLocalGpuPackageDispatch, toLocalGpuAuthorizationError } from "@ceo-agent/agents";
import { AiStoryLocalGenerationRepository } from "@ceo-agent/db";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { resolveAuthorizedExecutionPlan } from "@/lib/ai-story-execution-plan-access";
import { createWebLocalGpuAuthorizationPorts } from "@/lib/ai-story-local-gpu-authorization-ports";
import { requirePlatformAdmin } from "@/lib/platform-admin-auth";

type Params = { params: Promise<{ id: string; storyId: string; executionPlanId: string; packageId: string }> };

/**
 * Explicit, non-generating LOCAL_GPU selection for one immutable package.
 * Browser input contributes only the idempotency key; every authority field is
 * loaded and verified server-side.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { user, assignment } = await requirePlatformAdmin();
    const { id: campaignId, storyId, executionPlanId, packageId } = await params;
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return apiError("A bounded idempotency-key header is required", "VALIDATION_ERROR", 422);
    }
    if ((await request.text()).trim()) {
      return apiError("LOCAL_GPU authority accepts no client authority fields", "EXECUTE_FORBIDDEN_FIELD", 422);
    }

    const ctx = await resolveAuthorizedExecutionPlan({
      userId: user.id, campaignId, storyId, executionPlanId, minRole: "operator",
    });
    const pkg = await new AiStoryLocalGenerationRepository().getExecutablePackage({ workspaceId: ctx.workspaceId, executionPlanId, packageId });
    if (!pkg || pkg.storyId !== storyId || pkg.organizationId !== ctx.orgId || pkg.campaignId !== campaignId) {
      return apiError("Exact released Local Generation package not found", "NOT_FOUND", 404);
    }
    const authority = await authorizeLocalGpuPackageDispatch({
      env: process.env, pkg, orgId: ctx.orgId, workspaceId: ctx.workspaceId, campaignId,
      actorUserId: user.id, platformAdminAssignmentId: assignment.platformAdminAssignmentId,
      idempotencyKey, ports: createWebLocalGpuAuthorizationPorts(),
    });
    return apiSuccess(authority, 202);
  } catch (error) {
    const mapped = toLocalGpuAuthorizationError(error);
    if (mapped) return apiError(mapped.message, mapped.code, mapped.httpStatus);
    return handleApiError(error);
  }
}
