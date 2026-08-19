import {
  AiStorySceneCompiledInstructionsSchema,
  PHASE1_EXECUTION_LOCKED,
  PersistedSceneRoutingDecisionSchema,
  ProviderExecutionSchema,
  SCENE_ROUTING_DECISION_CONTRACT_VERSION,
  SCENE_ROUTER_VERSION,
  SCENE_SCHEDULING_CONTRACT_VERSION,
  SceneProviderSchedulingCorrelationSchema,
  SceneSchedulingBundleSchema,
  createExecutionEnvelope,
  type AiStoryExecutionAuthorizationEvidence,
  type AiStorySceneCompiledInstructions,
  type AiStorySceneExecutionIntent,
  type CanonicalProviderRequest,
  type PersistedSceneRoutingDecision,
  type ProviderExecution,
  type RuntimeAuthorizedFact,
  type SceneProviderSchedulingCorrelation,
  type SceneSchedulingBundle,
  type SceneSchedulingErrorCode,
} from "@ceo-agent/shared";
import {
  AiStorySceneExecutionPersistenceRepository,
  ExecutionPlanAssemblyRepository,
  RuntimeAuthorizationPersistenceRepository,
  SceneSchedulingError,
  SceneSchedulingRepository,
  CommercialAuthorizationRepositoryImpl,
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
  type CommercialAuthorizationRepository,
} from "@ceo-agent/db";
import { commercialExecutionIdentityForPlan } from "@ceo-agent/shared/server";
import {
  NoEligibleProviderError,
  type ProviderRouter,
  type ProviderRoutingDecision,
  type ProviderRoutingPolicy,
  type ProviderRoutingRequest,
} from "../provider-router";
import {
  SCENE_PROVIDER_CAPABILITY_ID,
  SCENE_PROVIDER_CAPABILITY_VERSION,
  SCENE_PROVIDER_REQUEST_SCHEMA_VERSION,
  SCENE_PROVIDER_RESULT_SCHEMA_VERSION,
  buildCanonicalSceneProviderRequest,
} from "./canonical-scene-provider-request";

export { SceneSchedulingError };

export type SceneSchedulingIntegrityInput = {
  readonly ownership: RuntimeAuthorizedFact["ownership"];
  readonly sceneExecutionId: string;
  readonly runtimeAuthorizationId: string;
  readonly authorizationHash: string;
  readonly routingDecisionHash: string;
  readonly requestHash: string;
  readonly envelopeHash: string;
  readonly providerExecutionId: string;
  readonly envelopeId: string;
  readonly outboxJobId: string;
};

export function buildSceneSchedulingIntegrityPayload(
  input: SceneSchedulingIntegrityInput
): Record<string, unknown> {
  return {
    kind: "scene-scheduling-correlation",
    schedulingContractVersion: SCENE_SCHEDULING_CONTRACT_VERSION,
    ownership: input.ownership,
    sceneExecutionId: input.sceneExecutionId,
    runtimeAuthorizationId: input.runtimeAuthorizationId,
    authorizationHash: input.authorizationHash,
    routingDecisionHash: input.routingDecisionHash,
    requestHash: input.requestHash,
    envelopeHash: input.envelopeHash,
    providerExecutionId: input.providerExecutionId,
    envelopeId: input.envelopeId,
    outboxJobId: input.outboxJobId,
    automaticFallbackEnabled: false,
    executionAllowed: false,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
  };
}

export function computeSceneSchedulingIdentityHash(
  input: SceneSchedulingIntegrityInput
): string {
  return canonicalPersistenceHash(buildSceneSchedulingIntegrityPayload(input));
}

export function classifySceneSchedulingConflict(
  code: SceneSchedulingErrorCode
): SceneSchedulingError {
  return new SceneSchedulingError(code, `Scene scheduling conflict: ${code}`);
}

export type ScheduleAuthorizedSceneInput = {
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
  /** Required. Scheduling loads the canonical persisted RuntimeAuthorizedFact only. */
  readonly runtimeAuthorizationId: string;
  /**
   * Required for commercial settlement. Omitted when EXEC-03 ops/non-commercial
   * authorization explicitly selected settlementMode=none.
   */
  readonly commercialAuthorizationId?: string;
  readonly executionAuthorization?: AiStoryExecutionAuthorizationEvidence;
  readonly actorUserId: string;
  readonly routingPolicy?: ProviderRoutingPolicy;
  readonly preferredProviders?: readonly string[];
  /**
   * EXEC-04 product retry generation. 1 = first schedule (identity unchanged).
   * Values > 1 create a new provider execution of the same frozen Scene.
   */
  readonly retryGeneration?: number;
};

