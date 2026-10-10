import { and, eq, inArray } from "drizzle-orm";
import { AiStoryLocalGenerationRepository, AiStoryLocalMediaJobRepository, getDb, schema, validateGenerationResult } from "@ceo-agent/db";
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
    const db = getDb();
    const [packages, outputs, mediaJobs, localGpuRows] = await Promise.all([
      repository.listByExecutionPlan({ workspaceId: ctx.workspaceId, executionPlanId }),
      repository.listOutputs({ workspaceId: ctx.workspaceId, executionPlanId }),
      new AiStoryLocalMediaJobRepository().list(ctx.workspaceId, executionPlanId),
      db.select({
        generationResultId: schema.aiStoryGenerationResults.generationResultId,
        result: schema.aiStoryGenerationResults.result,
      }).from(schema.aiStoryGenerationResults).where(and(
        eq(schema.aiStoryGenerationResults.workspaceId, ctx.workspaceId),
        eq(schema.aiStoryGenerationResults.executionPlanId, executionPlanId),
        eq(schema.aiStoryGenerationResults.sourceKind, "LOCAL_GPU_WORKER"),
      )),
    ]);
    const decisionRows = localGpuRows.length === 0 ? [] : await db.select({
      generationResultId: schema.aiStoryGenerationResultDecisions.generationResultId,
      decision: schema.aiStoryGenerationResultDecisions.decision,
    }).from(schema.aiStoryGenerationResultDecisions).where(
      inArray(schema.aiStoryGenerationResultDecisions.generationResultId, localGpuRows.map((row) => row.generationResultId)),
    );
    const decisionByResult = new Map(decisionRows.map((row) => [row.generationResultId, row.decision]));
    const localGpuReviews = localGpuRows.flatMap((row) => {
      const parsed = validateGenerationResult(row.result);
      const packageId = parsed.inputAuthority.localPackageId;
      if (parsed.source.sourceKind !== "LOCAL_GPU_WORKER" || typeof packageId !== "string") return [];
      const decision = decisionByResult.get(parsed.generationResultId);
      const humanReviewStatus = decision === "APPROVED" || decision === "REJECTED" || decision === "LOCAL_REGENERATION_REQUIRED"
        ? decision
        : "PENDING" as const;
      return [{
        packageId,
        generationResultId: parsed.generationResultId,
        sceneExecutionId: parsed.sceneExecutionId,
        humanReviewStatus,
      }];
    });
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
      localGpuReviews,
      mediaJobs: mediaJobs.map(({claimToken:_token,actorUserId:_actor,...job})=>job),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
