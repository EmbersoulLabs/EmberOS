import { AiStoryLocalGenerationRepository, AiStoryGenerationResultRepository } from "@ceo-agent/db";
import { handleApiError, requireAuth } from "@/lib/auth";
import { resolveAuthorizedExecutionPlan } from "@/lib/ai-story-execution-plan-access";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; storyId: string; executionPlanId: string; packageId: string }> },
) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, executionPlanId, packageId } = await params;
    const ctx = await resolveAuthorizedExecutionPlan({ userId: user.id, campaignId, storyId, executionPlanId, minRole: "client_viewer" });
    const item = await new AiStoryLocalGenerationRepository().getPackage({ workspaceId: ctx.workspaceId, executionPlanId, packageId });
    if (!item) return new Response("Local Generation package not found", { status: 404 });
    const previousUnitEndFrameAuthority=await new AiStoryGenerationResultRepository().previousUnitContinuity(item);
    const downloadable = {
      manifest: item,
      // Supplemental immutable evidence, never rewrites the frozen package or chooses I2V.
      previousUnitEndFrameAuthority,
      previousUnitEndFrameDownload:previousUnitEndFrameAuthority
        ? `/api/campaigns/${campaignId}/ai-stories/${storyId}/execution-plans/${executionPlanId}/local-generation/${packageId}/references/${previousUnitEndFrameAuthority.frameAssetId}`
        : null,
      referenceDownloads: item.references.map((reference) => ({
        assetId: reference.assetId,
        contentHash: reference.contentHash,
        url: `/api/campaigns/${campaignId}/ai-stories/${storyId}/execution-plans/${executionPlanId}/local-generation/${packageId}/references/${reference.assetId}`,
      })),
    };
    return new Response(JSON.stringify(downloadable, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="unit-${item.order}-local-generation-package.json"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