export type SceneSchedulingCoordinatorDependencies = {
  readonly router: ProviderRouter;
  readonly authRepo?: Pick<RuntimeAuthorizationPersistenceRepository, "getById">;
  readonly commercialAuthRepo?: Pick<CommercialAuthorizationRepository, "getById">;
  readonly schedulingRepo?: Pick<
    SceneSchedulingRepository,
    | "scheduleAcceptedBundle"
    | "getRoutingDecisionBySceneExecutionId"
    | "getAcceptedBundleBySceneExecutionId"
  >;
  readonly persistenceRepo?: Pick<
    AiStorySceneExecutionPersistenceRepository,
    "getByExecutionPlanId" | "getValidationResults"
  >;
  readonly assemblyRepo?: Pick<ExecutionPlanAssemblyRepository, "listMemberships">;
  readonly now?: () => Date;
};

const DEFAULT_ROUTING_POLICY: ProviderRoutingPolicy = {
  policyVersion: "1.0.0",
  preferredProviders: [],
  requireTrainingOptOut: true,
};

function assertOwnershipMatchesScene(
  fact: RuntimeAuthorizedFact,
  intent: AiStorySceneExecutionIntent
): void {
  const id = intent.identity;
  const ownership = fact.ownership;
  if (
    ownership.orgId !== id.tenantId ||
    ownership.workspaceId !== id.workspaceId ||
    ownership.campaignId !== id.campaignId ||
    ownership.storyId !== id.storyId ||
    ownership.storyVersionId !== id.storyVersionId ||
    ownership.animationPackageId !== id.animationPackageId ||
    ownership.executionPlanId !== fact.executionPlanId
  ) {
    throw new SceneSchedulingError(
      "OWNERSHIP_INTEGRITY_VIOLATION",
      "RuntimeAuthorizedFact ownership does not match the Scene Execution identity"
    );
  }
}

function identitySeed(input: {
  readonly sceneExecutionId: string;
  readonly runtimeAuthorizationId: string;
  readonly instructionHash: string;
  readonly routingDecisionHash?: string;
  readonly retryGeneration?: number;
}) {
  return {
    sceneExecutionId: input.sceneExecutionId,
    runtimeAuthorizationId: input.runtimeAuthorizationId,
    instructionHash: input.instructionHash,
    routingDecisionHash: input.routingDecisionHash ?? null,
    ...(input.retryGeneration && input.retryGeneration > 1
      ? { retryGeneration: input.retryGeneration }
      : {}),
  };
}

function sanitizePreferredProviders(
  preferred: readonly string[],
  policy: ProviderRoutingPolicy
): readonly string[] {
  const allowed = policy.allowedProviders;
  const denied = new Set(policy.deniedProviders ?? []);
  return preferred.filter((providerId) => {
    if (denied.has(providerId)) return false;
    if (allowed && !allowed.includes(providerId)) return false;
    return true;
  });
}

function effectiveRoutingPolicy(input: ScheduleAuthorizedSceneInput): ProviderRoutingPolicy {
  const base = input.routingPolicy ?? DEFAULT_ROUTING_POLICY;
  const preferred = sanitizePreferredProviders(
    input.preferredProviders ? [...input.preferredProviders] : [...base.preferredProviders],
    base
  );
  return {
    ...base,
    preferredProviders: [...preferred],
  };
}

