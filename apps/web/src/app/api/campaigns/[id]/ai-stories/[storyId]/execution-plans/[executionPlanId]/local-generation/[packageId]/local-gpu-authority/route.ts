import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  LocalGpuCloudAdapter,
  loadLocalGpuConfigFromEnv,
  mapCanonicalPackageToLocalGpuContractV2,
  planLocalGpuRoute,
} from "@ceo-agent/agents";
import {
  AiStoryLocalGenerationRepository,
  deterministicPersistenceUuid,
  getDb,
  persistLocalGpuDispatchAuthority,
  schema,
} from "@ceo-agent/db";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { resolveAuthorizedExecutionPlan } from "@/lib/ai-story-execution-plan-access";
import { requirePlatformAdmin } from "@/lib/platform-admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

type Params = { params: Promise<{ id: string; storyId: string; executionPlanId: string; packageId: string }> };

function seedFor(packageId: string): number {
  return Number.parseInt(createHash("sha256").update(packageId).digest("hex").slice(0, 7), 16);
}

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
    const repository = new AiStoryLocalGenerationRepository();
    const pkg = await repository.getExecutablePackage({ workspaceId: ctx.workspaceId, executionPlanId, packageId });
    if (!pkg || pkg.storyId !== storyId || pkg.organizationId !== ctx.orgId || pkg.campaignId !== campaignId) {
      return apiError("Exact released Local Generation package not found", "NOT_FOUND", 404);
    }

    const config = loadLocalGpuConfigFromEnv(process.env);
    if (!config.enabled || config.environment !== "production") {
      return apiError("Production LOCAL_GPU authorization is disabled", "LOCAL_GPU_PRODUCTION_DENIED", 503);
    }
    const actor = {
      userId: user.id,
      workspaceId: ctx.workspaceId,
      organizationPlan: null,
      platformAdminStatus: "ACTIVE_GRANT" as const,
    };
    const adapter = new LocalGpuCloudAdapter(config, async () => {
      throw new Error("LOCAL_GPU_GENERATION_NOT_PERMITTED_DURING_AUTHORIZATION");
    });
    const capabilitiesResponse = await fetch(`${config.baseUrl}/v1/capabilities`, {
      method: "GET",
      headers: { authorization: `Bearer ${adapter.capabilitiesToken({ actor, workspaceId: ctx.workspaceId })}` },
      cache: "no-store",
    });
    if (capabilitiesResponse.status !== 200) {
      return apiError("Desktop capabilities authorization failed", "LOCAL_GPU_CAPABILITIES_UNAVAILABLE", 502);
    }
    const rawCapabilities = await capabilitiesResponse.json();
    const capabilities = rawCapabilities && typeof rawCapabilities === "object" && "capabilities" in rawCapabilities
      ? (rawCapabilities as { capabilities: unknown }).capabilities
      : rawCapabilities;

    const assetId = deterministicPersistenceUuid("local-gpu-output-asset", { packageId, runtimeAuthorizationId: pkg.runtimeAuthorizationId });
    const storagePath = `${ctx.workspaceId}/ai-story/local-gpu/${packageId}/${assetId}.mp4`;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
    const storage = createAdminClient().storage.from(bucket);
    const { data: upload, error: uploadError } = await storage.createSignedUploadUrl(storagePath);
    if (uploadError || !upload?.signedUrl) return apiError("Unable to authorize LOCAL_GPU output upload", "STORAGE_ERROR", 502);
    await getDb().insert(schema.assets).values({
      id: assetId, orgId: ctx.orgId, workspaceId: ctx.workspaceId, campaignId,
      type: "video", storagePath, displayName: `LOCAL_GPU Unit ${pkg.order}`,
      originalFilename: `${packageId}.mp4`, status: "uploading", source: "ai_story_manual_local",
      uploadedBy: user.id, mimeType: "video/mp4",
      metadata: { localGenerationPackageId: packageId, localGenerationUnitId: pkg.unitId, executionPlanId, sourceKind: "LOCAL_GPU_WORKER" },
    }).onConflictDoNothing();
    const uploadDestination = { environment: "production" as const, method: "PUT", url: upload.signedUrl, assetId };

    const references = pkg.references ?? [];
    const noProductVisual = !pkg.productAuthority
      || ("selection" in pkg.productAuthority && pkg.productAuthority.selection === "NO_PRODUCT_VISUAL_INPUT");
    const zeroAsset = pkg.generationMode === "TEXT_TO_VIDEO" && references.length === 0 && !pkg.characterAuthority && noProductVisual;
    let route: Record<string, unknown>;
    let dispatchRequest: Record<string, unknown>;
    if (zeroAsset) {
      route = {
        assetMode: "WITHOUT_ASSET", assetRecommendationStatus: "CONFIRMED_NO_ASSETS",
        referenceCount: 0, imageReferenceCount: 0, preQc: "DISPATCH_ELIGIBLE",
        runtimeAuthorizationId: pkg.runtimeAuthorizationId, capabilities,
        generateAudio: pkg.generateAudio, audioBlocked: pkg.audioBlocked,
        qcExpectation: pkg.generateAudio && !pkg.audioBlocked ? "NO_DIALOGUE_WITH_AMBIENT_AUDIO" : "SILENT_OUTPUT",
      };
      dispatchRequest = {
        storyId: pkg.storyId, storyVersionId: pkg.storyVersionId,
        prompt: pkg.prompt.replace(/[\r\n]+/g, " | ").replace(/\s+/g, " ").trim(),
        plannedDurationMs: pkg.durationSec * 1000, aspectRatio: pkg.aspectRatio,
        seed: seedFor(packageId), megapixels: 0.5,
        audioPolicy: pkg.generateAudio && !pkg.audioBlocked ? "NO_DIALOGUE_WITH_AMBIENT_AUDIO" : "SILENT_OUTPUT",
        upload: uploadDestination, assetRecommendationStatus: "CONFIRMED_NO_ASSETS",
        confirmationStoryId: pkg.storyId, confirmationStoryVersionId: pkg.storyVersionId,
        confirmationWorkspaceId: pkg.workspaceId, planningFrozen: true,
        preGenerationQcEvaluationId: pkg.sourceAuthority.preGenerationQcEvaluationId,
        runtimeAuthorizationId: pkg.runtimeAuthorizationId,
        director: null,
      };
    } else {
      const assetRows = references.length ? await getDb().select().from(schema.assets).where(and(
        eq(schema.assets.workspaceId, ctx.workspaceId),
        eq(schema.assets.orgId, ctx.orgId),
        eq(schema.assets.status, "ready"),
        isNull(schema.assets.deletedAt),
      )) : [];
      const resolvedAssets = [];
      for (const reference of references) {
        const asset = assetRows.find((row) => row.id === reference.assetId && row.contentHash === reference.contentHash);
        if (!asset?.storagePath || !asset.contentHash) return apiError("Authorized LOCAL_GPU reference is unavailable", "LOCAL_GPU_REFERENCE_WORKSPACE_MISMATCH", 409);
        const { data, error } = await storage.createSignedUrl(asset.storagePath, 900);
        if (error || !data?.signedUrl) return apiError("Unable to authorize LOCAL_GPU reference", "STORAGE_ERROR", 502);
        resolvedAssets.push({ assetId: asset.id, contentHash: asset.contentHash, workspaceId: asset.workspaceId, assetUrl: data.signedUrl });
      }
      const desktop = mapCanonicalPackageToLocalGpuContractV2({
        package: pkg, assets: resolvedAssets, environment: "production",
        jobId: deterministicPersistenceUuid("local-gpu-preview-job", { packageId }),
        upload: uploadDestination,
      });
      const body = desktop.body;
      dispatchRequest = {
        sceneExecutionId: body.sceneExecutionId,
        workspaceId: body.workspaceId,
        workflow: body.workflow,
        prompt: body.prompt,
        plannedDurationMs: body.durationSec * 1000,
        upload: body.upload,
        audioPolicy: body.audioPolicy,
        creative: body.creative,
        references: body.references,
        firstFrame: body.firstFrame ? {
          ...body.firstFrame,
          authoritySourceAssetId: body.firstFrame.sourceAssetId,
          authorityContentHash: body.firstFrame.contentHash,
        } : null,
        continuityRequired: body.firstFrame !== null,
        dialogueLineCount: 0,
        pinnedVoiceDna: false,
        structuredCamera: false,
        structuredMotion: false,
        textOnly: false,
      };
      route = {
        assetMode: "WITH_ASSET", assetRecommendationStatus: "SATISFIED",
        referenceCount: references.length, preQc: "DISPATCH_ELIGIBLE",
        runtimeAuthorizationId: pkg.runtimeAuthorizationId, capabilities,
        recommendedWorkflow: pkg.recommendedWorkflow,
        generateAudio: pkg.generateAudio, audioBlocked: pkg.audioBlocked,
        qcExpectation: pkg.generateAudio && !pkg.audioBlocked ? "NO_DIALOGUE_WITH_AMBIENT_AUDIO" : "SILENT_OUTPUT",
      };
    }
    const planned = planLocalGpuRoute(route as never);
    if (!planned.eligible) return apiError("LOCAL_GPU workflow is unsupported", planned.blocked ?? "LOCAL_GPU_WORKFLOW_UNSUPPORTED", 409);

    const authority = await persistLocalGpuDispatchAuthority(getDb(), {
      idempotencyKey, orgId: ctx.orgId, workspaceId: ctx.workspaceId, campaignId,
      storyId, executionPlanId, sceneExecutionId: pkg.sceneExecutionId, packageId,
      runtimeAuthorizationId: pkg.runtimeAuthorizationId,
      platformAdminAssignmentId: assignment.platformAdminAssignmentId,
      authorizedByUserId: user.id,
      snapshot: { contractVersion: 1, actor, route, request: dispatchRequest, capabilities },
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });
    return apiSuccess({
      dispatchAuthorityId: authority.dispatchAuthorityId,
      executionIdentity: authority.executionIdentity,
      sceneExecutionId: pkg.sceneExecutionId,
      packageId,
      runtimeAuthorizationId: pkg.runtimeAuthorizationId,
      status: authority.status,
      gpuSubmitted: false,
    }, 202);
  } catch (error) {
    return handleApiError(error);
  }
}
