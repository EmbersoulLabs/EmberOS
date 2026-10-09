import { and, eq } from "drizzle-orm";
import { AiStoryGenerationResultRepository, AiStoryLocalGenerationRepository, AiStoryLocalMediaJobRepository, deterministicPersistenceUuid, getDb, schema, validateGenerationResult } from "@ceo-agent/db";
import { AiStoryGenerationResultService, AiStoryLocalGenerationService, buildGenerationResultPostQcInput } from "@ceo-agent/agents";
import { AiStoryPostQcObservationSchema } from "@ceo-agent/shared";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { requireAuth, handleApiError } from "@/lib/auth";
import { resolveAuthorizedExecutionPlan } from "@/lib/ai-story-execution-plan-access";
import { deriveApprovedGenerationResultContinuity } from "@/lib/ai-story-generation-result-continuity";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCurrentSceneProductMaterialForScheduling } from "@/lib/ai-story-product-material-runtime";

type Params = { params: Promise<{ id: string; storyId: string; executionPlanId: string; packageId: string }> };
async function resolve(params: Params["params"], role: "operator" | "client_viewer") {
  const user = await requireAuth();
  const { id: campaignId, storyId, executionPlanId, packageId } = await params;
  const ctx = await resolveAuthorizedExecutionPlan({ userId: user.id, campaignId, storyId, executionPlanId, minRole: role });
  const packages = new AiStoryLocalGenerationRepository();
  const pkg = role === "operator"
    ? await packages.getExecutablePackage({ workspaceId: ctx.workspaceId, executionPlanId, packageId })
    : await packages.getPackage({ workspaceId: ctx.workspaceId, executionPlanId, packageId });
  if (!pkg) throw new Error("GENERATION_RESULT_NOT_FOUND");
  const output = (await packages.listOutputs({ workspaceId: ctx.workspaceId, executionPlanId })).find(item => item.packageId === packageId);
  const results = new AiStoryGenerationResultRepository();
  if (output) {
    const resultId = deterministicPersistenceUuid("ai-story-generation-result", {
      sourceKind: "MANUAL_LOCAL", providerAttemptId: null, localGenerationOutputId: output.outputId, localWorkerOutputId: null,
    });
    const result = await results.get(ctx.workspaceId, resultId);
    if (!result) throw new Error("GENERATION_RESULT_NOT_FOUND");
    return { user, pkg, result, results };
  }
  const rows = await getDb().select().from(schema.aiStoryGenerationResults).where(and(
    eq(schema.aiStoryGenerationResults.workspaceId, ctx.workspaceId),
    eq(schema.aiStoryGenerationResults.executionPlanId, executionPlanId),
    eq(schema.aiStoryGenerationResults.sceneExecutionId, pkg.sceneExecutionId),
    eq(schema.aiStoryGenerationResults.sourceKind, "LOCAL_GPU_WORKER"),
  ));
  const result = rows
    .map((row) => validateGenerationResult(row.result))
    .find((item) => item.inputAuthority.localPackageId === pkg.packageId);
  if (!result || result.source.sourceKind !== "LOCAL_GPU_WORKER") throw new Error("GENERATION_RESULT_NOT_FOUND");
  return { user, pkg, result, results };
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { pkg, result, results } = await resolve(params, "client_viewer");
    const playback=await createAdminClient().storage.from(process.env.SUPABASE_STORAGE_BUCKET??"campaign-assets")
      .createSignedUrl(result.media.storagePath,600);
    const jobs = await new AiStoryLocalMediaJobRepository().list(result.ownership.workspaceId, result.ownership.executionPlanId);
    const continuityJob = jobs.find((job) => job.kind === "EXTRACT_FRAME" && job.generationResultId === result.generationResultId) ?? null;
    return apiSuccess({
      generationResultId: result.generationResultId,
      sourceKind: result.source.sourceKind,
      playbackUrl:playback.error?null:playback.data?.signedUrl??null,
      requirements: buildGenerationResultPostQcInput(result, pkg).requirements,
      evaluation: await results.latestQc(result.ownership.workspaceId, result.generationResultId),
      decision: await results.decision(result.generationResultId),
      continuityFrame: await results.continuityFrame(result.ownership.workspaceId,result.generationResultId),
      continuityJob: continuityJob ? { state: continuityJob.state, errorCode: continuityJob.errorCode } : null,
    });
  } catch (error) { return handleApiError(error); }
}