function buildRoutingRequest(input: {
  readonly fact: RuntimeAuthorizedFact;
  readonly sceneExecutionId: string;
  readonly instructionHash: string;
  readonly correlationId: string;
  readonly policy: ProviderRoutingPolicy;
  readonly preferredProviders?: readonly string[];
}): ProviderRoutingRequest {
  return {
    routingRequestId: deterministicPersistenceUuid(
      "ai-story-scene-provider-routing-request",
      identitySeed({
        sceneExecutionId: input.sceneExecutionId,
        runtimeAuthorizationId: input.fact.runtimeAuthorizationId,
        instructionHash: input.instructionHash,
      })
    ),
    capabilityId: SCENE_PROVIDER_CAPABILITY_ID,
    capabilityVersion: SCENE_PROVIDER_CAPABILITY_VERSION,
    requestSchemaVersion: SCENE_PROVIDER_REQUEST_SCHEMA_VERSION,
    resultSchemaVersion: SCENE_PROVIDER_RESULT_SCHEMA_VERSION,
    tenantId: input.fact.ownership.orgId,
    workspaceId: input.fact.ownership.workspaceId,
    correlationId: input.correlationId,
    policyVersion: input.policy.policyVersion,
    requiredFeatures: ["LOOKUP"],
    requireLookup: true,
    requireCancellation: false,
    requireCallbacks: false,
    requireStreaming: false,
    preferredProviders: [
      ...(input.preferredProviders && input.preferredProviders.length > 0
        ? input.preferredProviders
        : input.policy.preferredProviders),
    ],
    dataHandling: {
      sensitiveData: false,
      externalProcessingAllowed: true,
      providerTrainingAllowed: false,
      enterpriseControlsRequired: false,
      zeroRetentionRequired: false,
    },
  };
}

function candidateSummary(decision: ProviderRoutingDecision) {
  const selected = {
    providerId: decision.selectedProviderId,
    adapterVersion: decision.selectedAdapterVersion,
    selected: true,
    scoreTotal: decision.score.total,
    exclusionCodes: [],
  };
  const excluded = decision.excludedCandidates.map((candidate) => ({
    providerId: candidate.providerId,
    adapterVersion: candidate.adapterVersion,
    selected: false,
    exclusionCodes: candidate.reasons.map((reason) => reason.code),
  }));
  return [selected, ...excluded].sort(
    (left, right) =>
      Number(right.selected) - Number(left.selected) ||
      left.providerId.localeCompare(right.providerId) ||
      left.adapterVersion.localeCompare(right.adapterVersion)
  );
}

function buildRoutingDecision(input: {
  readonly fact: RuntimeAuthorizedFact;
  readonly sceneExecutionId: string;
  readonly route: ProviderRoutingDecision;
  readonly policy: ProviderRoutingPolicy;
  readonly decidedAt: string;
}): PersistedSceneRoutingDecision {
  const deterministicIntegrityHash = canonicalPersistenceHash({
    kind: "ai-story-scene-routing-decision",
    executionPlanId: input.fact.executionPlanId,
    sceneExecutionId: input.sceneExecutionId,
    runtimeAuthorizationId: input.fact.runtimeAuthorizationId,
    routeDecisionHash: input.route.decisionHash,
    selectedProviderId: input.route.selectedProviderId,
    selectedAdapterVersion: input.route.selectedAdapterVersion,
    routerVersion: SCENE_ROUTER_VERSION,
    registrySnapshotHash: input.route.registrySnapshotHash,
    policySnapshot: input.policy,
    automaticFallbackEnabled: false,
  });

  return PersistedSceneRoutingDecisionSchema.parse({
    routingDecisionId: deterministicPersistenceUuid(
      "ai-story-scene-routing-decision",
      deterministicIntegrityHash
    ),
    executionPlanId: input.fact.executionPlanId,
    sceneExecutionId: input.sceneExecutionId,
    runtimeAuthorizationId: input.fact.runtimeAuthorizationId,
    capabilityId: SCENE_PROVIDER_CAPABILITY_ID,
    capabilityVersion: SCENE_PROVIDER_CAPABILITY_VERSION,
    selectedProviderId: input.route.selectedProviderId,
    selectedAdapterVersion: input.route.selectedAdapterVersion,
    routerVersion: SCENE_ROUTER_VERSION,
    registrySnapshotHash: input.route.registrySnapshotHash,
    capabilitySnapshot: input.route.selectedCapability as unknown as Record<string, unknown>,
    policySnapshot: input.policy as unknown as Record<string, unknown>,
    candidateSummary: candidateSummary(input.route),
    decidedAt: input.decidedAt,
    deterministicIntegrityHash,
    automaticFallbackEnabled: false,
    contractVersion: SCENE_ROUTING_DECISION_CONTRACT_VERSION,
    ownership: input.fact.ownership,
  });
}

