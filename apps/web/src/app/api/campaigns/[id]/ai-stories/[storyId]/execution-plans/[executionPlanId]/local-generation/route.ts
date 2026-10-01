import { AiStoryLocalGenerationRepository, AiStoryLocalMediaJobRepository } from "@ceo-agent/db";
import { apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { resolveAuthorizedExecutionPlan } from "@/lib/ai-story-execution-plan-access";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; storyId: string; executionPlanId: string }> },
) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, executionPlanId } = await params;
    const ctx = await resolveAuthorizedExecutionPlan({
      userId: user.id,
      campaignId,
      storyId,
      executionPlanId,
      minRole: "client_viewer",
    });
    const repository = new AiStoryLocalGenerationRepository();
    const [packages, outputs, mediaJobs] = await Promise.all([
      repository.listByExecutionPlan({ workspaceId: ctx.workspaceId, executionPlanId }),
      repository.listOutputs({ workspaceId: ctx.workspaceId, executionPlanId }),
      new AiStoryLocalMediaJobRepository().list(ctx.workspaceId, executionPlanId),
    ]);
    return apiSuccess({
      executionMode: "MANUAL_LOCAL",
      cloudVideoProviderCostUsd: 0,
      localGpuCost: "NOT_METERED_BY_EMBEROS_V1",
      packages: packages.map((item) => ({
        ...item,
        references: item.references.map((reference) => ({
          ...reference,
          storagePath: undefined,
          downloadPath: `local-generation/${item.packageId}/references/${reference.assetId}`,
        })),
        downloadPath: `local-generation/${item.packageId}/download`,
      })),
      outputs,
      mediaJobs: mediaJobs.map(({claimToken:_token,actorUserId:_actor,...job})=>job),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
