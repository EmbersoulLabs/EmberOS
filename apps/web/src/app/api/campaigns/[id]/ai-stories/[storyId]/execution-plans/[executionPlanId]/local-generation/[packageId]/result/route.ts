import { AiStoryGenerationResultRepository, AiStoryLocalGenerationRepository, deterministicPersistenceUuid } from "@ceo-agent/db";
import { AiStoryGenerationResultService, buildGenerationResultPostQcInput } from "@ceo-agent/agents";
import { AiStoryPostQcObservationSchema } from "@ceo-agent/shared";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { requireAuth, handleApiError } from "@/lib/auth";
import { resolveAuthorizedExecutionPlan } from "@/lib/ai-story-execution-plan-access";
import { deriveApprovedGenerationResultContinuity } from "@/lib/ai-story-generation-result-continuity";
import { createAdminClient } from "@/lib/supabase/admin";

type Params = { params: Promise<{ id: string; storyId: string; executionPlanId: string; packageId: string }> };
async function resolve(params: Params["params"], role: "operator" | "client_viewer") {
  const user = await requireAuth();
  const { id: campaignId, storyId, executionPlanId, packageId } = await params;
  const ctx = await resolveAuthorizedExecutionPlan({ userId: user.id, campaignId, storyId, executionPlanId, minRole: role });
  const packages = new AiStoryLocalGenerationRepository();
  const pkg = await packages.getPackage({ workspaceId: ctx.workspaceId, executionPlanId, packageId });
  const output = (await packages.listOutputs({ workspaceId: ctx.workspaceId, executionPlanId })).find(item => item.packageId === packageId);
  if (!pkg || !output) throw new Error("GENERATION_RESULT_NOT_FOUND");
  const results = new AiStoryGenerationResultRepository();
  const resultId = deterministicPersistenceUuid("ai-story-generation-result", {
    sourceKind: "MANUAL_LOCAL", providerAttemptId: null, localGenerationOutputId: output.outputId, localWorkerOutputId: null,
  });
  const result = await results.get(ctx.workspaceId, resultId);
  if (!result) throw new Error("GENERATION_RESULT_NOT_FOUND");
  return { user, pkg, result, results };
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { pkg, result, results } = await resolve(params, "client_viewer");
    const playback=await createAdminClient().storage.from(process.env.SUPABASE_STORAGE_BUCKET??"campaign-assets")
      .createSignedUrl(result.media.storagePath,600);
    return apiSuccess({
      generationResultId: result.generationResultId,
      sourceKind: result.source.sourceKind,
      playbackUrl:playback.error?null:playback.data?.signedUrl??null,
      requirements: buildGenerationResultPostQcInput(result, pkg).requirements,
      evaluation: await results.latestQc(result.ownership.workspaceId, result.generationResultId),
      decision: await results.decision(result.generationResultId),
      continuityFrame: await results.continuityFrame(result.ownership.workspaceId,result.generationResultId),
    });
  } catch (error) { return handleApiError(error); }
}

const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("EVALUATE"), observations: z.array(AiStoryPostQcObservationSchema).max(100) }).strict(),
  z.object({ action: z.literal("APPROVE"), rationale: z.string().trim().min(1).max(3000) }).strict(),
  z.object({ action: z.literal("DERIVE_CONTINUITY") }).strict(),
]);

export async function POST(request: Request, { params }: Params) {
  try {
    const { user, pkg, result } = await resolve(params, "operator");
    const command = Command.parse(await request.json());
    const service = new AiStoryGenerationResultService();
    if (command.action === "DERIVE_CONTINUITY") return apiSuccess(await deriveApprovedGenerationResultContinuity(result,user.id));
    if (command.action === "APPROVE") {
      const approved=await service.approve(result, user.id, command.rationale);
      const continuityJob=await deriveApprovedGenerationResultContinuity(result,user.id);
      return apiSuccess({...approved,continuityJobId:continuityJob.jobId});
    }
    const allowed = new Set(buildGenerationResultPostQcInput(result, pkg).requirements.map(item => item.requirementId));
    if (command.observations.some(item => item.source !== "HUMAN_SUPPLIED_EVIDENCE" || !allowed.has(item.requirementId))) {
      return apiError("QC evidence does not match this Generation Unit", "POST_QC_EVIDENCE_INVALID", 422);
    }
    return apiSuccess(await service.evaluateLocal(result, pkg, {
      providerId: "human-supplied-evidence", contractVersion: "ai-story-visual-evidence.v1",
      analyze: async () => command.observations,
    }, user.id));
  } catch (error) {
    if (error instanceof Error && /^(GENERATION_RESULT_|GENERATED_SCENE_POST_QC_|LOCAL_RETRY_)/.test(error.message)) {
      return apiError("Generated media authority or QC is not ready for this action", error.message, 409);
    }
    return handleApiError(error);
  }
}