function buildProviderExecution(input: {
  readonly canonicalRequest: CanonicalProviderRequest;
  readonly correlationId: string;
  readonly outboxJobId: string;
  readonly createdAt: string;
}): ProviderExecution {
  return ProviderExecutionSchema.parse({
    contractVersion: "1",
    identity: input.canonicalRequest.executionIdentity,
    metadata: {
      skillId: "ai-story-scene-scheduling",
      skillVersion: "1.0.0",
      contextVersions: input.canonicalRequest.contextVersions,
      outputSchemaId: input.canonicalRequest.outputSchema.schemaId,
      outputSchemaVersion: input.canonicalRequest.outputSchema.schemaVersion,
      correlationId: input.correlationId,
      queueJobId: input.outboxJobId,
      createdAt: input.createdAt,
    },
    status: "PENDING",
    createdAt: input.createdAt,
  });
}

function buildCorrelation(input: {
  readonly fact: RuntimeAuthorizedFact;
  readonly routingDecision: PersistedSceneRoutingDecision;
  readonly providerExecutionId: string;
  readonly envelopeId: string;
  readonly outboxJobId: string;
  readonly requestHash: string;
  readonly envelopeHash: string;
  readonly correlationId: string;
  readonly scheduledAt: string;
  readonly scheduledBy: string;
}): SceneProviderSchedulingCorrelation {
  const schedulingIdentityHash = computeSceneSchedulingIdentityHash({
    ownership: input.fact.ownership,
    sceneExecutionId: input.routingDecision.sceneExecutionId,
    runtimeAuthorizationId: input.fact.runtimeAuthorizationId,
    authorizationHash: input.fact.deterministicIntegrityHash,
    routingDecisionHash: input.routingDecision.deterministicIntegrityHash,
    requestHash: input.requestHash,
    envelopeHash: input.envelopeHash,
    providerExecutionId: input.providerExecutionId,
    envelopeId: input.envelopeId,
    outboxJobId: input.outboxJobId,
  });

  return SceneProviderSchedulingCorrelationSchema.parse({
    correlationId: input.correlationId,
    executionPlanId: input.fact.executionPlanId,
    sceneExecutionId: input.routingDecision.sceneExecutionId,
    runtimeAuthorizationId: input.fact.runtimeAuthorizationId,
    routingDecisionId: input.routingDecision.routingDecisionId,
    providerExecutionId: input.providerExecutionId,
    envelopeId: input.envelopeId,
    outboxJobId: input.outboxJobId,
    requestHash: input.requestHash,
    envelopeHash: input.envelopeHash,
    routingDecisionHash: input.routingDecision.deterministicIntegrityHash,
    authorizationHash: input.fact.deterministicIntegrityHash,
    schedulingIdentityHash,
    ownership: input.fact.ownership,
    contractVersion: SCENE_SCHEDULING_CONTRACT_VERSION,
    scheduledAt: input.scheduledAt,
    scheduledBy: input.scheduledBy,
  });
}

export class SceneSchedulingCoordinator {
  private readonly authRepo: Pick<RuntimeAuthorizationPersistenceRepository, "getById">;
  private readonly commercialAuthRepo: Pick<
    CommercialAuthorizationRepository,
    "getById"
  >;
  private readonly schedulingRepo: Pick<
    SceneSchedulingRepository,
    | "scheduleAcceptedBundle"
    | "getAcceptedBundleBySceneExecutionId"
    | "getRoutingDecisionBySceneExecutionId"
  >;
  private readonly persistenceRepo: Pick<
    AiStorySceneExecutionPersistenceRepository,
    "getByExecutionPlanId" | "getValidationResults"
  >;
  private readonly assemblyRepo: Pick<ExecutionPlanAssemblyRepository, "listMemberships">;
  private readonly now: () => Date;

  constructor(private readonly dependencies: SceneSchedulingCoordinatorDependencies) {
    this.authRepo =
      dependencies.authRepo ?? new RuntimeAuthorizationPersistenceRepository();
    this.commercialAuthRepo =
      dependencies.commercialAuthRepo ??
      new CommercialAuthorizationRepositoryImpl();
    this.schedulingRepo =
      dependencies.schedulingRepo ?? new SceneSchedulingRepository();
    this.persistenceRepo =
      dependencies.persistenceRepo ?? new AiStorySceneExecutionPersistenceRepository();
    this.assemblyRepo =
      dependencies.assemblyRepo ?? new ExecutionPlanAssemblyRepository();
    this.now = dependencies.now ?? (() => new Date());
  }

