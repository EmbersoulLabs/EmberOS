import { z } from "zod";
import {
  AiStoryCommercialAudioRepository,
  AiStoryGenerationResultRepository,
  AiStoryLocalGenerationRepository,
  CommercialAudioError,
  deterministicPersistenceUuid,
} from "@ceo-agent/db";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { resolveAuthorizedExecutionPlan } from "@/lib/ai-story-execution-plan-access";

type Params = { params: Promise<{ id: string; storyId: string; executionPlanId: string; packageId: string }> };
const Body = z.object({
  trackId: z.string().trim().min(1).max(80).optional(),
}).strict();

/** Queues licensed music onto a copy of the generation video, or records explicit silence. It does not approve review. */
export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, executionPlanId, packageId } = await params;
    const ctx = await resolveAuthorizedExecutionPlan({ userId: user.id, campaignId, storyId, executionPlanId, minRole: "operator" });
    const body = Body.parse(await request.json());
    const packages = new AiStoryLocalGenerationRepository();
    const pkg = await packages.getExecutablePackage({ workspaceId: ctx.workspaceId, executionPlanId, packageId });
    if (!pkg) return apiError("Local Generation package not found", "NOT_FOUND", 404);
    const results = new AiStoryGenerationResultRepository();
    const gpu = await results.findSoleLocalGpuWorkerResult({
      workspaceId: ctx.workspaceId, executionPlanId, sceneExecutionId: pkg.sceneExecutionId, packageId,
    });
    let generationResultId = gpu?.generationResultId ?? null;
    if (!generationResultId) {
      const output = (await packages.listOutputs({ workspaceId: ctx.workspaceId, executionPlanId })).find((item) => item.packageId === packageId);
      if (!output) return apiError("Generation result is not ready", "COMMERCIAL_AUDIO_NOT_ASSEMBLED", 409);
      for (const sourceKind of ["LOCAL_GPU_WORKER", "MANUAL_LOCAL"] as const) {
        const found = await results.get(ctx.workspaceId, deterministicPersistenceUuid("ai-story-generation-result", {
          sourceKind, providerAttemptId: null, localGenerationOutputId: output.outputId, localWorkerOutputId: null,
        }));
        if (found) generationResultId = found.generationResultId;
      }
    }
    if (!generationResultId) return apiError("Generation result is not ready", "COMMERCIAL_AUDIO_NOT_ASSEMBLED", 409);
    const requested = await new AiStoryCommercialAudioRepository().request({
      workspaceId: ctx.workspaceId, executionPlanId, packageId,
      generationResultId, actorUserId: user.id, trackId: body.trackId,
    });
    return apiSuccess({
      finalPolicy: requested.assembly?.finalPolicy ?? requested.decision.finalPolicy,
      blockers: requested.decision.blockers,
      assembly: requested.assembly ? {
        assemblyId: requested.assembly.assemblyId, state: requested.assembly.state,
        trackId: requested.assembly.bgmTrackId, license: requested.assembly.bgmLicense,
      } : null,
    }, requested.assembly?.state === "PENDING" ? 202 : 200);
  } catch (error) {
    if (error instanceof CommercialAudioError) return apiError(error.code, error.code, 409);
    return handleApiError(error);
  }
}
