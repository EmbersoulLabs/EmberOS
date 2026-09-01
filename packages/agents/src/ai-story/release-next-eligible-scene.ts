import {
  AiStorySceneReleaseRepository,
  RuntimeAuthorizationPersistenceRepository,
} from "@ceo-agent/db";
import {
  toAiStoryExecutionAuthorizationEvidence,
  type AiStoryExecutionAuthorization,
} from "@ceo-agent/shared";
import type { ProviderRouter, ProviderRoutingPolicy } from "../provider-router";
import { CommercialAuthorizationService } from "../commercial/commercial-authorization-runtime";
import { SceneSchedulingCoordinator } from "./scene-scheduling-coordinator";
import { SceneSchedulingError } from "./scene-scheduling-coordinator";
import { resolveStagedReleaseCommercialAuthorization } from "./resolve-staged-release-commercial-authorization";
import { StagedSceneReleaseError } from "./staged-scene-release-error";

export async function releaseNextEligibleScene(input: {
  executionPlanId: string; workspaceId: string; actorUserId: string;
  executionAuthorization: AiStoryExecutionAuthorization;
  router: ProviderRouter; routingPolicy?: ProviderRoutingPolicy; now?: () => Date;
  releaseRepository?: Pick<AiStorySceneReleaseRepository, "releaseNextEligible">;
  authorizationRepository?: Pick<RuntimeAuthorizationPersistenceRepository, "getByExecutionPlanId">;
  schedulingCoordinator?: Pick<SceneSchedulingCoordinator, "scheduleAuthorizedScene">;
  commercialAuthorizationService?: Pick<CommercialAuthorizationService, "authorizeExecutionPlanExecute">;
}) {
  if (!input.executionAuthorization.allowed) {
    throw new StagedSceneReleaseError("AI_STORY_EXECUTION_DENIED", "AI Story execution is denied", 403);
  }
  const authRepo = input.authorizationRepository ?? new RuntimeAuthorizationPersistenceRepository();
  const fact = await authRepo.getByExecutionPlanId(input.executionPlanId);
  if (!fact || fact.ownership.workspaceId !== input.workspaceId) {
    throw new StagedSceneReleaseError("RUNTIME_AUTHORIZATION_REQUIRED", "Execution Plan is not authorized", 409);
  }
  const transitionAt = (input.now ?? (() => new Date()))();
  const commercialAuthorizationId =
    await resolveStagedReleaseCommercialAuthorization({
      executionPlanId: input.executionPlanId,
      orgId: fact.ownership.orgId,
      workspaceId: fact.ownership.workspaceId,
      executionAuthorization: input.executionAuthorization,
      authorizedAt: transitionAt,
      service: input.commercialAuthorizationService,
    });
  const repo = input.releaseRepository ?? new AiStorySceneReleaseRepository();
  let released;
  try {
    released = await repo.releaseNextEligible({
      executionPlanId: input.executionPlanId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      releasedAt: transitionAt,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "STAGED_RELEASE_DENIED";
    throw new StagedSceneReleaseError(code, code.replaceAll("_", " "), 409);
  }
  if (!released.selectedSceneExecutionId || !released.selectedSceneOrder) {
    throw new StagedSceneReleaseError("NO_NEXT_ELIGIBLE_SCENE", "No next eligible Scene", 409);
  }

  // RELEASED is durable release authority, not proof that scheduling completed.
  // Always converge the selected Scene so a crash/failure after the release
  // commit cannot strand RELEASED + missing scheduling authority.
  const coordinator = input.schedulingCoordinator ?? new SceneSchedulingCoordinator({ router: input.router });
  let scheduling;
  try {
    scheduling = await coordinator.scheduleAuthorizedScene({
      executionPlanId: input.executionPlanId,
      sceneExecutionId: released.selectedSceneExecutionId,
      runtimeAuthorizationId: fact.runtimeAuthorizationId,
      commercialAuthorizationId,
      executionAuthorization: toAiStoryExecutionAuthorizationEvidence(input.executionAuthorization),
      actorUserId: input.actorUserId,
      routingPolicy: input.routingPolicy,
    });
  } catch (error) {
    if (error instanceof SceneSchedulingError) {
      throw new StagedSceneReleaseError(error.code, error.message, 409);
    }
    throw error;
  }

  return {
    executionPlanId: input.executionPlanId,
    selectedSceneExecutionId: released.selectedSceneExecutionId,
    selectedSceneOrder: released.selectedSceneOrder,
    newlyReleasedSceneCount: released.newlyReleased ? 1 as const : 0 as const,
    scheduledSceneCount: 1 as const,
    converged: !released.newlyReleased && scheduling.replayed,
  };
}