  async scheduleAuthorizedScene(
    input: ScheduleAuthorizedSceneInput
  ): Promise<SceneSchedulingBundle> {
    try {
      const fact = await this.loadPersistedAuthorization(input);
      await this.assertCommercialAuthorization(input, fact);
      if (fact.executionPlanId !== input.executionPlanId) {
        throw new SceneSchedulingError(
          "IDENTITY_CONFLICT",
          "RuntimeAuthorizedFact belongs to a different Execution Plan"
        );
      }
      if (!fact.orderedSceneExecutionIds.includes(input.sceneExecutionId)) {
        throw new SceneSchedulingError(
          "SCENE_NOT_AUTHORIZED",
          "Scene Execution is not covered by the RuntimeAuthorizedFact"
        );
      }

      const retryGeneration = input.retryGeneration ?? 1;
      const acceptedBundle =
        retryGeneration <= 1
          ? await this.schedulingRepo.getAcceptedBundleBySceneExecutionId(
              input.sceneExecutionId
            )
          : null;
      if (acceptedBundle) {
        this.assertAcceptedBundleMatchesInput(acceptedBundle, input, fact);
        return SceneSchedulingBundleSchema.parse({
          ...acceptedBundle,
          replayed: true,
          executionAllowed: false,
          executionLockCode: PHASE1_EXECUTION_LOCKED,
          automaticFallbackEnabled: false,
        });
      }

      const compilation = await this.persistenceRepo.getByExecutionPlanId(
        input.executionPlanId
      );
      if (!compilation) {
        throw new SceneSchedulingError(
          "OWNERSHIP_INTEGRITY_VIOLATION",
          "Execution Plan is not persisted"
        );
      }

      const sceneIntent = compilation.intents.find(
        (candidate) => candidate.identity.sceneExecutionId === input.sceneExecutionId
      );
      if (!sceneIntent) {
        throw new SceneSchedulingError(
          "SCENE_NOT_AUTHORIZED",
          "Scene Execution is not part of the Execution Plan"
        );
      }
      assertOwnershipMatchesScene(fact, sceneIntent);
      if (compilation.plan.storyExecutionId !== input.executionPlanId) {
        throw new SceneSchedulingError(
          "IDENTITY_CONFLICT",
          "Persisted Execution Plan identity conflicts with request"
        );
      }

      const memberships = await this.assemblyRepo.listMemberships(
        fact.assemblyDefinitionId
      );
      const membershipSceneIds = memberships.map(
        (membership) => membership.sceneExecutionId
      );
      if (
        membershipSceneIds.length !== fact.orderedSceneExecutionIds.length ||
        membershipSceneIds.some(
          (sceneExecutionId, index) =>
            sceneExecutionId !== fact.orderedSceneExecutionIds[index]
        ) ||
        !membershipSceneIds.includes(input.sceneExecutionId)
      ) {
        throw new SceneSchedulingError(
          "SCENE_SCHEDULING_NOT_ELIGIBLE",
          "Assembly membership does not match the RuntimeAuthorizedFact ordering"
        );
      }

      const validationResults = await this.persistenceRepo.getValidationResults(
        input.sceneExecutionId
      );
      if (
        validationResults.length === 0 ||
        validationResults.some((result) => result.status === "failed")
      ) {
        throw new SceneSchedulingError(
          "QC_BLOCKED",
          "Scene QC is missing or failed"
        );
      }

      const instructions = AiStorySceneCompiledInstructionsSchema.parse(
        compilation.instructionsBySceneExecutionId[input.sceneExecutionId]
      ) as AiStorySceneCompiledInstructions;
      const instructionHash = sceneIntent.normalizedPayloadReference.contentHash;
      const seedBeforeRouting = identitySeed({
        sceneExecutionId: input.sceneExecutionId,
        runtimeAuthorizationId: fact.runtimeAuthorizationId,
        instructionHash,
        retryGeneration,
      });
      const correlationId = deterministicPersistenceUuid(
        "ai-story-scene-scheduling-correlation",
        seedBeforeRouting
      );
      const policy = effectiveRoutingPolicy(input);
      const preferredProviders = policy.preferredProviders;
      const existingRoutingDecision =
        await this.schedulingRepo.getRoutingDecisionBySceneExecutionId(
          input.sceneExecutionId
        );
      if (!existingRoutingDecision && policy.allowedProviders?.length === 0) {
        throw new SceneSchedulingError(
          "NO_EXECUTABLE_PROVIDER",
          "No executable provider is available for Scene scheduling"
        );
      }
      const acceptedRoutingDecision = existingRoutingDecision
        ? existingRoutingDecision
        : buildRoutingDecision({
            fact,
            sceneExecutionId: input.sceneExecutionId,
            route: await this.dependencies.router.route(
              buildRoutingRequest({
                fact,
                sceneExecutionId: input.sceneExecutionId,
                instructionHash,
                correlationId,
                policy,
                preferredProviders,
              }),
              policy
            ),
            policy,
            decidedAt: this.now().toISOString(),
          });
      // Derive schedule clocks from the authoritative routing decision time so
      // concurrent equivalent schedules converge on identical identity payloads.
      const scheduledAt = acceptedRoutingDecision.decidedAt;
      const timeoutDeadline = new Date(
        Date.parse(scheduledAt) + 600_000
      ).toISOString();
      const seed = identitySeed({
        sceneExecutionId: input.sceneExecutionId,
        runtimeAuthorizationId: fact.runtimeAuthorizationId,
        instructionHash,
        routingDecisionHash: acceptedRoutingDecision.deterministicIntegrityHash,
        retryGeneration,
      });
      const outboxJobId = deterministicPersistenceUuid(
        "ai-story-scene-outbox-job",
        seed
      );
      const envelopeId = deterministicPersistenceUuid(
        "ai-story-scene-execution-envelope",
        seed
      );
      const request = buildCanonicalSceneProviderRequest({
        runtimeAuthorization: fact,
        routingDecision: acceptedRoutingDecision,
        sceneIntent,
        instructions,
        correlationId,
        createdAt: scheduledAt,
        timeoutDeadline,
        retryGeneration,
      });
      const providerExecution = buildProviderExecution({
        canonicalRequest: request.canonicalRequest,
        correlationId,
        outboxJobId,
        createdAt: scheduledAt,
      });
      const envelope = await createExecutionEnvelope({
        version: "1",
        envelopeId,
        payloadReference: request.payloadReference,
        tenantId: fact.ownership.orgId,
        workspaceId: fact.ownership.workspaceId,
        executionContext: {
          executionId: providerExecution.identity.executionId,
          correlationId,
          pipelineRunId: providerExecution.identity.pipelineRunId,
          idempotencyKey: providerExecution.identity.idempotencyKey,
          timeoutDeadline,
          dataHandling: {
            sensitiveData: false,
            externalProcessingAllowed: true,
            providerTrainingAllowed: false,
          },
          trace: {
            executionPlanId: input.executionPlanId,
            sceneExecutionId: input.sceneExecutionId,
            runtimeAuthorizationId: fact.runtimeAuthorizationId,
          },
        },
        capabilityId: SCENE_PROVIDER_CAPABILITY_ID,
        capabilityVersion: SCENE_PROVIDER_CAPABILITY_VERSION,
        providerPolicySnapshot: {
          policyVersion: policy.policyVersion,
          routingDecisionId: acceptedRoutingDecision.routingDecisionId,
          routingDecisionHash: acceptedRoutingDecision.deterministicIntegrityHash,
          automaticFallbackEnabled: false,
        },
        canonicalRequest: request.canonicalRequest,
        createdAt: scheduledAt,
      });
      if (request.requestContentHash !== envelope.requestHash) {
        throw new SceneSchedulingError(
          "EXECUTION_ENVELOPE_CONFLICT",
          "Canonical request hash conflicts with Execution Envelope"
        );
      }
      const correlation = buildCorrelation({
        fact,
        routingDecision: acceptedRoutingDecision,
        providerExecutionId: providerExecution.identity.executionId,
        envelopeId: envelope.envelopeId,
        outboxJobId,
        requestHash: envelope.requestHash,
        envelopeHash: envelope.envelopeHash,
        correlationId,
        scheduledAt,
        scheduledBy: input.actorUserId,
      });

      const bundle = await this.schedulingRepo.scheduleAcceptedBundle({
        runtimeAuthorizedFact: fact,
        routingDecision: acceptedRoutingDecision,
        providerExecution,
        requestHash: envelope.requestHash,
        envelope,
        outboxJob: {
          jobId: outboxJobId,
          executionId: providerExecution.identity.executionId,
          payloadReference: envelope.payloadReference,
          correlationId,
          nextVisibleAt: new Date(scheduledAt),
        },
        correlation,
        scheduledBy: input.actorUserId,
      });

      return SceneSchedulingBundleSchema.parse({
        ...bundle,
        executionAllowed: false,
        executionLockCode: PHASE1_EXECUTION_LOCKED,
        automaticFallbackEnabled: false,
      });
    } catch (error) {
      if (error instanceof NoEligibleProviderError) {
        throw new SceneSchedulingError(
          error.details.exclusions.length === 0
            ? "NO_EXECUTABLE_PROVIDER"
            : "NO_ELIGIBLE_PROVIDER",
          error.message
        );
      }
      throw error;
    }
  }

