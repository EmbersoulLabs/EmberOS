/**
 * Sprint 3 PR 3.3 — in-memory Worker fixtures for unit tests.
 */
import {
  createExecutionDispatch,
  createExecutionEnvelope,
  PHASE1_EXECUTION_LOCKED,
  PersistedSceneRoutingDecisionSchema,
  RuntimeAuthorizedFactSchema,
  SCENE_ROUTER_VERSION,
  SceneProviderSchedulingCorrelationSchema,
  WorkerExecutionResultSchema,
  type ExecutionDispatch,
  type ExecutionEnvelope,
  type PersistedSceneRoutingDecision,
  type RuntimeAuthorizedFact,
  type SceneProviderSchedulingCorrelation,
  type WorkerExecutionResult,
} from "@ceo-agent/shared";
import type {
  WorkerRuntimeRepository,
  WorkerValidatedBundle,
} from "../../packages/agents/src/ai-story/scene-provider-worker-runtime.ts";
import { WorkerRuntimeError } from "../../packages/agents/src/ai-story/scene-provider-worker-runtime.ts";

const OWNERSHIP = {
  orgId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000002",
  campaignId: "10000000-0000-4000-8000-000000000003",
  storyId: "10000000-0000-4000-8000-000000000004",
  storyVersionId: "10000000-0000-4000-8000-000000000005",
  animationPackageId: "10000000-0000-4000-8000-000000000006",
  executionPlanId: "10000000-0000-4000-8000-000000000101",
} as const;

const HASH =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SCENE_A = "10000000-0000-4000-8000-000000000201";

export function pr33AuthorizedFact(): RuntimeAuthorizedFact {
  return RuntimeAuthorizedFactSchema.parse({
    runtimeAuthorizationId: "10000000-0000-5000-8000-000000000401",
    executionPlanId: OWNERSHIP.executionPlanId,
    runtimeAuthorizationVersion: 1,
    reviewDecisionId: "10000000-0000-4000-8000-000000000301",
    reviewHash: HASH,
    assemblyDefinitionId: "10000000-0000-4000-8000-000000000302",
    assemblyHash: HASH,
    orderedSceneExecutionIds: [SCENE_A],
    qcResultIds: ["10000000-0000-4000-8000-000000000311"],
    ownership: OWNERSHIP,
    authorizationContractVersion: "1",
    authorizedBy: "10000000-0000-4000-8000-000000000501",
    authorizedAt: "2026-08-04T12:00:00.000Z",
    deterministicIntegrityHash: HASH,
  });
}

export function pr33RoutingDecision(
  overrides: Partial<PersistedSceneRoutingDecision> = {}
): PersistedSceneRoutingDecision {
  return PersistedSceneRoutingDecisionSchema.parse({
    routingDecisionId: "10000000-0000-5000-8000-000000000501",
    executionPlanId: OWNERSHIP.executionPlanId,
    sceneExecutionId: SCENE_A,
    runtimeAuthorizationId: pr33AuthorizedFact().runtimeAuthorizationId,
    capabilityId: "animation-video-generation",
    capabilityVersion: "1.0.0",
    selectedProviderId: "seedance",
    selectedAdapterVersion: "1.0.0",
    routerVersion: SCENE_ROUTER_VERSION,
    registrySnapshotHash: HASH,
    capabilitySnapshot: { capabilityId: "animation-video-generation" },
    policySnapshot: { automaticFallbackEnabled: false },
    candidateSummary: [
      {
        providerId: "seedance",
        adapterVersion: "1.0.0",
        selected: true,
        scoreTotal: 1,
        exclusionCodes: [],
      },
    ],
    decidedAt: "2026-08-04T12:05:00.000Z",
    deterministicIntegrityHash: HASH,
    automaticFallbackEnabled: false,
    contractVersion: "1",
    ownership: OWNERSHIP,
    ...overrides,
  });
}

