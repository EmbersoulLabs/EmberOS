/**
 * Sprint 3 PR 3.7 Phase D — Canonical product Execute entrypoint.
 *
 * POST /api/campaigns/:id/ai-stories/:storyId/execution-plans/:executionPlanId/execute
 *
 * Sole product-reachable authoritative Execute path.
 * Auth → ownership → authorizeAndExecuteExecutionPlan → STOP at API response.
 * Does NOT call Provider/Worker/Assembly/FSR directly.
 */
import {
  authorizeAndExecuteExecutionPlan,
  authorizeAiStoryExecution,
  AiStoryLocalGenerationService,
  bindExplicitLocalGpuRelease,
  CanonicalExecuteError,
  AiStoryExecutionDeniedError,
  LocalGpuAccessError,
  localGpuActorFromResolution,
} from "@ceo-agent/agents";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { resolveCanonicalWebExecuteProviderAuthority } from "@/lib/ai-story-canonical-execute-router";
import { resolvePlatformAdminForUser } from "@/lib/platform-admin-auth";
import { resolveCurrentSceneProductMaterialForScheduling } from "@/lib/ai-story-product-material-runtime";
import {
  CANONICAL_EXECUTE_FORBIDDEN_BODY_KEYS,
  CanonicalExecuteRequestSchema,
  PHASE1_EXECUTION_LOCKED,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import {
  executionPlanRouteErrorResponse,
  resolveAuthorizedExecutionPlan,
} from "@/lib/ai-story-execution-plan-access";

type RouteParams = {
  params: Promise<{ id: string; storyId: string; executionPlanId: string }>;
};

function rejectForbiddenBodyKeys(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  for (const key of CANONICAL_EXECUTE_FORBIDDEN_BODY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return key;
    }
  }
  return null;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, executionPlanId } = await params;

    const raw = await request.text();
    let body: unknown = {};
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        return apiError("Invalid JSON body", "VALIDATION_ERROR", 422);
      }
    }

    const forbidden = rejectForbiddenBodyKeys(body);
    if (forbidden) {
      return apiError(
        `Forbidden Execute authority field: ${forbidden}`,
        "EXECUTE_FORBIDDEN_FIELD",
        422
      );
    }

    const parsed = CanonicalExecuteRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "Canonical Execute accepts an empty object body only",
        "VALIDATION_ERROR",
        422
      );
    }

    const ctx = await resolveAuthorizedExecutionPlan({
      userId: user.id,
      campaignId,
      storyId,
      executionPlanId,
      minRole: "operator",
    });

    if (ctx.verificationFixture) {
      return apiError(
        "Production verification fixtures require the server-only verification authority",
        "AI_STORY_PRODUCTION_VERIFICATION_REQUIRED",
        403
      );
    }

    const executionAuthorization = await authorizeAiStoryExecution({
      user,
      orgId: ctx.orgId,
      workspaceId: ctx.workspaceId,
      minRole: "operator",
      clientClaims: body,
    });

    if (parsed.data.explicitProvider === "LOCAL_GPU") {
      const resolution = await resolvePlatformAdminForUser(user);
      const [organization] = await getDb()
        .select({ plan: schema.organizations.plan })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, ctx.orgId))
        .limit(1);
      const providerRouting = await resolveCanonicalWebExecuteProviderAuthority({
        requestedProvider: "LOCAL_GPU",
        actor: localGpuActorFromResolution({
          userId: user.id,
          workspaceId: ctx.workspaceId,
          organizationPlan: organization?.plan ?? null,
          resolution,
        }),
      });
      if (providerRouting.localGpu.kind !== "LOCAL_GPU") {
        throw new LocalGpuAccessError("LOCAL_GPU_ACCESS_DENIED");
      }
      const prepared = await authorizeAndExecuteExecutionPlan({
        executionPlanId: ctx.executionPlanId,
        actorUserId: user.id,
        ownership: {
          orgId: ctx.orgId,
          workspaceId: ctx.workspaceId,
          campaignId: ctx.campaignId,
          storyId: ctx.storyId,
          storyVersionId: ctx.plan.storyVersionId,
          animationPackageId: ctx.plan.animationPackageId,
          executionPlanId: ctx.executionPlanId,
        },
        executionMode: "MANUAL_LOCAL",
        executionAuthorization,
        localGenerationService: new AiStoryLocalGenerationService({
          productMaterial: resolveCurrentSceneProductMaterialForScheduling,
        }),
      });
      const bound = await bindExplicitLocalGpuRelease({
        workspaceId: ctx.workspaceId,
        executionPlanId: ctx.executionPlanId,
      });
      return apiSuccess(
        {
          ...prepared.response,
          phase1LockRemainsOnLegacyPaths: true as const,
          selectiveUnlockPath: "canonical-execute" as const,
          localGpuPackageId: bound.packageId,
          videoExecutionPolicy: {
            mode: "LOCAL_GPU" as const,
            provider: "LOCAL_GPU" as const,
            workflow: "MINIMAX_H3_R2V" as const,
            localManualHandoff: false as const,
            seedanceEnabledForNormalExecution: false as const,
            seedanceAutoFallback: false as const,
            runwayAutoFallback: false as const,
            automaticGenerationRetry: 0 as const,
            remoteProviderFallback: 0 as const,
            cloudVideoProviderCostUsd: 0 as const,
          },
          executionLockCode: PHASE1_EXECUTION_LOCKED,
        },
        prepared.httpStatus
      );
    }

    const ownership = {
      orgId: ctx.orgId,
      workspaceId: ctx.workspaceId,
      campaignId: ctx.campaignId,
      storyId: ctx.storyId,
      storyVersionId: ctx.plan.storyVersionId,
      animationPackageId: ctx.plan.animationPackageId,
      executionPlanId: ctx.executionPlanId,
    };

    const result = await authorizeAndExecuteExecutionPlan({
      executionPlanId: ctx.executionPlanId,
      actorUserId: user.id,
      ownership,
      executionMode: "MANUAL_LOCAL",
      executionAuthorization,
      localGenerationService: new AiStoryLocalGenerationService({
        productMaterial: resolveCurrentSceneProductMaterialForScheduling,
      }),
    });

    return apiSuccess(
      {
        ...result.response,
        // Explicit lock stamp for legacy-path clarity; selective Execute is allowed.
        phase1LockRemainsOnLegacyPaths: true as const,
        selectiveUnlockPath: "canonical-execute" as const,
        videoExecutionPolicy: {
          mode: "MANUAL_LOCAL" as const,
          localManualHandoff: true as const,
          seedanceEnabledForNormalExecution: false as const,
          seedanceAutoFallback: false as const,
          runwayAutoFallback: false as const,
          cloudVideoProviderCostUsd: 0 as const,
        },
        executionLockCode: PHASE1_EXECUTION_LOCKED,
      },
      result.httpStatus
    );
  } catch (error) {
    if (error instanceof AiStoryExecutionDeniedError || error instanceof LocalGpuAccessError) {
      const code = error instanceof LocalGpuAccessError ? error.message : error.code;
      const status = error instanceof LocalGpuAccessError ? 403 : error.status;
      return apiError(error.message, code, status);
    }
    if (error instanceof CanonicalExecuteError) {
      return apiError(error.message, error.code, error.status);
    }
    return (
      executionPlanRouteErrorResponse(error) ?? handleApiError(error)
    );
  }
}