  private async loadPersistedAuthorization(
    input: ScheduleAuthorizedSceneInput
  ): Promise<RuntimeAuthorizedFact> {
    const fact = await this.authRepo.getById(input.runtimeAuthorizationId);
    if (!fact) {
      throw new SceneSchedulingError(
        "RUNTIME_AUTHORIZATION_REQUIRED",
        "RuntimeAuthorizedFact was not found"
      );
    }
    return fact;
  }

  private async assertCommercialAuthorization(
    input: ScheduleAuthorizedSceneInput,
    fact: RuntimeAuthorizedFact
  ): Promise<void> {
    const evidence =
      input.executionAuthorization ?? fact.executionAuthorization;
    if (evidence?.settlementMode === "none") {
      if (evidence.accessMode !== "ops") {
        throw new SceneSchedulingError(
          "COMMERCIAL_AUTHORIZATION_DENIED",
          "Non-commercial scheduling requires ops accessMode"
        );
      }
      if (input.commercialAuthorizationId?.trim()) {
        throw new SceneSchedulingError(
          "COMMERCIAL_AUTHORIZATION_DENIED",
          "Ops execution must not carry a commercial authorization id"
        );
      }
      return;
    }

    if (!input.commercialAuthorizationId?.trim()) {
      throw new SceneSchedulingError(
        "COMMERCIAL_AUTHORIZATION_REQUIRED",
        "Commercial Authorization ID is required for billable scheduling"
      );
    }
    const authorization = await this.commercialAuthRepo.getById(
      input.commercialAuthorizationId
    );
    if (!authorization) {
      throw new SceneSchedulingError(
        "COMMERCIAL_AUTHORIZATION_REQUIRED",
        "Commercial Authorization was not found"
      );
    }
    const expectedIdentity = commercialExecutionIdentityForPlan(
      input.executionPlanId
    );
    if (
      authorization.orgId !== fact.ownership.orgId ||
      authorization.workspaceId !== fact.ownership.workspaceId ||
      authorization.capabilityKey !== "ai_story.execute" ||
      authorization.executionIdentity !== expectedIdentity ||
      authorization.commercialAuthorizationId !==
        input.commercialAuthorizationId
    ) {
      throw new SceneSchedulingError(
        "COMMERCIAL_AUTHORIZATION_DENIED",
        "Commercial Authorization does not match Execution Plan ownership"
      );
    }
  }

