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
import { resolveStagedReleaseCommercialAuthorization } from "./resolve-staged-release-commercial-authorization";
import { StagedSceneReleaseError } from "./staged-scene-release-error";

export { StagedSceneReleaseError } from "./staged-scene-release-error";

export async function releaseRemainingScenes(input: {
  executionPlanId: string; workspaceId: string; actorUserId: string;
  executionAuthorization: AiStoryExecutionAuthorization;
  router: ProviderRouter; routingPolicy?: ProviderRoutingPolicy; now?: () => Date;
  releaseRepository?: AiStorySceneReleaseRepository;
  authorizationRepository?: RuntimeAuthorizationPersistenceRepository;
  schedulingCoordinator?: SceneSchedulingCoordinator;
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
    released = await repo.releaseRemaining({
      executionPlanId: input.executionPlanId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      releasedAt: transitionAt,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "STAGED_RELEASE_DENIED";
    throw new StagedSceneReleaseError(code, code.replaceAll("_", " "), 409);
  }
  const coordinator = input.schedulingCoordinator ?? new SceneSchedulingCoordinator({ router: input.router });
  const remaining = released.rows.filter((row) => row.sceneOrder > 1 && row.releaseState === "RELEASED");
  for (const row of remaining) {
    await coordinator.scheduleAuthorizedScene({
      executionPlanId: input.executionPlanId,
      sceneExecutionId: row.sceneExecutionId,
      runtimeAuthorizationId: fact.runtimeAuthorizationId,
      commercialAuthorizationId,
      executionAuthorization: toAiStoryExecutionAuthorizationEvidence(input.executionAuthorization),
      actorUserId: input.actorUserId,
      routingPolicy: input.routingPolicy,
    });
  }
  return {
    executionPlanId: input.executionPlanId,
    releasedSceneCount: remaining.length,
    newlyReleasedSceneCount: released.newlyReleasedSceneIds.length,
    converged: released.newlyReleasedSceneIds.length === 0,
  };
}