export async function pr33Envelope(): Promise<ExecutionEnvelope> {
  const fact = pr33AuthorizedFact();
  return createExecutionEnvelope({
    version: "1",
    envelopeId: "envelope-pr33-scene-a",
    payloadReference: "memory://ai-story/scene-provider-request/pr33/test",
    tenantId: fact.ownership.orgId,
    workspaceId: fact.ownership.workspaceId,
    executionContext: {
      executionId: "execution-pr33-scene-a",
      correlationId: "10000000-0000-5000-8000-000000000601",
      pipelineRunId: fact.executionPlanId,
      idempotencyKey: "ai-story-scene:pr33-idempotency",
      timeoutDeadline: "2026-08-04T12:15:00.000Z",
      dataHandling: {
        sensitiveData: false,
        externalProcessingAllowed: true,
        providerTrainingAllowed: false,
      },
      trace: {
        executionPlanId: fact.executionPlanId,
        sceneExecutionId: SCENE_A,
        runtimeAuthorizationId: fact.runtimeAuthorizationId,
      },
    },
    capabilityId: "animation-video-generation",
    capabilityVersion: "1.0.0",
    providerPolicySnapshot: {
      policyVersion: "1.0.0",
      routingDecisionId: pr33RoutingDecision().routingDecisionId,
      routingDecisionHash: HASH,
      automaticFallbackEnabled: false,
    },
    canonicalRequest: {
      contractVersion: "1",
      executionIdentity: {
        executionId: "execution-pr33-scene-a",
        tenantId: fact.ownership.orgId,
        workspaceId: fact.ownership.workspaceId,
        campaignId: fact.ownership.campaignId,
        pipelineRunId: fact.executionPlanId,
        capabilityId: "animation-video-generation",
        capabilityVersion: "1.0.0",
        idempotencyKey: "ai-story-scene:pr33-idempotency",
        deterministicFingerprint: HASH,
      },
      requestSchemaVersion: "1.0.0",
      resultSchemaVersion: "1.0.0",
      normalizedPayloadReference: {
        uri: "memory://ai-story/scene-provider-request/pr33/test",
        contentHash: HASH,
        mediaType: "application/json",
      },
      outputSchema: {
        schemaId: "AnimationVideoResult",
        schemaVersion: "1.0.0",
      },
      contextVersions: {
        "ai-story-scene-instructions": "1.0.0",
        "ai-story-runtime-authorization": "1.0.0",
        "ai-story-scene-routing": "1.0.0",
      },
      correlation: {
        correlationId: "10000000-0000-5000-8000-000000000601",
        pipelineRunId: fact.executionPlanId,
      },
      timeoutPolicy: { timeoutMs: 600_000, reconciliationDelayMs: 5_000 },
      retryPolicy: {
        maxAttempts: 3,
        initialDelayMs: 500,
        maximumDelayMs: 8_000,
        backoffMultiplier: 2,
      },
      providerConstraints: { executionLookupRequired: true },
    },
    createdAt: "2026-08-04T12:05:00.000Z",
  });
}

export async function pr33Dispatch(
  envelope: ExecutionEnvelope
): Promise<ExecutionDispatch> {
  return createExecutionDispatch({
    version: "1",
    dispatchId: "dispatch-pr33-scene-a",
    jobId: "outbox-pr33-scene-a",
    executionId: envelope.executionContext.executionId,
    envelopeId: envelope.envelopeId,
    payloadReference: envelope.payloadReference,
    correlationId: envelope.executionContext.correlationId,
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    capabilityId: envelope.capabilityId,
    capabilityVersion: envelope.capabilityVersion,
    requestHash: envelope.requestHash,
    envelopeHash: envelope.envelopeHash,
    workerHandoff: {
      envelopeId: envelope.envelopeId,
      payloadReference: envelope.payloadReference,
      dispatchContractVersion: "1",
    },
    status: "DISPATCHED",
    createdAt: "2026-08-04T12:06:00.000Z",
  });
}

export function pr33Correlation(
  envelope: ExecutionEnvelope
): SceneProviderSchedulingCorrelation {
  const fact = pr33AuthorizedFact();
  const routing = pr33RoutingDecision();
  return SceneProviderSchedulingCorrelationSchema.parse({
    correlationId: "10000000-0000-5000-8000-000000000701",
    executionPlanId: fact.executionPlanId,
    sceneExecutionId: SCENE_A,
    runtimeAuthorizationId: fact.runtimeAuthorizationId,
    routingDecisionId: routing.routingDecisionId,
    providerExecutionId: envelope.executionContext.executionId,
    envelopeId: envelope.envelopeId,
    outboxJobId: "outbox-pr33-scene-a",
    requestHash: envelope.requestHash,
    envelopeHash: envelope.envelopeHash,
    routingDecisionHash: routing.deterministicIntegrityHash,
    authorizationHash: fact.deterministicIntegrityHash,
    schedulingIdentityHash: HASH,
    ownership: OWNERSHIP,
    contractVersion: "1",
    scheduledAt: "2026-08-04T12:05:00.000Z",
    scheduledBy: fact.authorizedBy,
  });
}

