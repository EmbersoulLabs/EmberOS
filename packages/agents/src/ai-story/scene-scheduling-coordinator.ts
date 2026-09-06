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
  type PostTerminalProviderRetryAuthorizationFact,
} from "@ceo-agent/shared";
import {
  AiStorySceneExecutionPersistenceRepository,
  ExecutionPlanAssemblyRepository,
  RuntimeAuthorizationPersistenceRepository,
  SceneSchedulingError,
  SceneSchedulingRepository,
  AiStoryProviderRuntimeRepository,
  CommercialAuthorizationRepositoryImpl,
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
  type CommercialAuthorizationRepository,
  type ProductionVerificationAuthority,
  type SceneSchedulingPersistenceBoundary,
  type SceneSchedulingStepTiming,
} from "@ceo-agent/db";
import { commercialExecutionIdentityForPlan } from "@ceo-agent/shared/server";
import {
  NoEligibleProviderError,
  type ProviderRouter,
  type ProviderRoutingDecision,
  type ProviderRoutingPolicy,
  type ProviderRoutingRequest,
} from "../provider-router";
import { applyRetryInputRevision } from "./differentiated-retry-service";
import {
  SCENE_PROVIDER_CAPABILITY_ID,
  SCENE_PROVIDER_CAPABILITY_VERSION,
  SCENE_PROVIDER_REQUEST_SCHEMA_VERSION,
  SCENE_PROVIDER_RESULT_SCHEMA_VERSION,
  buildCanonicalSceneProviderRequest,
} from "./canonical-scene-provider-request";
import { compileImmutableSceneProviderRequest } from "./scene-compiled-provider-request";
import type {
  PreparedSceneFrameAuthority,
  SceneInputPreparationAuthority,
} from "./scene-input-preparation";

export { SceneSchedulingError };

export type SceneSchedulingIntegrityInput = {
  readonly ownership: RuntimeAuthorizedFact["ownership"];
  readonly sceneExecutionId: string;
  readonly runtimeAuthorizationId: string;
  readonly commercialAuthorizationId?: string;
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
    commercialAuthorizationId: input.commercialAuthorizationId,
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
  readonly retryInputRevision?: import("@ceo-agent/shared").SceneAttemptInputRevisionFact;
  /** Exact rationale from the rejected generated result; server authority only. */
  readonly retryHumanReviewCorrection?: string | null;
  readonly postTerminalRetryAuthorization?: PostTerminalProviderRetryAuthorizationFact;
  /** Server-only PROD-VERIFY-01 authority; never populated from client input. */
  readonly productionVerification?: ProductionVerificationAuthority;
  /** Safe server-side performance observer; never used as authorization. */
  readonly observeTiming?: (observation: SceneSchedulingStepTiming) => void;
  readonly observePersistenceBoundary?: (
    boundary: SceneSchedulingPersistenceBoundary
  ) => void;
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
  > & Partial<Pick<SceneSchedulingRepository, "getProductionVerification">>;
  readonly persistenceRepo?: Pick<
    AiStorySceneExecutionPersistenceRepository,
    "getByExecutionPlanId"
  >;
  readonly assemblyRepo?: Pick<ExecutionPlanAssemblyRepository, "listMemberships">;
  readonly providerRuntimeRepo?: Pick<
    AiStoryProviderRuntimeRepository,
    | "getCompilationAuthorityBySceneExecutionId"
    | "convergeCompiledRequestForAcceptedBundle"
  > & Partial<Pick<AiStoryProviderRuntimeRepository, "getReferenceAssetAuthorities">>;
  /**
   * Resolves the active Scene input preparation authority. When it returns an
   * authority, that authority is the sole first-frame authority for the
   * compiled request and raw references become lineage only.
   */
  readonly sceneInputPreparationResolver?: (input: {
    readonly sceneExecutionId: string;
    readonly sceneId: string;
    readonly orgId: string;
    readonly workspaceId: string;
  }) => Promise<SceneInputPreparationResolution | null>;
  readonly now?: () => Date;
};

