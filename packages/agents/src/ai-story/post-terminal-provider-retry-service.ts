import type {
  AuthorizePostTerminalProviderRetryCommand,
  PostTerminalProviderRetryAuthorizationFact,
  SceneSchedulingBundle,
  ExecutionDispatch,
} from "@ceo-agent/shared";
import { createExecutionDispatch } from "@ceo-agent/shared";
import {
  ExecutionDispatchRepository,
  PostTerminalProviderRetryError,
  PostTerminalProviderRetryRepository,
} from "@ceo-agent/db";
import {
  SceneSchedulingCoordinator,
  type ScheduleAuthorizedSceneInput,
} from "./scene-scheduling-coordinator";

export type PostTerminalProviderRetryServiceDependencies = {
  readonly repository?: Pick<
    PostTerminalProviderRetryRepository,
    "authorize" | "getById"
  >;
  readonly schedulingCoordinator: Pick<
    SceneSchedulingCoordinator,
    "scheduleAuthorizedScene"
  >;
  readonly dispatchRepository?: Pick<ExecutionDispatchRepository, "createDispatch">;
};

export type PostTerminalRetrySchedulingAuthority = {
  readonly bundle: SceneSchedulingBundle;
  readonly dispatch: ExecutionDispatch;
};

/**
 * Human authorization and scheduling are intentionally separate operations.
 * Creating an authorization never schedules work. Creating retry authority
 * schedules only an execution-locked pre-dispatch bundle; it does not reserve,
 * create an Attempt, or invoke a Provider.
 */
export class PostTerminalProviderRetryService {
  private readonly repository: Pick<
    PostTerminalProviderRetryRepository,
    "authorize" | "getById"
  >;
  private readonly dispatchRepository: Pick<
    ExecutionDispatchRepository,
    "createDispatch"
  >;

  constructor(
    private readonly dependencies: PostTerminalProviderRetryServiceDependencies
  ) {
    this.repository =
      dependencies.repository ?? new PostTerminalProviderRetryRepository();
    this.dispatchRepository =
      dependencies.dispatchRepository ?? new ExecutionDispatchRepository();
  }

  authorize(
    command: AuthorizePostTerminalProviderRetryCommand
  ): Promise<PostTerminalProviderRetryAuthorizationFact> {
    return this.repository.authorize(command);
  }

  async createRetryAuthority(input: {
    readonly authorizationId: string;
    readonly executionPlanId: string;
    readonly sceneExecutionId: string;
    readonly workspaceId: string;
    readonly actorUserId: string;
    readonly runtimeAuthorizationId: string;
    readonly routingPolicy?: ScheduleAuthorizedSceneInput["routingPolicy"];
    readonly preferredProviders?: readonly string[];
  }): Promise<PostTerminalRetrySchedulingAuthority> {
    const authority = await this.repository.getById(input.authorizationId);
    if (
      !authority ||
      authority.executionPlanId !== input.executionPlanId ||
      authority.sceneExecutionId !== input.sceneExecutionId ||
      authority.workspaceId !== input.workspaceId ||
      authority.authorizedBy !== input.actorUserId ||
      authority.humanDecision !== "AUTHORIZE_ONE_RETRY"
    ) {
      throw new PostTerminalProviderRetryError(
        "POST_TERMINAL_RETRY_AUTHORIZATION_REQUIRED",
        "Exact explicit human post-terminal retry authorization is required",
        403
      );
    }
    const bundle = await this.dependencies.schedulingCoordinator.scheduleAuthorizedScene({
      executionPlanId: input.executionPlanId,
      sceneExecutionId: input.sceneExecutionId,
      runtimeAuthorizationId: input.runtimeAuthorizationId,
      commercialAuthorizationId: authority.commercialAuthorizationId,
      actorUserId: input.actorUserId,
      retryGeneration: authority.retryGeneration,
      postTerminalRetryAuthorization: authority,
      ...(input.routingPolicy ? { routingPolicy: input.routingPolicy } : {}),
      ...(input.preferredProviders
        ? { preferredProviders: input.preferredProviders }
        : {}),
    });
    const dispatch = await createExecutionDispatch({
      version: "1",
      jobId: bundle.outboxJobId,
      executionId: bundle.providerExecutionId,
      envelopeId: bundle.envelopeId,
      payloadReference: bundle.payloadReference,
      correlationId: bundle.correlation.correlationId,
      tenantId: bundle.correlation.ownership.orgId,
      workspaceId: bundle.correlation.ownership.workspaceId,
      capabilityId: bundle.routingDecision.capabilityId,
      capabilityVersion: bundle.routingDecision.capabilityVersion,
      requestHash: bundle.requestHash,
      envelopeHash: bundle.envelopeHash,
      workerHandoff: {
        envelopeId: bundle.envelopeId,
        payloadReference: bundle.payloadReference,
        dispatchContractVersion: "1",
      },
      createdAt: bundle.correlation.scheduledAt,
    });
    return {
      bundle,
      dispatch: await this.dispatchRepository.createDispatch(dispatch),
    };
  }
}
