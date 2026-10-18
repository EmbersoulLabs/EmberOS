import { and, eq } from "drizzle-orm";
import { AiStoryCommercialAudioRepository, AiStoryGenerationResultRepository, AiStoryLocalGenerationRepository, AiStoryLocalMediaJobRepository, deterministicPersistenceUuid, getDb, schema } from "@ceo-agent/db";
import { AiStoryGenerationResultService, AiStoryLocalGenerationService, buildGenerationResultPostQcInput } from "@ceo-agent/agents";
import { AiStoryPostQcObservationSchema } from "@ceo-agent/shared";
import { z } from "zod";
import { customerReviewObservationError } from "@/components/ai-story/simple-video-review";
import { apiError, apiSuccess } from "@/lib/api";
import { requireAuth, handleApiError } from "@/lib/auth";
import { resolveAuthorizedExecutionPlan } from "@/lib/ai-story-execution-plan-access";
import { deriveApprovedGenerationResultContinuity } from "@/lib/ai-story-generation-result-continuity";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCurrentSceneProductMaterialForScheduling } from "@/lib/ai-story-product-material-runtime";
import { autoAuthorizeLocalGpuAfterRelease } from "@/lib/ai-story-local-gpu-authorization-ports";

type Params = { params: Promise<{ id: string; storyId: string; executionPlanId: string; packageId: string }> };
async function resolve(params: Params["params"], role: "operator" | "client_viewer") {
  const user = await requireAuth();
  const { id: campaignId, storyId, executionPlanId, packageId } = await params;
  const ctx = await resolveAuthorizedExecutionPlan({ userId: user.id, campaignId, storyId, executionPlanId, minRole: role });
  const packages = new AiStoryLocalGenerationRepository();
  const pkg = role === "operator"
    ? await packages.getExecutablePackage({ workspaceId: ctx.workspaceId, executionPlanId, packageId })
    : await packages.getPackage({ workspaceId: ctx.workspaceId, executionPlanId, packageId });
  const output = (await packages.listOutputs({ workspaceId: ctx.workspaceId, executionPlanId })).find(item => item.packageId === packageId);
  if (!pkg) throw new Error("GENERATION_RESULT_NOT_FOUND");
  const results = new AiStoryGenerationResultRepository();
  if (!output) {
    const gpu = await results.findSoleLocalGpuWorkerResult({
      workspaceId: ctx.workspaceId,
      executionPlanId,
      sceneExecutionId: pkg.sceneExecutionId,
      packageId,
    });
    if (!gpu) throw new Error("GENERATION_RESULT_NOT_FOUND");
    return { user, pkg, result: gpu, results };
  }
  // One output row is accepted under exactly one origin; accept() refuses the other.
  let result: Awaited<ReturnType<typeof results.get>> = null;
  for (const sourceKind of ["LOCAL_GPU_WORKER", "MANUAL_LOCAL"] as const) {
    result ??= await results.get(ctx.workspaceId, deterministicPersistenceUuid("ai-story-generation-result", {
      sourceKind, providerAttemptId: null, localGenerationOutputId: output.outputId, localWorkerOutputId: null,
    }));
  }
  if (!result) throw new Error("GENERATION_RESULT_NOT_FOUND");
  return { user, pkg, result, results };
}

