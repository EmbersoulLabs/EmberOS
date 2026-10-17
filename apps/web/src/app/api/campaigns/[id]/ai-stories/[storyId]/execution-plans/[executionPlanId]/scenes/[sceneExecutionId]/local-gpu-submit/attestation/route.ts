import { z } from "zod";
import {
  LocalGpuCloudAdapter,
  loadLocalGpuConfigFromEnv,
  newLocalGpuEvidenceChallenge,
} from "@ceo-agent/agents";
import {
  LocalGpuSubmitOutcomeError,
  getDb,
  readLocalGpuAttestationScope,
  recordLocalGpuNonAcceptanceAttestation,
} from "@ceo-agent/db";
import { LocalGpuContractError } from "@ceo-agent/shared/server";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { executionPlanRouteErrorResponse, resolveAuthorizedExecutionPlan } from "@/lib/ai-story-execution-plan-access";
import { requirePlatformAdmin } from "@/lib/platform-admin-auth";

type RouteParams = { params: Promise<{ id: string; storyId: string; executionPlanId: string; sceneExecutionId: string }> };

const BodySchema = z.object({ expectedAttemptNumber: z.number().int().positive() }).strict();
const UUID = z.string().uuid();

/**
 * Requests Desktop's signed submission evidence for the Scene's submitted job and, only when it
 * verifiably proves the job was never enqueued, appends it to the outcome ledger. It never submits
 * and never authorizes a retry; that stays a separate human action.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { user } = await requirePlatformAdmin();
    let body: z.infer<typeof BodySchema>;
    try {
      const parsed = BodySchema.safeParse(JSON.parse(await request.text()));
      if (!parsed.success) return apiError("expectedAttemptNumber is required", "VALIDATION_ERROR", 422);
      body = parsed.data;
    } catch {
      return apiError("Invalid JSON body", "VALIDATION_ERROR", 422);
    }
    const { id: campaignId, storyId, executionPlanId, sceneExecutionId } = await params;
    if (!UUID.safeParse(sceneExecutionId).success) return apiError("Invalid scene execution id", "VALIDATION_ERROR", 422);
    const ctx = await resolveAuthorizedExecutionPlan({ userId: user.id, campaignId, storyId, executionPlanId, minRole: "operator" });
    const db = getDb();
    const scope = { orgId: ctx.orgId, workspaceId: ctx.workspaceId, executionPlanId, sceneExecutionId };
    const target = await readLocalGpuAttestationScope(db, scope);
    if (target.state.attemptNumber !== body.expectedAttemptNumber) {
      return apiError("LOCAL_GPU_RETRY_ATTEMPT_STALE", "LOCAL_GPU_RETRY_ATTEMPT_STALE", 409);
    }
    if (target.state.terminal !== "STATUS_NOT_FOUND_EXHAUSTED") {
      return apiError("LOCAL_GPU_ATTESTATION_NOT_APPLICABLE", "LOCAL_GPU_ATTESTATION_NOT_APPLICABLE", 409);
    }
    const config = loadLocalGpuConfigFromEnv(process.env);
    if (!config.enabled || !config.environment || !config.signingSecret) {
      return apiError("LOCAL_GPU_ATTESTATION_UNAVAILABLE", "LOCAL_GPU_ATTESTATION_UNAVAILABLE", 503);
    }
    const adapter = new LocalGpuCloudAdapter(config, async (attempt) => {
      const response = await fetch(attempt.url, { method: attempt.method, headers: attempt.headers, body: attempt.body, cache: "no-store" });
      return { status: response.status, body: await response.text() };
    });
    const challenge = newLocalGpuEvidenceChallenge();
    const fetched = await adapter.submissionEvidence(target.jobId, {
      actor: { userId: user.id, workspaceId: ctx.workspaceId, organizationPlan: null, platformAdminStatus: "ACTIVE_GRANT" },
      workspaceId: ctx.workspaceId,
      sceneExecutionId,
      workflow: target.workflow,
      challenge,
    });
    if (!fetched.available) {
      return apiError("LOCAL_GPU_ATTESTATION_UNAVAILABLE", "LOCAL_GPU_ATTESTATION_UNAVAILABLE", 503);
    }
    const { evidence } = fetched;
    console.info("ai_story_local_gpu_submission_evidence", {
      executionPlanId, sceneExecutionId, jobId: target.jobId, attemptNumber: target.state.attemptNumber,
      verdict: evidence.verdict, basis: evidence.basis, desktopVersion: evidence.desktopVersion,
    });
    if (evidence.verdict === "ACCEPTED") {
      const code = evidence.jobStatus === "COMPLETED" ? "LOCAL_GPU_JOB_ALREADY_COMPLETED" : "LOCAL_GPU_JOB_PREVIOUSLY_ACCEPTED";
      return apiError(code, code, 409);
    }
    if (evidence.verdict !== "REJECTED_BEFORE_ENQUEUE") {
      return apiError("LOCAL_GPU_NON_ACCEPTANCE_UNPROVEN", "LOCAL_GPU_NON_ACCEPTANCE_UNPROVEN", 409);
    }
    const recorded = await recordLocalGpuNonAcceptanceAttestation(db, {
      ...scope,
      actorUserId: user.id,
      expectedAttemptNumber: body.expectedAttemptNumber,
      expectedJobId: target.jobId,
      attestation: {
        verdict: "REJECTED_BEFORE_ENQUEUE",
        basis: evidence.basis ?? "",
        attestationDigest: fetched.digest,
        challenge,
        issuedAt: evidence.issuedAt,
        desktopVersion: evidence.desktopVersion,
        submitAuthorizationCount: evidence.submitAuthorizationCount,
        lastSubmitAuthorizationAt: evidence.lastSubmitAuthorizationAt,
        rejection: evidence.rejection,
      },
    });
    return apiSuccess({ ...recorded, verdict: evidence.verdict, basis: evidence.basis }, recorded.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof LocalGpuSubmitOutcomeError) return apiError(error.code, error.code, error.status);
    if (error instanceof LocalGpuContractError && (error.message === "LOCAL_GPU_ATTESTATION_INVALID" || error.message === "LOCAL_GPU_ATTESTATION_STALE")) {
      return apiError(error.message, error.message, 502);
    }
    return executionPlanRouteErrorResponse(error) ?? handleApiError(error);
  }
}