const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("EVALUATE"), observations: z.array(AiStoryPostQcObservationSchema).max(100) }).strict(),
  z.object({ action: z.literal("APPROVE"), rationale: z.string().trim().min(1).max(3000) }).strict(),
  z.object({ action: z.literal("SUPERSEDE_APPROVAL"), rationale: z.string().trim().min(1).max(3000) }).strict(),
  z.object({ action: z.literal("DERIVE_CONTINUITY") }).strict(),
  z.object({ action: z.literal("RELEASE_SUCCESSOR") }).strict(),
]);

export async function POST(request: Request, { params }: Params) {
  try {
    const { user, pkg, result, results } = await resolve(params, "operator");
    const command = Command.parse(await request.json());
    const service = new AiStoryGenerationResultService();
    if (command.action === "DERIVE_CONTINUITY") return apiSuccess(await deriveApprovedGenerationResultContinuity(result,user.id));
    if (command.action === "SUPERSEDE_APPROVAL") {
      return apiSuccess(await service.supersedeApprovedLocal(
        result,
        pkg,
        user.id,
        command.rationale,
      ));
    }
    if (command.action === "RELEASE_SUCCESSOR") {
      if (pkg.version !== "local-generation-package.v3") {
        return apiError("Sequential release requires a V3 package", "SEQUENTIAL_LOCAL_V3_REQUIRED", 409);
      }
      const [qc, decision, frame, runtime] = await Promise.all([
        results.latestQc(result.ownership.workspaceId, result.generationResultId),
        results.decision(result.generationResultId),
        results.continuityFrame(result.ownership.workspaceId, result.generationResultId),
        getDb().select().from(schema.aiStoryRuntimeAuthorizedFacts).where(and(
          eq(
            schema.aiStoryRuntimeAuthorizedFacts.workspaceId,
            result.ownership.workspaceId,
          ),
          eq(
            schema.aiStoryRuntimeAuthorizedFacts.executionPlanId,
            result.ownership.executionPlanId,
          ),
          eq(
            schema.aiStoryRuntimeAuthorizedFacts.runtimeAuthorizationId,
            result.runtimeAuthorizationId,
          ),
        )).limit(1).then((rows) => rows[0] ?? null),
      ]);
      if (!qc || !decision || !frame || !frame.extractionContractVersion || !runtime) {
        return apiError("Approved predecessor continuity is not ready", "SEQUENTIAL_LOCAL_PREDECESSOR_NOT_READY", 409);
      }
      return apiSuccess(await new AiStoryLocalGenerationService({
        productMaterial: resolveCurrentSceneProductMaterialForScheduling,
      }).releaseImmediateSuccessor({
        orgId: result.ownership.orgId,
        workspaceId: result.ownership.workspaceId,
        campaignId: result.ownership.campaignId,
        storyId: result.ownership.storyId,
        storyVersionId: result.ownership.storyVersionId,
        executionPlanId: result.ownership.executionPlanId,
        runtimeAuthorizationId: result.runtimeAuthorizationId,
        orderedSceneExecutionIds: runtime.orderedSceneExecutionIds,
        actorUserId: user.id,
        createdAt: new Date().toISOString(),
        predecessor: {
          predecessorPackage: pkg,
          generationResult: result,
          postQc: qc,
          decision,
          frame: {
            frameAssetId: frame.frameAssetId,
            contentHash: frame.contentHash,
            sourceContentHash: frame.sourceContentHash,
            extractionContractVersion: frame.extractionContractVersion,
            extractedAt: frame.extractedAt.toISOString(),
          },
        },
      }));
    }
    if (command.action === "APPROVE") {
      const approved=await service.approve(result, user.id, command.rationale);
      const frame = await results.continuityFrame(result.ownership.workspaceId, result.generationResultId);
      if (frame) return apiSuccess({ ...approved, continuityJobId: null, continuityReady: true });
      const continuityJob=await deriveApprovedGenerationResultContinuity(result,user.id);
      return apiSuccess({...approved,continuityJobId:continuityJob.jobId,continuityState:continuityJob.state,continuityReady:false});
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
    if (error instanceof Error && /^(GENERATION_RESULT_|GENERATED_SCENE_POST_QC_|LOCAL_RETRY_|SEQUENTIAL_LOCAL_)/.test(error.message)) {
      return apiError("Generated media authority or QC is not ready for this action", error.message, 409);
    }
    return handleApiError(error);
  }
}