export async function buildPr33ValidatedBundle(
  overrides?: Partial<WorkerValidatedBundle>
): Promise<WorkerValidatedBundle> {
  const envelope = await pr33Envelope();
  const dispatch = await pr33Dispatch(envelope);
  const correlation = pr33Correlation(envelope);
  const routingDecision = pr33RoutingDecision();
  const runtimeAuthorization = pr33AuthorizedFact();
  return {
    dispatch,
    outboxJobId: dispatch.jobId,
    providerExecutionId: dispatch.executionId,
    envelope,
    correlation,
    routingDecision,
    runtimeAuthorization,
    registrySnapshotHash: routingDecision.registrySnapshotHash,
    ...overrides,
  };
}

export class InMemoryWorkerRuntimeRepository implements WorkerRuntimeRepository {
  readonly results = new Map<string, WorkerExecutionResult>();
  readonly observations = new Map<string, WorkerExecutionResult[]>();
  loadCalls = 0;
  bundle: WorkerValidatedBundle | null = null;
  loadError: WorkerRuntimeError | null = null;

  constructor(bundle: WorkerValidatedBundle | null = null) {
    this.bundle = bundle;
  }

  async loadValidatedBundleByDispatchId(
    dispatchId: string
  ): Promise<WorkerValidatedBundle | null> {
    this.loadCalls += 1;
    if (this.loadError) throw this.loadError;
    if (!this.bundle) return null;
    if (this.bundle.dispatch.dispatchId !== dispatchId) return null;
    return this.bundle;
  }

  async getWorkerExecutionResultByDispatchId(
    dispatchId: string
  ): Promise<WorkerExecutionResult | null> {
    return this.results.get(dispatchId) ?? null;
  }

  async getLatestWorkerAttemptObservationByDispatchId(
    dispatchId: string
  ): Promise<WorkerExecutionResult | null> {
    const list = this.observations.get(dispatchId) ?? [];
    return list.length > 0 ? list[list.length - 1]! : null;
  }

  async appendWorkerAttemptObservation(
    result: WorkerExecutionResult
  ): Promise<{ result: WorkerExecutionResult; converged: boolean }> {
    const parsed = WorkerExecutionResultSchema.parse(result);
    if (
      parsed.workerState === "TERMINAL_SUCCESS" ||
      parsed.workerState === "TERMINAL_FAILURE" ||
      parsed.workerState === "NOT_ACCEPTED" ||
      parsed.canonicalProviderState === "SUCCEEDED" ||
      parsed.canonicalProviderState === "FAILED" ||
      parsed.canonicalProviderState === "REJECTED" ||
      parsed.canonicalProviderState === "TIMED_OUT" ||
      parsed.acceptanceClassification === "NOT_ACCEPTED"
    ) {
      throw new WorkerRuntimeError(
        "WORKER_ATTEMPT_CONFLICT",
        "Terminal Worker evidence must use acceptOrReturnWorkerExecutionResult"
      );
    }
    const list = this.observations.get(parsed.dispatchId) ?? [];
    const existing = list.find(
      (row) => row.deterministicIntegrityHash === parsed.deterministicIntegrityHash
    );
    if (existing) return { result: existing, converged: true };
    list.push(parsed);
    this.observations.set(parsed.dispatchId, list);
    return { result: parsed, converged: false };
  }

  async acceptOrReturnWorkerExecutionResult(
    result: WorkerExecutionResult
  ): Promise<{ result: WorkerExecutionResult; converged: boolean }> {
    const parsed = WorkerExecutionResultSchema.parse(result);
    if (
      !(
        parsed.workerState === "TERMINAL_SUCCESS" ||
        parsed.workerState === "TERMINAL_FAILURE" ||
        parsed.workerState === "NOT_ACCEPTED" ||
        parsed.canonicalProviderState === "SUCCEEDED" ||
        parsed.canonicalProviderState === "FAILED" ||
        parsed.canonicalProviderState === "REJECTED" ||
        parsed.canonicalProviderState === "TIMED_OUT" ||
        parsed.acceptanceClassification === "NOT_ACCEPTED"
      )
    ) {
      throw new WorkerRuntimeError(
        "WORKER_ATTEMPT_CONFLICT",
        "Non-terminal Worker outcomes are observations, not immutable WorkerExecutionResult"
      );
    }
    const existing = this.results.get(parsed.dispatchId);
    if (existing) {
      if (existing.deterministicIntegrityHash !== parsed.deterministicIntegrityHash) {
        throw new WorkerRuntimeError(
          "WORKER_ATTEMPT_CONFLICT",
          "Conflicting Worker Execution Result for the same Dispatch"
        );
      }
      return { result: existing, converged: true };
    }
    this.results.set(parsed.dispatchId, parsed);
    return { result: parsed, converged: false };
  }
}

export const PR33_LOCK = PHASE1_EXECUTION_LOCKED;