  private assertAcceptedBundleMatchesInput(
    bundle: SceneSchedulingBundle,
    input: ScheduleAuthorizedSceneInput,
    fact: RuntimeAuthorizedFact
  ): void {
    if (
      bundle.runtimeAuthorization.runtimeAuthorizationId !==
        input.runtimeAuthorizationId ||
      bundle.runtimeAuthorization.runtimeAuthorizationId !==
        fact.runtimeAuthorizationId ||
      bundle.runtimeAuthorization.executionPlanId !== input.executionPlanId ||
      bundle.correlation.executionPlanId !== input.executionPlanId ||
      bundle.correlation.sceneExecutionId !== input.sceneExecutionId ||
      bundle.correlation.runtimeAuthorizationId !== input.runtimeAuthorizationId
    ) {
      throw new SceneSchedulingError(
        "IDENTITY_CONFLICT",
        "Accepted Scene scheduling bundle conflicts with request identity"
      );
    }
  }

  private reuseEquivalentRoutingDecision(
    existing: PersistedSceneRoutingDecision,
    candidate: PersistedSceneRoutingDecision
  ): PersistedSceneRoutingDecision {
    if (
      existing.deterministicIntegrityHash !== candidate.deterministicIntegrityHash ||
      existing.selectedProviderId !== candidate.selectedProviderId ||
      existing.selectedAdapterVersion !== candidate.selectedAdapterVersion ||
      existing.routerVersion !== candidate.routerVersion ||
      existing.registrySnapshotHash !== candidate.registrySnapshotHash
    ) {
      throw new SceneSchedulingError(
        "ROUTING_DECISION_CONFLICT",
        "Persisted routing decision conflicts with candidate provider route"
      );
    }
    return existing;
  }
}
