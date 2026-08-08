/**
 * Sprint 3 PR 3.7 Phase E — GET accepted Final Story Result + signed playback URL.
 *
 * GET /api/campaigns/:id/ai-stories/:storyId/execution-plans/:executionPlanId/final-story-result
 *
 * Read-only. Does not accept/project FSR. Does not persist signed URLs.
 */
import { FinalStoryResultRepositoryImpl } from "@ceo-agent/db";
import {
  FINAL_STORY_RESULT_PLAYBACK_TTL_SECONDS,
  FINAL_STORY_RESULT_READ_CONTRACT_VERSION,
  FINAL_STORY_RESULT_READ_PERSISTENCE_VERSION,
  FINAL_STORY_RESULT_READ_PROJECTION_VERSION,
  FinalStoryResultReadModelSchema,
  PRODUCT_RUNTIME_FORBIDDEN_RESPONSE_KEYS,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import {
  executionPlanRouteErrorResponse,
  resolveAuthorizedExecutionPlan,
} from "@/lib/ai-story-execution-plan-access";
import { mintFinalStoryPlaybackUrl } from "@/lib/ai-story-final-story-playback";

type RouteParams = {
  params: Promise<{ id: string; storyId: string; executionPlanId: string }>;
};

function assertNoForbiddenKeys(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  for (const key of PRODUCT_RUNTIME_FORBIDDEN_RESPONSE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new Error(`Forbidden FSR response key leaked: ${key}`);
    }
  }
}

export async function GET(_request: Request, { params }: RouteParams) {
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

    const record = await new FinalStoryResultRepositoryImpl().getByExecutionPlanId(
      ctx.executionPlanId
    );
    if (!record) {
      return apiError("Final Story Result not found", "NOT_FOUND", 404);
    }

    // Fail closed on ownership mismatch.
    if (
      record.workspaceId !== ctx.workspaceId ||
      record.orgId !== ctx.orgId ||
      record.campaignId !== ctx.campaignId ||
      record.storyId !== ctx.storyId ||
      record.executionPlanId !== ctx.executionPlanId ||
      record.ownership.workspaceId !== ctx.workspaceId ||
      record.ownership.executionPlanId !== ctx.executionPlanId
    ) {
      return apiError("Final Story Result not found", "NOT_FOUND", 404);
    }

    let playback;
    try {
      playback = await mintFinalStoryPlaybackUrl({
        workspaceId: ctx.workspaceId,
        outputMediaReference: record.outputMediaReference,
        expiresInSeconds: FINAL_STORY_RESULT_PLAYBACK_TTL_SECONDS,
      });
    } catch (error) {
      return apiError(
        error instanceof Error ? error.message : "Failed to create playback URL",
        "STORAGE_ERROR",
        502
      );
    }

    const body = FinalStoryResultReadModelSchema.parse({
      contractVersion: FINAL_STORY_RESULT_READ_CONTRACT_VERSION,
      persistenceContractVersion: FINAL_STORY_RESULT_READ_PERSISTENCE_VERSION,
      projectionVersion: FINAL_STORY_RESULT_READ_PROJECTION_VERSION,
      finalStoryResultId: record.finalStoryResultId,
      executionPlanId: record.executionPlanId,
      assemblyJobId: record.assemblyJobId,
      assemblyArtifactId: record.assemblyArtifactId,
      mediaType: "video/mp4",
      durationMs: record.totalDurationMs,
      width: record.width,
      height: record.height,
      contentHash: record.contentHash,
      acceptedAt: record.acceptedAt,
      playbackUrl: playback.playbackUrl,
      playbackUrlExpiresInSeconds: playback.expiresInSeconds,
    });

    assertNoForbiddenKeys(body);
    // playbackUrl is intentional ephemeral transport; never treat as persistence key.
    return apiSuccess(body);
  } catch (error) {
    return executionPlanRouteErrorResponse(error) ?? handleApiError(error);
  }
}