export type SceneInputPreparationResolution = {
  readonly preparation: SceneInputPreparationAuthority;
  readonly preparedFrame?: PreparedSceneFrameAuthority | null;
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
  readonly retryInputFingerprint?: string;
  readonly postTerminalRetryAuthorizationHash?: string;
}) {
  return {
    sceneExecutionId: input.sceneExecutionId,
    runtimeAuthorizationId: input.runtimeAuthorizationId,
    instructionHash: input.instructionHash,
    routingDecisionHash: input.routingDecisionHash ?? null,
    ...(input.retryGeneration && input.retryGeneration > 1
      ? { retryGeneration: input.retryGeneration }
      : {}),
    ...(input.retryInputFingerprint ? { retryInputFingerprint: input.retryInputFingerprint } : {}),
    ...(input.postTerminalRetryAuthorizationHash
      ? {
          postTerminalRetryAuthorizationHash:
            input.postTerminalRetryAuthorizationHash,
        }
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
  readonly retryGeneration: number;
  readonly commercialAuthorizationId?: string;
  readonly retryInputRevision?: import("@ceo-agent/shared").SceneAttemptInputRevisionFact;
  readonly postTerminalRetryAuthorization?: PostTerminalProviderRetryAuthorizationFact;
}): SceneProviderSchedulingCorrelation {
  const schedulingIdentityHash = computeSceneSchedulingIdentityHash({
    ownership: input.fact.ownership,
    sceneExecutionId: input.routingDecision.sceneExecutionId,
    runtimeAuthorizationId: input.fact.runtimeAuthorizationId,
    commercialAuthorizationId: input.commercialAuthorizationId,
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
    commercialAuthorizationId: input.commercialAuthorizationId ?? null,
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
    ...(input.retryGeneration > 1
      ? { retryGeneration: input.retryGeneration }
      : {}),
    ...(input.retryInputRevision ? {
      retryInputRevisionId: input.retryInputRevision.retryInputRevisionId,
      retryInputFingerprint: input.retryInputRevision.canonicalFingerprint,
    } : {}),
    ...(input.postTerminalRetryAuthorization
      ? {
          postTerminalRetryAuthorizationId:
            input.postTerminalRetryAuthorization.authorizationId,
          sourceProviderAttemptId:
            input.postTerminalRetryAuthorization.priorProviderAttemptId,
        }
      : {}),
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
  > & Partial<Pick<SceneSchedulingRepository, "getProductionVerification">>;
  private readonly persistenceRepo: Pick<
    AiStorySceneExecutionPersistenceRepository,
    "getByExecutionPlanId"
  >;
  private readonly assemblyRepo: Pick<ExecutionPlanAssemblyRepository, "listMemberships">;
  private readonly providerRuntimeRepo: Pick<
    AiStoryProviderRuntimeRepository,
    | "getCompilationAuthorityBySceneExecutionId"
    | "getReferenceAssetAuthorities"
    | "convergeCompiledRequestForAcceptedBundle"
  >;
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
    this.providerRuntimeRepo = {
      getCompilationAuthorityBySceneExecutionId: dependencies.providerRuntimeRepo?.getCompilationAuthorityBySceneExecutionId.bind(dependencies.providerRuntimeRepo) ?? ((input) => new AiStoryProviderRuntimeRepository().getCompilationAuthorityBySceneExecutionId(input)),
      getReferenceAssetAuthorities: dependencies.providerRuntimeRepo?.getReferenceAssetAuthorities?.bind(dependencies.providerRuntimeRepo) ?? ((input) => new AiStoryProviderRuntimeRepository().getReferenceAssetAuthorities(input)),
      convergeCompiledRequestForAcceptedBundle: dependencies.providerRuntimeRepo?.convergeCompiledRequestForAcceptedBundle.bind(dependencies.providerRuntimeRepo) ?? ((input) => new AiStoryProviderRuntimeRepository().convergeCompiledRequestForAcceptedBundle(input)),
    };
    this.now = dependencies.now ?? (() => new Date());
  }

  async scheduleAuthorizedScene(
    input: ScheduleAuthorizedSceneInput
  ): Promise<SceneSchedulingBundle> {
    const timings: SceneSchedulingStepTiming[] = [];
    let persistenceBoundary: SceneSchedulingPersistenceBoundary | null = null;
    const observeTiming = (observation: SceneSchedulingStepTiming) => {
      timings.push(observation);
      input.observeTiming?.(observation);
    };
    const measurePreTransaction = async <T>(
      step: SceneSchedulingStepTiming["step"],
      operation: () => Promise<T> | T,
      outcome: (value: T) => SceneSchedulingStepTiming["outcome"] = () => "PASS"
    ): Promise<T> => {
      const startedAt = performance.now();
      try {
        const value = await operation();
        observeTiming({
          step,
          durationMs: performance.now() - startedAt,
          transactionAuthority: "none",
          connectionAuthority: "pre_transaction",
          outcome: outcome(value),
        });
        return value;
      } catch (error) {
        observeTiming({
          step,
          durationMs: performance.now() - startedAt,
          transactionAuthority: "none",
          connectionAuthority: "pre_transaction",
          outcome: "FAIL",
        });
        throw error;
      }
    };
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
      const retryAuthorityCount =
        Number(Boolean(input.retryInputRevision)) +
        Number(Boolean(input.postTerminalRetryAuthorization));
      if (
        (retryGeneration <= 1 && retryAuthorityCount !== 0) ||
        (retryGeneration > 1 &&
        (retryAuthorityCount !== 1 ||
          (input.retryInputRevision &&
            (input.retryInputRevision.revisionNumber !== retryGeneration ||
              input.retryInputRevision.sceneExecutionId !== input.sceneExecutionId ||
              input.retryInputRevision.executionPlanId !== input.executionPlanId ||
              input.retryInputRevision.workspaceId !== fact.ownership.workspaceId ||
              input.retryInputRevision.providerModeRequirement !== "FIRST_FRAME_I2V")) ||
          (input.postTerminalRetryAuthorization &&
            (input.postTerminalRetryAuthorization.retryGeneration !== retryGeneration ||
              input.postTerminalRetryAuthorization.sceneExecutionId !==
                input.sceneExecutionId ||
              input.postTerminalRetryAuthorization.executionPlanId !==
                input.executionPlanId ||
              input.postTerminalRetryAuthorization.workspaceId !==
                fact.ownership.workspaceId ||
              input.postTerminalRetryAuthorization.commercialAuthorizationId !==
                input.commercialAuthorizationId ||
              input.postTerminalRetryAuthorization.targetMode !==
                "FIRST_FRAME_IMAGE_TO_VIDEO"))))
      ) {
        throw new SceneSchedulingError(
          "SCENE_SCHEDULING_NOT_ELIGIBLE",
          "Exactly one valid human retry authority is required"
        );
      }
      const acceptedBundle =
        retryGeneration <= 1
          ? await this.schedulingRepo.getAcceptedBundleBySceneExecutionId(
              input.sceneExecutionId
            )
          : null;
      if (acceptedBundle) {
        if (input.productionVerification) {
          if (!this.schedulingRepo.getProductionVerification) {
            throw new SceneSchedulingError(
              "SCENE_SCHEDULING_NOT_ELIGIBLE",
              "Production verification persistence authority is unavailable"
            );
          }
          const verification = await this.schedulingRepo.getProductionVerification(
            input.executionPlanId
          );
          if (
            !verification ||
            verification.outboxJobId !== acceptedBundle.outboxJobId ||
            verification.runtimeAuthorizationId !== fact.runtimeAuthorizationId ||
            verification.sceneExecutionId !== input.sceneExecutionId ||
            verification.workspaceId !== fact.ownership.workspaceId ||
            verification.verificationMode !== true ||
            verification.verificationPolicyVersion !==
              input.productionVerification.verificationPolicyVersion ||
            verification.authorizedBy !== input.productionVerification.authorizedBy ||
            verification.createdBy !== input.productionVerification.createdBy
          ) {
            throw new SceneSchedulingError(
              "SCENE_SCHEDULING_NOT_ELIGIBLE",
              "Accepted schedule is not owned by this production verification authority"
            );
          }
        }
        this.assertAcceptedBundleMatchesInput(acceptedBundle, input, fact);
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

      // The canonical compilation already contains the accepted QC facts. A
      // second repository hydration here duplicated one production DB round trip.
      const validationResults = compilation.validationResults.filter(
        (result) => result.intentId === input.sceneExecutionId
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

      const baseInstructions = AiStorySceneCompiledInstructionsSchema.parse(
        compilation.instructionsBySceneExecutionId[input.sceneExecutionId]
      ) as AiStorySceneCompiledInstructions;
      const instructions = input.retryInputRevision
        ? applyRetryInputRevision(baseInstructions, input.retryInputRevision, {
            latestHumanReviewCorrection: input.retryHumanReviewCorrection,
          })
        : baseInstructions;
      const instructionHash =
        input.retryInputRevision?.canonicalFingerprint ??
        input.postTerminalRetryAuthorization?.integrityHash ??
        sceneIntent.normalizedPayloadReference.contentHash;
      const seedBeforeRouting = identitySeed({
        sceneExecutionId: input.sceneExecutionId,
        runtimeAuthorizationId: fact.runtimeAuthorizationId,
        instructionHash,
        retryGeneration,
        retryInputFingerprint: input.retryInputRevision?.canonicalFingerprint,
        postTerminalRetryAuthorizationHash:
          input.postTerminalRetryAuthorization?.integrityHash,
      });
      const correlationId = deterministicPersistenceUuid(
        "ai-story-scene-scheduling-correlation",
        seedBeforeRouting
      );
      const policy = await measurePreTransaction(
        "provider_eligibility",
        () => effectiveRoutingPolicy(input)
      );
      const preferredProviders = policy.preferredProviders;
      const existingRoutingDecision =
        await measurePreTransaction(
          "routing_decision_lookup",
          () => this.schedulingRepo.getRoutingDecisionBySceneExecutionId(
            input.sceneExecutionId
          ),
          (value) => value ? "CONVERGED" : "MISS"
        );
      if (!existingRoutingDecision && policy.allowedProviders?.length === 0) {
        throw new SceneSchedulingError(
          "NO_EXECUTABLE_PROVIDER",
          "No executable provider is available for Scene scheduling"
        );
      }
      const acceptedRoutingDecision = existingRoutingDecision
        ? existingRoutingDecision
        : await measurePreTransaction(
            "routing_request_build",
            async () => buildRoutingDecision({
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
            })
          );
      // Derive schedule clocks from the authoritative routing decision time so
      // concurrent equivalent schedules converge on identical identity payloads.
      // A post-terminal retry is a new append-only execution generation. Its
      // immutable compiled-request identity must be derived from the retry
      // authorization clock, not the original routing decision clock; reusing
      // the latter would collide with the already-executed source request.
      const scheduledAt =
        input.postTerminalRetryAuthorization?.authorizedAt ??
        input.retryInputRevision?.createdAt ??
        acceptedRoutingDecision.decidedAt;
      const timeoutDeadline = new Date(
        Date.parse(scheduledAt) + 600_000
      ).toISOString();
      const seed = identitySeed({
        sceneExecutionId: input.sceneExecutionId,
        runtimeAuthorizationId: fact.runtimeAuthorizationId,
        instructionHash,
        routingDecisionHash: acceptedRoutingDecision.deterministicIntegrityHash,
        retryGeneration,
        retryInputFingerprint: input.retryInputRevision?.canonicalFingerprint,
        postTerminalRetryAuthorizationHash:
          input.postTerminalRetryAuthorization?.integrityHash,
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
        ...(retryGeneration > 1 ? { retryAuthorityHash: instructionHash } : {}),
      });
      const persistedCompilationAuthority =
        await this.providerRuntimeRepo.getCompilationAuthorityBySceneExecutionId({
          sceneExecutionId: input.sceneExecutionId,
          orgId: fact.ownership.orgId,
          workspaceId: fact.ownership.workspaceId,
          storyId: fact.ownership.storyId,
          storyVersionId: fact.ownership.storyVersionId,
        });
      const compilationAuthority = persistedCompilationAuthority ?? {
        qcEvaluationId: deterministicPersistenceUuid(
          "ai-story-scene-intent-validation-authority",
          { sceneExecutionId: input.sceneExecutionId, validationResults }
        ),
        qcFingerprint: canonicalPersistenceHash({
          kind: "ai-story-scene-intent-validation-authority.v1",
          sceneExecutionId: input.sceneExecutionId,
          validationResults,
        }),
        qcCapabilityVersion: "ai-story-scene-intent-validation.v1",
        directorFingerprint: canonicalPersistenceHash({
          kind: "ai-story-director-instruction-snapshot.v1",
          sceneExecutionId: input.sceneExecutionId,
          shots: instructions.shots,
        }),
        motionFingerprint: canonicalPersistenceHash({
          kind: "ai-story-motion-instruction-snapshot.v1",
          sceneExecutionId: input.sceneExecutionId,
          durationMs: instructions.durationMs,
          shots: instructions.shots.map((shot) => ({
            shotId: shot.shotId,
            durationMs: shot.durationMs,
            cameraMovement: shot.cameraMovement,
          })),
        }),
      };
      const effectiveReferenceIds = (sceneIntent.generationAuthority ?? instructions.generationAuthority)?.effectiveReferenceIds ?? sceneIntent.referencedAssetIds;
      const sceneInputPreparation =
        await this.dependencies.sceneInputPreparationResolver?.({
          sceneExecutionId: input.sceneExecutionId,
          sceneId: sceneIntent.identity.sceneId,
          orgId: fact.ownership.orgId,
          workspaceId: fact.ownership.workspaceId,
        }) ?? null;
      // A prepared derivative is not a Story reference, so its MIME/storage
      // authority must be loaded alongside them to be bindable as first frame.
      const preparedFrameAssetId =
        sceneInputPreparation?.preparedFrame?.outputAssetId ?? null;
      const referenceAssets = await this.providerRuntimeRepo.getReferenceAssetAuthorities({
        orgId: fact.ownership.orgId,
        workspaceId: fact.ownership.workspaceId,
        campaignId: fact.ownership.campaignId,
        assetIds: preparedFrameAssetId && !effectiveReferenceIds.includes(preparedFrameAssetId)
          ? [...effectiveReferenceIds, preparedFrameAssetId]
          : effectiveReferenceIds,
      });
      const compiledProviderRequest = compileImmutableSceneProviderRequest({
          providerId: acceptedRoutingDecision.selectedProviderId,
          intent: sceneIntent,
          instructions,
          authority: compilationAuthority,
          adapterVersion: acceptedRoutingDecision.selectedAdapterVersion,
          compiledAt: scheduledAt,
          resolution: "480p",
          referenceAssets,
          ...(sceneInputPreparation
            ? {
                sceneInputPreparation: sceneInputPreparation.preparation,
                preparedSceneFrame: sceneInputPreparation.preparedFrame ?? null,
              }
            : {}),
        });
      if (acceptedBundle) {
        await this.providerRuntimeRepo.convergeCompiledRequestForAcceptedBundle({
          bundle: acceptedBundle,
          compiledProviderRequest,
        });
        return SceneSchedulingBundleSchema.parse({
          ...acceptedBundle,
          replayed: true,
          executionAllowed: false,
          executionLockCode: PHASE1_EXECUTION_LOCKED,
          automaticFallbackEnabled: false,
        });
      }
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
            compiledRequestId: compiledProviderRequest.compiledRequestId,
            compiledRequestFingerprint:
              compiledProviderRequest.requestFingerprint,
            ...(input.retryInputRevision
              ? { retryInputRevisionId: input.retryInputRevision.retryInputRevisionId }
              : {}),
            ...(input.postTerminalRetryAuthorization
              ? {
                  postTerminalRetryAuthorizationId:
                    input.postTerminalRetryAuthorization.authorizationId,
                  sourceProviderAttemptId:
                    input.postTerminalRetryAuthorization.priorProviderAttemptId,
                }
              : {}),
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
        retryGeneration,
        commercialAuthorizationId: input.commercialAuthorizationId,
        retryInputRevision: input.retryInputRevision,
        postTerminalRetryAuthorization:
          input.postTerminalRetryAuthorization,
      });

      const bundle = await this.schedulingRepo.scheduleAcceptedBundle({
        runtimeAuthorizedFact: fact,
        routingDecision: acceptedRoutingDecision,
        providerExecution,
        compiledProviderRequest,
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
        productionVerification: input.productionVerification,
        observeTiming,
        observeBoundary: (boundary) => {
          persistenceBoundary = boundary;
          input.observePersistenceBoundary?.(boundary);
        },
      });

      console.info(JSON.stringify({
        event: "AI_STORY_POST_RELEASE_SCHEDULING_BOUNDARY_COMPLETED",
        executionPlanId: input.executionPlanId,
        sceneExecutionId: input.sceneExecutionId,
        persistenceBoundary,
        timings,
      }));

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
