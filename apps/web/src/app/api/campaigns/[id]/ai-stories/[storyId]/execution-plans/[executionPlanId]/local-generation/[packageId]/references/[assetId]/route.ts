import { AiStoryLocalGenerationRepository, AiStoryGenerationResultRepository, getDb, schema } from "@ceo-agent/db";
import { and, eq } from "drizzle-orm";
import { assertWorkspaceScopedDurableObjectKey } from "@ceo-agent/shared/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError, requireAuth } from "@/lib/auth";
import { resolveAuthorizedExecutionPlan } from "@/lib/ai-story-execution-plan-access";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; storyId: string; executionPlanId: string; packageId: string; assetId: string }> },
) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, executionPlanId, packageId, assetId } = await params;
    const ctx = await resolveAuthorizedExecutionPlan({ userId: user.id, campaignId, storyId, executionPlanId, minRole: "client_viewer" });
    const item = await new AiStoryLocalGenerationRepository().getPackage({ workspaceId: ctx.workspaceId, executionPlanId, packageId });
    const reference = item?.references.find((candidate) => candidate.assetId === assetId);
    if (!item) return new Response("Authorized reference not found", { status: 404 });
    const frame = !reference ? await new AiStoryGenerationResultRepository().previousUnitContinuity(item) : null;
    if (!reference && frame?.frameAssetId !== assetId) return new Response("Authorized reference not found", { status: 404 });
    const [asset] = await getDb().select().from(schema.assets).where(and(
      eq(schema.assets.id, assetId), eq(schema.assets.workspaceId, ctx.workspaceId),
    )).limit(1);
    if (!asset || asset.orgId !== item.organizationId || asset.status !== "ready" ||
        asset.contentHash !== (reference?.contentHash ?? frame?.contentHash) || (reference && asset.storagePath !== reference.storagePath)) {
      return new Response("Reference authority is stale", { status: 409 });
    }
    assertWorkspaceScopedDurableObjectKey(ctx.workspaceId, asset.storagePath);
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
    const { data, error } = await createAdminClient().storage.from(bucket).download(asset.storagePath);
    if (error || !data) return new Response("Reference unavailable", { status: 502 });
    const extension = asset.mimeType === "image/png" ? "png" : asset.mimeType === "image/jpeg" ? "jpg" : asset.mimeType === "image/webp" ? "webp" : "bin";
    const filename = (asset.originalFilename || `reference.${extension}`).replace(/[^A-Za-z0-9._-]+/g, "_");
    return new Response(data, {
      status: 200,
      headers: {
        "content-type": asset.mimeType || "application/octet-stream",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
