import {
  AiStoryAssetAwareExecutionPlannerRepository,
  AiStoryLocalGenerationRepository,
} from "@ceo-agent/db";
import {
  validateAiStoryAuthorizedSchedulingAuthority,
  type AiStoryAuthorizedSchedulingAuthority,
} from "./asset-aware-execution-authority";
import {
  AiStoryLocalGenerationError,
  materializeLocalGenerationPackage,
} from "./local-generation-package";

export interface AiStoryLocalGenerationPreparationPort {
  prepare(input: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly storyId: string;
    readonly storyVersionId: string;
    readonly executionPlanId: string;
    readonly runtimeAuthorizationId: string;
    readonly orderedSceneExecutionIds: readonly string[];
    readonly actorUserId: string;
    readonly createdAt: string;
  }): Promise<{
    readonly packageIds: readonly string[];
    readonly unitIds: readonly string[];
    readonly replayed: boolean;
  }>;
}

export class AiStoryLocalGenerationService implements AiStoryLocalGenerationPreparationPort {
  constructor(
    private readonly authorities: Pick<AiStoryAssetAwareExecutionPlannerRepository, "getAuthorizedSchedulingAuthority"> =
      new AiStoryAssetAwareExecutionPlannerRepository(),
    private readonly packages = new AiStoryLocalGenerationRepository(),
  ) {}

  async prepare(input: Parameters<AiStoryLocalGenerationPreparationPort["prepare"]>[0]) {
    const requested: ReturnType<typeof materializeLocalGenerationPackage>[] = [];
    for (const [index, sceneExecutionId] of input.orderedSceneExecutionIds.entries()) {
      const record = await this.authorities.getAuthorizedSchedulingAuthority({
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        executionPlanId: input.executionPlanId,
        sceneExecutionId,
      });
      if (!record) {
        throw new AiStoryLocalGenerationError(
          "LOCAL_GENERATION_AUTHORITY_INVALID",
          `Scene ${sceneExecutionId} has no immutable Asset-Aware execution authority`,
        );
      }
      let authority: AiStoryAuthorizedSchedulingAuthority;
      try {
        authority = validateAiStoryAuthorizedSchedulingAuthority(record.authority);
      } catch (error) {
        throw new AiStoryLocalGenerationError(
          "LOCAL_GENERATION_AUTHORITY_INVALID",
          error instanceof Error ? error.message : "Invalid local Generation authority",
        );
      }
      if (
        authority.schedulingAuthorityId !== record.schedulingAuthorityId ||
        authority.authorityFingerprint !== record.authorityFingerprint ||
        authority.orgId !== input.orgId ||
        authority.workspaceId !== input.workspaceId ||
        authority.campaignId !== input.campaignId ||
        authority.storyId !== input.storyId ||
        authority.storyVersionId !== input.storyVersionId ||
        authority.executionPlanId !== input.executionPlanId ||
        authority.sceneExecutionId !== sceneExecutionId
      ) {
        throw new AiStoryLocalGenerationError(
          "LOCAL_GENERATION_AUTHORITY_INVALID",
          "Local Generation authority does not match canonical Execute ownership",
        );
      }
      requested.push(materializeLocalGenerationPackage({
        authority,
        runtimeAuthorizationId: input.runtimeAuthorizationId,
        order: index + 1,
        createdAt: input.createdAt,
        unitContext: await this.packages.loadUnitContext(sceneExecutionId,authority.compiledRequest.qcEvaluationId,authority.compiledRequest.qcFingerprint),
      }));
    }
    const accepted = await this.packages.insertOrConverge({
      packages: requested,
      createdBy: input.actorUserId,
    });
    return {
      packageIds: accepted.packages.map((item) => item.packageId),
      unitIds: accepted.packages.map((item) => item.unitId),
      replayed: accepted.replayed,
    };
  }
}
