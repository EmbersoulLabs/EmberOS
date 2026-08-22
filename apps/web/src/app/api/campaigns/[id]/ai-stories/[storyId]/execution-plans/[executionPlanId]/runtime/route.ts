/**
 * Sprint 3 PR 3.7 Phase E — GET product runtime projection.
 *
 * GET /api/campaigns/:id/ai-stories/:storyId/execution-plans/:executionPlanId/runtime
 *
 * Read-only. Zero execution side effects.
 */
import { deriveProductRuntimeProjection } from "@ceo-agent/agents";
import { getWorkspaceMembership } from "@ceo-agent/db";
import {
  PRODUCT_RUNTIME_FORBIDDEN_RESPONSE_KEYS,
  ProductRuntimeProjectionSchema,
} from "@ceo-agent/shared";
import { apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { mintSceneResultPlayback } from "@/lib/ai-story-scene-media-playback";
import {
  executionPlanRouteErrorResponse,
  resolveAuthorizedExecutionPlan,
} from "@/lib/ai-story-execution-plan-access";

type RouteParams = {
  params: Promise<{ id: string; storyId: string; executionPlanId: string }>;
};

function assertNoForbiddenKeys(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  for (const key of PRODUCT_RUNTIME_FORBIDDEN_RESPONSE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new Error(`Forbidden runtime response key leaked: ${key}`);
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

    const membership = await getWorkspaceMembership(ctx.workspaceId, user.id);
    const projection = await deriveProductRuntimeProjection({
      executionPlanId: ctx.executionPlanId,
      callerRole: membership?.role ?? null,
    });

    const generatedSceneReviews = await Promise.all(
      (projection.generatedSceneReviews ?? []).map(async (scene) => {
        if (!scene.generatedMedia) return scene;
        try {
          const delivery = await mintSceneResultPlayback({
            workspaceId: ctx.workspaceId,
            executionPlanId: ctx.executionPlanId,
            sceneExecutionId: scene.sceneExecutionId,
            providerAttemptId: scene.generatedMedia.providerAttemptId,
            sceneResultId: scene.generatedMedia.sceneResultId,
          });
          return {
            ...scene,
            generatedMedia: {
              ...scene.generatedMedia,
              ...delivery,
              deliveryStatus: "READY" as const,
              safeError: null,
            },
          };
        } catch {
          return {
            ...scene,
            generatedMedia: {
              ...scene.generatedMedia,
              deliveryUrl: null,
              expiresAt: null,
              deliveryStatus: "UNAVAILABLE" as const,
              safeError: "Scene media preview is temporarily unavailable.",
            },
          };
        }
      })
    );
    const deliveredProjection = ProductRuntimeProjectionSchema.parse({
      ...projection,
      generatedSceneReviews,
    });

    assertNoForbiddenKeys(deliveredProjection);
    return apiSuccess(deliveredProjection);
  } catch (error) {
    return executionPlanRouteErrorResponse(error) ?? handleApiError(error);
  }
}