function reviewAudioBlock(described: Awaited<ReturnType<AiStoryCommercialAudioRepository["describe"]>>): string | null {
  if (described.decision.finalPolicy === "EXPLICIT_SILENCE" || described.decision.finalPolicy === "PRESERVE_NATIVE") return null;
  if (described.decision.finalPolicy === "BLOCKED") return "MISSING_LICENSED_MUSIC";
  if (described.decision.finalPolicy === "LICENSED_BGM" || described.decision.finalPolicy === "NATIVE_PLUS_BGM") {
    return described.assembly?.state === "ASSEMBLED" && described.assembly.hasAudio ? null : "COMMERCIAL_AUDIO_ASSEMBLY_REQUIRED";
  }
  return null;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { pkg, result, results } = await resolve(params, "client_viewer");
    const bucket = createAdminClient().storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets");
    const playback = await bucket.createSignedUrl(result.media.storagePath, 600);
    const commercial = await new AiStoryCommercialAudioRepository().describe({
      workspaceId: result.ownership.workspaceId, executionPlanId: result.ownership.executionPlanId,
      packageId: pkg.packageId, generationResultId: result.generationResultId,
    });
    const assembled = commercial.assembly?.state === "ASSEMBLED" && commercial.assembly.hasAudio && commercial.assembly.outputStoragePath
      ? await bucket.createSignedUrl(commercial.assembly.outputStoragePath, 600) : null;
    const jobs = await new AiStoryLocalMediaJobRepository().list(result.ownership.workspaceId, result.ownership.executionPlanId);
    const continuityJob = jobs.find((job) => job.kind === "EXTRACT_FRAME" && job.generationResultId === result.generationResultId) ?? null;
    const evaluation = await results.latestQc(result.ownership.workspaceId, result.generationResultId);
    return apiSuccess({
      generationResultId: result.generationResultId,
      sourceKind: result.source.sourceKind,
      playbackUrl: assembled && !assembled.error ? assembled.data?.signedUrl ?? null : playback.error ? null : playback.data?.signedUrl ?? null,
      sourcePlaybackUrl: playback.error ? null : playback.data?.signedUrl ?? null,
      reviewedMedia: assembled && !assembled.error ? "ASSEMBLED_OUTPUT" : "GENERATION_SOURCE",
      commercialAudio: {
        finalPolicy: commercial.assembly?.finalPolicy ?? commercial.decision.finalPolicy,
        generationPolicy: commercial.decision.generationPolicy,
        blockers: commercial.decision.blockers,
        recommendation: commercial.recommendation,
        assembly: commercial.assembly ? {
          state: commercial.assembly.state, finalPolicy: commercial.assembly.finalPolicy,
          trackId: commercial.assembly.bgmTrackId, license: commercial.assembly.bgmLicense,
          hasAudio: commercial.assembly.hasAudio, errorCode: commercial.assembly.errorCode,
          outputContentHash: commercial.assembly.outputContentHash,
        } : null,
      },
      requirements: buildGenerationResultPostQcInput(result, pkg).requirements,
      evaluation,
      ...(result.source.sourceKind === "LOCAL_GPU_WORKER" ? {
        audioEvidence: evaluation?.audioEvidenceId && evaluation.audioSpeechContent ? {
          audioEvidenceId: evaluation.audioEvidenceId,
          speechContent: evaluation.audioSpeechContent,
          autoApproved: false as const,
        } : null,
      } : {}),
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
      const released = await new AiStoryLocalGenerationService({
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
      });
      const localGpuAuthorization = await autoAuthorizeLocalGpuAfterRelease({
        orgId: result.ownership.orgId, workspaceId: result.ownership.workspaceId, campaignId: result.ownership.campaignId,
        executionPlanId: result.ownership.executionPlanId, actorUserId: user.id,
      });
      return apiSuccess({ ...released, localGpuAuthorization });
    }
    if (command.action === "APPROVE" || command.action === "EVALUATE") {
      const described = await new AiStoryCommercialAudioRepository().describe({
        workspaceId: result.ownership.workspaceId, executionPlanId: result.ownership.executionPlanId,
        packageId: pkg.packageId, generationResultId: result.generationResultId,
      });
      const block = reviewAudioBlock(described);
      if (block) return apiError(block, block, 409);
    }
    if (command.action === "APPROVE") {
      const approved=await service.approve(result, user.id, command.rationale);
      const frame = await results.continuityFrame(result.ownership.workspaceId, result.generationResultId);
      if (frame) return apiSuccess({ ...approved, continuityJobId: null, continuityReady: true });
      const continuityJob=await deriveApprovedGenerationResultContinuity(result,user.id);
      return apiSuccess({...approved,continuityJobId:continuityJob.jobId,continuityState:continuityJob.state,continuityReady:false});
    }
    const allowed = new Set(buildGenerationResultPostQcInput(result, pkg).requirements.map(item => item.requirementId));
    const observationError = customerReviewObservationError(command.observations, allowed);
    if (observationError) {
      return apiError(
        observationError === "HUMAN_VISIBLE_REVIEW_CANNOT_PASS_REQUIREMENTS"
          ? "Looks Good only records that you watched the video. It cannot mark each detail as passed."
          : "QC evidence does not match this Generation Unit",
        observationError,
        422,
      );
    }
    return apiSuccess(await service.evaluateLocal(result, pkg, {
      providerId: "human-supplied-evidence", contractVersion: "ai-story-visual-evidence.v1",
      analyze: async () => command.observations,
    }, user.id));
  } catch (error) {
    if (error instanceof Error && /^(GENERATION_RESULT_|GENERATED_SCENE_POST_QC_|LOCAL_RETRY_|SEQUENTIAL_LOCAL_|LOCAL_GPU_AUDIO_)/.test(error.message)) {
      return apiError("Generated media authority or QC is not ready for this action", error.message, 409);
    }
    return handleApiError(error);
  }
}
