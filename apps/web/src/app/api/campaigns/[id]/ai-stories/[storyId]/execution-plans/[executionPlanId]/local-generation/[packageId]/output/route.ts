import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { AiStoryLocalGenerationRepository, AiStoryLocalMediaJobRepository, getDb, schema } from "@ceo-agent/db";
import { materializeLocalGenerationResult } from "@ceo-agent/agents";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { resolveAuthorizedExecutionPlan } from "@/lib/ai-story-execution-plan-access";
import { createAdminClient } from "@/lib/supabase/admin";
type Params = { params: Promise<{ id: string; storyId: string; executionPlanId: string; packageId: string }> };

async function context(params: Params["params"], minRole: "operator" | "client_viewer") {
  const user = await requireAuth();
  const { id: campaignId, storyId, executionPlanId, packageId } = await params;
  const ctx = await resolveAuthorizedExecutionPlan({ userId: user.id, campaignId, storyId, executionPlanId, minRole });
  const repository = new AiStoryLocalGenerationRepository();
  const item = await repository.getPackage({ workspaceId: ctx.workspaceId, executionPlanId, packageId });
  return { user, campaignId, storyId, executionPlanId, packageId, ctx, repository, item };
}

/** Authorize an exact private MP4 upload for one immutable Unit package. */
export async function POST(request: Request, { params }: Params) {
  try {
    const resolved = await context(params, "operator");
    if (!resolved.item) return apiError("Local Generation package not found", "NOT_FOUND", 404);
    const body = await request.json() as { filename?: string; mimeType?: string; fileSizeBytes?: number };
    if (body.mimeType !== "video/mp4" || !body.filename?.toLowerCase().endsWith(".mp4")) {
      return apiError("Local output must be an MP4 video", "LOCAL_GENERATION_MEDIA_TYPE_INVALID", 422);
    }
    if (!body.fileSizeBytes || !Number.isSafeInteger(body.fileSizeBytes) || body.fileSizeBytes <= 0 || body.fileSizeBytes > 100_000_000) {
      return apiError("Local output size is invalid", "LOCAL_GENERATION_MEDIA_SIZE_INVALID", 422);
    }
    const assetId = randomUUID();
    const storagePath = `${resolved.ctx.workspaceId}/ai-story/local-generation/${resolved.packageId}/${assetId}.mp4`;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
    const { data, error } = await createAdminClient().storage.from(bucket).createSignedUploadUrl(storagePath);
    if (error || !data?.signedUrl) return apiError("Unable to authorize local output upload", "STORAGE_ERROR", 502);
    await getDb().insert(schema.assets).values({
      id: assetId,
      orgId: resolved.ctx.orgId,
      workspaceId: resolved.ctx.workspaceId,
      campaignId: resolved.campaignId,
      type: "video",
      storagePath,
      displayName: `Local Generation Unit ${resolved.item.order}`,
      originalFilename: body.filename,
      status: "uploading",
      source: "ai_story_manual_local",
      uploadedBy: resolved.user.id,
      mimeType: "video/mp4",
      fileSizeBytes: body.fileSizeBytes,
      metadata: {
        localGenerationPackageId: resolved.packageId,
        localGenerationUnitId: resolved.item.unitId,
        executionPlanId: resolved.executionPlanId,
      },
    });
    return apiSuccess({ assetId, uploadUrl: data.signedUrl }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

/** Finalize bytes, hash and duration. This binds output to the exact Unit but never auto-passes QC. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const resolved = await context(params, "operator");
    if (!resolved.item) return apiError("Local Generation package not found", "NOT_FOUND", 404);
    const body = await request.json() as { assetId?: string };
    if (!body.assetId) return apiError("assetId is required", "VALIDATION_ERROR", 422);
    const rows = await getDb().select().from(schema.assets).where(and(
      eq(schema.assets.id, body.assetId),
      eq(schema.assets.orgId, resolved.ctx.orgId),
      eq(schema.assets.workspaceId, resolved.ctx.workspaceId),
      eq(schema.assets.campaignId, resolved.campaignId),
      eq(schema.assets.source, "ai_story_manual_local"),
      isNull(schema.assets.deletedAt),
    )).limit(1);
    const asset = rows[0];
    const metadata = asset?.metadata ?? {};
    if (!asset || metadata.localGenerationPackageId !== resolved.packageId || metadata.localGenerationUnitId !== resolved.item.unitId) {
      return apiError("Upload does not belong to this Local Generation Unit", "LOCAL_GENERATION_OUTPUT_WRONG_UNIT", 409);
    }
    if (asset.uploadedBy !== resolved.user.id || metadata.executionPlanId !== resolved.executionPlanId) {
      return apiError("Upload authority does not match this user and plan", "LOCAL_GENERATION_OUTPUT_WRONG_UNIT", 409);
    }
    const job = await new AiStoryLocalMediaJobRepository().enqueue({
      workspaceId: resolved.ctx.workspaceId, executionPlanId: resolved.executionPlanId,
      packageId: resolved.packageId, actorUserId: resolved.user.id, kind: "VALIDATE_OUTPUT", assetId: asset.id,
    });
    return apiSuccess({ jobId: job.jobId, state: job.state, nextState: "LOCAL_OUTPUT_VALIDATING",
      automaticProviderRetry: false, providerAttemptId: null }, 202);
  } catch (error) {
    return handleApiError(error);
  }
}
