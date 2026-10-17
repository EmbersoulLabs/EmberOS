import { z } from "zod";
import {
  LocalGpuSubmitOutcomeError,
  authorizeLocalGpuHumanRetry,
  getDb,
  listLocalGpuSubmitOutcomes,
} from "@ceo-agent/db";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { executionPlanRouteErrorResponse, resolveAuthorizedExecutionPlan } from "@/lib/ai-story-execution-plan-access";
import { autoAuthorizeLocalGpuAfterRelease } from "@/lib/ai-story-local-gpu-authorization-ports";
import { requirePlatformAdmin } from "@/lib/platform-admin-auth";

type RouteParams = { params: Promise<{ id: string; storyId: string; executionPlanId: string; sceneExecutionId: string }> };

const RetryBodySchema = z.object({ expectedAttemptNumber: z.number().int().positive() }).strict();
const UUID = z.string().uuid();

function evidenceView(rows: Awaited<ReturnType<typeof listLocalGpuSubmitOutcomes>>) {
  return rows.map((row) => ({
    jobId: row.jobId,
    attemptNumber: row.attemptNumber,
    kind: row.kind,
    httpStatus: row.httpStatus,
    desktopErrorCode: row.desktopErrorCode,
    desktopErrorMessage: row.desktopErrorMessage,
    uncertainReason: row.uncertainReason,
    diagnostic: row.diagnostic,
    recordedBy: row.recordedBy,
    createdAt: row.createdAt,
  }));
}

/** Immutable LOCAL_GPU submit evidence for one released Scene. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, executionPlanId, sceneExecutionId } = await params;
    if (!UUID.safeParse(sceneExecutionId).success) return apiError("Invalid scene execution id", "VALIDATION_ERROR", 422);
    const ctx = await resolveAuthorizedExecutionPlan({ userId: user.id, campaignId, storyId, executionPlanId, minRole: "operator" });
    const rows = await listLocalGpuSubmitOutcomes(getDb(), { workspaceId: ctx.workspaceId, sceneExecutionId });
    return apiSuccess({ sceneExecutionId, outcomes: evidenceView(rows) });
  } catch (error) {
    return executionPlanRouteErrorResponse(error) ?? handleApiError(error);
  }
}

/**
 * Human-controlled recovery after an authoritative Desktop rejection. It never submits:
 * it opens the next attempt of the same deterministic job, which the Worker claims exactly once.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { user } = await requirePlatformAdmin();
    let body: z.infer<typeof RetryBodySchema>;
    try {
      const parsed = RetryBodySchema.safeParse(JSON.parse(await request.text()));
      if (!parsed.success) return apiError("expectedAttemptNumber is required", "VALIDATION_ERROR", 422);
      body = parsed.data;
    } catch {
      return apiError("Invalid JSON body", "VALIDATION_ERROR", 422);
    }
    const { id: campaignId, storyId, executionPlanId, sceneExecutionId } = await params;
    if (!UUID.safeParse(sceneExecutionId).success) return apiError("Invalid scene execution id", "VALIDATION_ERROR", 422);
    const ctx = await resolveAuthorizedExecutionPlan({ userId: user.id, campaignId, storyId, executionPlanId, minRole: "operator" });
    const retry = await authorizeLocalGpuHumanRetry(getDb(), {
      orgId: ctx.orgId, workspaceId: ctx.workspaceId, executionPlanId, sceneExecutionId,
      actorUserId: user.id, expectedAttemptNumber: body.expectedAttemptNumber,
    });
    const localGpuAuthorization = await autoAuthorizeLocalGpuAfterRelease({
      orgId: ctx.orgId, workspaceId: ctx.workspaceId, campaignId: ctx.campaignId, executionPlanId, actorUserId: user.id,
    });
    console.info("ai_story_local_gpu_human_retry_authorized", {
      executionPlanId, sceneExecutionId, jobId: retry.jobId, attemptNumber: retry.attemptNumber, replayed: retry.replayed,
    });
    return apiSuccess({ ...retry, localGpuAuthorization }, retry.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof LocalGpuSubmitOutcomeError) return apiError(error.code, error.code, error.status);
    return executionPlanRouteErrorResponse(error) ?? handleApiError(error);
  }
}
