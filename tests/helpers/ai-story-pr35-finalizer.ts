/**
 * Sprint 3 PR 3.5 (remediated) — fixtures for bridge + projection tests.
 */
import {
  WorkerExecutionResultSchema,
  type AcceptedProviderFinalization,
  type SceneProjectionCorrelation,
  type SceneProjectionValidatedBundle,
  type ProjectedSceneResult,
  type WorkerExecutionResult,
  SCENE_ROUTER_VERSION,
  WORKER_ATTEMPT_CONTRACT_VERSION,
  WORKER_RUNTIME_CONTRACT_VERSION,
  PHASE1_EXECUTION_LOCKED,
} from "@ceo-agent/shared";
import { computeWorkerExecutionResultHash } from "../../packages/agents/src/ai-story/scene-provider-worker-runtime";
import {
  buildPr33ValidatedBundle,
  pr33AuthorizedFact,
} from "./ai-story-pr33-worker";
import type { SceneProjectionRepository } from "../../packages/agents/src/ai-story/scene-result-projector";
import type { ProviderAttempt, ProviderUsage, ProviderCost } from "@ceo-agent/shared";
import type { BridgeFinalizerInput } from "../../packages/agents/src/ai-story/provider-worker-result-finalizer-bridge";
import type { ProviderExecutionFinalizationRecord } from "@ceo-agent/db";

const SCENE_ID = "scene-a";
const SCENE_ORDER = 0;

export async function buildPr35ProjectionBundle(
  overrides: Partial<SceneProjectionValidatedBundle> = {}
): Promise<SceneProjectionValidatedBundle> {
  const workerBundle = await buildPr33ValidatedBundle();
  return {
    dispatch: workerBundle.dispatch,
    outboxJobId: workerBundle.outboxJobId,
    providerExecutionId: workerBundle.providerExecutionId,
    envelope: workerBundle.envelope,
    correlation: workerBundle.correlation,
    routingDecision: workerBundle.routingDecision,
    runtimeAuthorization: workerBundle.runtimeAuthorization,
    registrySnapshotHash: workerBundle.registrySnapshotHash,
    sceneId: SCENE_ID,
    sceneOrder: SCENE_ORDER,
    ...overrides,
  };
}

export function buildTerminalSuccessWorkerResult(
  bundle: SceneProjectionValidatedBundle,
  overrides: Partial<WorkerExecutionResult> = {}
): WorkerExecutionResult {
  const producedAt = "2026-08-05T13:00:00.000Z";
  const { deterministicIntegrityHash: hashOverride, ...rest } = overrides;
  const withoutHash = {
    workerExecutionResultId: "10000000-0000-5000-8000-000000000801",
    providerExecutionId: bundle.providerExecutionId,
    providerAttemptId: "10000000-0000-5000-8000-000000000802",
    dispatchId: bundle.dispatch.dispatchId,
    outboxJobId: bundle.outboxJobId,
    routingDecisionId: bundle.routingDecision.routingDecisionId,
    providerId: bundle.routingDecision.selectedProviderId,
    adapterVersion: bundle.routingDecision.selectedAdapterVersion,
    routerVersion: SCENE_ROUTER_VERSION,
    providerRequestId: "cgt-pr35-terminal",
    workerState: "TERMINAL_SUCCESS" as const,
    acceptanceClassification: "ACCEPTED" as const,
    canonicalProviderState: "SUCCEEDED" as const,
    normalizedResultReference: "https://cdn.example.com/scene-a.mp4",
    terminalMedia: {
      mediaType: "video/mp4",
      uriReference: "https://cdn.example.com/scene-a.mp4",
      contentHash:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      durationMs: 4000,
    },
    normalizedUsageFacts: {
      durationMs: 4000,
      units: 4,
      unitKind: "video",
    },
    normalizedCostMetadata: {
      currency: "USD",
      amount: 0.32,
      estimated: true,
    },
    reconciliationRequired: false,
    workerContractVersion: WORKER_RUNTIME_CONTRACT_VERSION,
    attemptContractVersion: WORKER_ATTEMPT_CONTRACT_VERSION,
    producedAt,
    executionAllowed: false as const,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
    automaticFallbackEnabled: false as const,
    ...rest,
  };
  if (hashOverride) {
    return WorkerExecutionResultSchema.parse({
      ...withoutHash,
      deterministicIntegrityHash: hashOverride,
    });
  }
  return WorkerExecutionResultSchema.parse({
    ...withoutHash,
    deterministicIntegrityHash: computeWorkerExecutionResultHash(withoutHash),
  });
}

export class InMemoryBridgeLedger {
  attempts = new Map<string, ProviderAttempt>();
  failures = new Map<string, unknown>();
  usageWrites: string[] = [];
  costWrites: string[] = [];

  async appendAttempt(input: {
    attempt: ProviderAttempt;
    failure?: unknown;
    providerMetadata?: Record<string, unknown>;
  }): Promise<ProviderAttempt> {
    const existing = this.attempts.get(input.attempt.attemptId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(input.attempt)) {
        throw new Error("Attempt identity or history position conflicts");
      }
      return existing;
    }
    this.attempts.set(input.attempt.attemptId, input.attempt);
    if (input.failure) this.failures.set(input.attempt.attemptId, input.failure);
    return input.attempt;
  }

  async recordUsage(attemptId: string, _usage: ProviderUsage): Promise<ProviderUsage> {
    this.usageWrites.push(attemptId);
    return _usage;
  }

  async recordCost(attemptId: string, _cost: ProviderCost): Promise<ProviderCost> {
    this.costWrites.push(attemptId);
    return _cost;
  }
}

export class InMemoryBridgeOutbox {
  claims: string[] = [];
  completions: string[] = [];
  releases: string[] = [];
  statusByJob = new Map<string, string>();

  async findJob(jobId: string) {
    return {
      jobId,
      status: this.statusByJob.get(jobId) ?? "PENDING",
    } as never;
  }

  async claimOrRenewForFinalization(input: {
    jobId: string;
    leaseOwner: string;
    leaseDurationMs: number;
  }): Promise<void> {
    this.claims.push(input.jobId);
    this.statusByJob.set(input.jobId, "CLAIMED");
  }

  async releaseLease(input: {
    jobId: string;
    leaseOwner: string;
    nextVisibleAt: Date;
    retryDelayMs?: number;
    retryClassification?: string;
    lastErrorCategory?: string;
  }) {
    this.releases.push(input.jobId);
    this.statusByJob.set(
      input.jobId,
      input.nextVisibleAt.getTime() > Date.now() ? "RETRY_WAIT" : "PENDING"
    );
    return {
      jobId: input.jobId,
      status: this.statusByJob.get(input.jobId),
    } as never;
  }
}

export class InMemoryProductionFinalizer {
  calls: BridgeFinalizerInput[] = [];
  failureCalls: Array<{ executionId: string; failureCode: string }> = [];
  usageInserted: string[] = [];
  costInserted: string[] = [];
  executionTerminal: Array<{ executionId: string; status: string }> = [];
  outboxTerminal: Array<{ jobId: string; status: string }> = [];
  failNext = false;
  accepted = new Map<string, AcceptedProviderFinalization>();

  async finalize(
    input: BridgeFinalizerInput
  ): Promise<ProviderExecutionFinalizationRecord> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Simulated Production Finalizer failure");
    }
    this.calls.push(input);
    this.usageInserted.push(input.attemptId);
    this.costInserted.push(input.attemptId);
    this.executionTerminal.push({
      executionId: input.executionId,
      status: "SUCCEEDED",
    });
    this.outboxTerminal.push({ jobId: input.jobId, status: "COMPLETED" });
    const completedAt = "2026-08-05T13:00:01.000Z";
    const record: ProviderExecutionFinalizationRecord = {
      executionId: input.executionId,
      attemptId: input.attemptId,
      jobId: input.jobId,
      workerId: input.workerId,
      result: input.result,
      completedAt,
      completionMetadata: input.completionMetadata,
      terminalKind: "SUCCEEDED",
    };
    this.accepted.set(input.executionId, {
      executionId: input.executionId,
      attemptId: input.attemptId,
      jobId: input.jobId,
      workerId: input.workerId,
      completedAt,
      resultReference: input.result.resultReference,
      responseHash: input.result.responseHash,
      providerId: input.providerId,
      adapterVersion: input.adapterVersion,
      completionMetadata: input.completionMetadata,
      terminalKind: "SUCCEEDED",
    });
    return record;
  }

  async finalizeTerminalFailure(input: {
    readonly jobId: string;
    readonly executionId: string;
    readonly attemptId: string;
    readonly workerId: string;
    readonly providerId: string;
    readonly adapterVersion: string;
    readonly failureCode: string;
    readonly failureReason: string;
    readonly resultReference: string;
    readonly requestHash: string;
    readonly responseHash: string;
    readonly dispatchTimestamp: string;
    readonly executionDurationMs: number;
    readonly completionMetadata?: Readonly<Record<string, unknown>>;
  }) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Simulated Production Finalizer failure");
    }
    this.failureCalls.push({
      executionId: input.executionId,
      failureCode: input.failureCode,
    });
    this.executionTerminal.push({
      executionId: input.executionId,
      status: "TERMINAL_FAILURE",
    });
    this.outboxTerminal.push({ jobId: input.jobId, status: "DEAD_LETTER" });
    const completedAt = "2026-08-05T13:00:01.000Z";
    const completionMetadata = {
      terminalKind: "TERMINAL_FAILURE",
      failureCode: input.failureCode,
      resultReference: input.resultReference,
      ...(input.completionMetadata ?? {}),
    };
    const record = {
      executionId: input.executionId,
      attemptId: input.attemptId,
      jobId: input.jobId,
      workerId: input.workerId,
      terminalKind: "TERMINAL_FAILURE" as const,
      failureCode: input.failureCode,
      resultReference: input.resultReference,
      responseHash: input.responseHash,
      completedAt,
      completionMetadata,
    };
    this.accepted.set(input.executionId, {
      executionId: input.executionId,
      attemptId: input.attemptId,
      jobId: input.jobId,
      workerId: input.workerId,
      completedAt,
      resultReference: input.resultReference,
      responseHash: input.responseHash,
      providerId: input.providerId,
      adapterVersion: input.adapterVersion,
      completionMetadata,
      terminalKind: "TERMINAL_FAILURE",
      failureCode: input.failureCode,
    });
    return record;
  }
}

export class InMemoryProjectionRepository implements SceneProjectionRepository {
  projections = new Map<
    string,
    {
      correlation: SceneProjectionCorrelation;
      sceneResult: ProjectedSceneResult;
    }
  >();
  failNext = false;
  writeCount = 0;

  async acceptOrConvergeProjection(input: {
    readonly correlation: SceneProjectionCorrelation;
    readonly sceneResult: ProjectedSceneResult;
  }) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Simulated projection rollback");
    }
    const existing = this.projections.get(input.correlation.sceneExecutionId);
    if (existing) {
      if (
        existing.correlation.integrityHash !== input.correlation.integrityHash
      ) {
        throw Object.assign(new Error("Conflicting Scene projection"), {
          code: "SCENE_PROJECTION_CONFLICT",
        });
      }
      return { ...existing, converged: true };
    }
    this.writeCount += 1;
    this.projections.set(input.correlation.sceneExecutionId, {
      correlation: input.correlation,
      sceneResult: input.sceneResult,
    });
    return {
      correlation: input.correlation,
      sceneResult: input.sceneResult,
      converged: false,
    };
  }
}

export function pr35Ownership() {
  return pr33AuthorizedFact().ownership;
}

export function buildTerminalFailureWorkerResult(
  bundle: SceneProjectionValidatedBundle,
  overrides: Partial<WorkerExecutionResult> & {
    readonly failureCode?:
      | "PROVIDER_FAILED"
      | "PROVIDER_REJECTED"
      | "PROVIDER_MODERATION_REJECTED"
      | "PROVIDER_TIMEOUT";
  } = {}
): WorkerExecutionResult {
  const failureCode = overrides.failureCode ?? "PROVIDER_FAILED";
  const stateByCode = {
    PROVIDER_FAILED: "FAILED",
    PROVIDER_REJECTED: "REJECTED",
    PROVIDER_MODERATION_REJECTED: "REJECTED",
    PROVIDER_TIMEOUT: "TIMED_OUT",
  } as const;
  const producedAt = "2026-08-05T13:00:00.000Z";
  const { deterministicIntegrityHash: hashOverride, failureCode: _fc, ...rest } =
    overrides;
  const withoutHash = {
    workerExecutionResultId: "10000000-0000-5000-8000-000000000811",
    providerExecutionId: bundle.providerExecutionId,
    providerAttemptId: "10000000-0000-5000-8000-000000000812",
    dispatchId: bundle.dispatch.dispatchId,
    outboxJobId: bundle.outboxJobId,
    routingDecisionId: bundle.routingDecision.routingDecisionId,
    providerId: bundle.routingDecision.selectedProviderId,
    adapterVersion: bundle.routingDecision.selectedAdapterVersion,
    routerVersion: SCENE_ROUTER_VERSION,
    providerRequestId: "cgt-pr35-terminal-failure",
    workerState: "TERMINAL_FAILURE" as const,
    acceptanceClassification: "ACCEPTED" as const,
    canonicalProviderState: stateByCode[failureCode],
    normalizedResultReference: undefined,
    terminalMedia: undefined,
    failureClassification: {
      code: failureCode,
      retryable: false,
      terminal: true,
      reconciliationRequired: false,
      sanitizedMessage: `Terminal ${failureCode}`,
    },
    reconciliationRequired: false,
    workerContractVersion: WORKER_RUNTIME_CONTRACT_VERSION,
    attemptContractVersion: WORKER_ATTEMPT_CONTRACT_VERSION,
    producedAt,
    executionAllowed: false as const,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
    automaticFallbackEnabled: false as const,
    ...rest,
  };
  if (hashOverride) {
    return WorkerExecutionResultSchema.parse({
      ...withoutHash,
      deterministicIntegrityHash: hashOverride,
    });
  }
  return WorkerExecutionResultSchema.parse({
    ...withoutHash,
    deterministicIntegrityHash: computeWorkerExecutionResultHash(withoutHash),
  });
}

export function buildTransientInfraWorkerResult(
  bundle: SceneProjectionValidatedBundle
): WorkerExecutionResult {
  const producedAt = "2026-08-05T13:00:00.000Z";
  const withoutHash = {
    workerExecutionResultId: "10000000-0000-5000-8000-000000000821",
    providerExecutionId: bundle.providerExecutionId,
    providerAttemptId: "10000000-0000-5000-8000-000000000822",
    dispatchId: bundle.dispatch.dispatchId,
    outboxJobId: bundle.outboxJobId,
    routingDecisionId: bundle.routingDecision.routingDecisionId,
    providerId: bundle.routingDecision.selectedProviderId,
    adapterVersion: bundle.routingDecision.selectedAdapterVersion,
    routerVersion: SCENE_ROUTER_VERSION,
    workerState: "PROCESSING" as const,
    acceptanceClassification: "ACCEPTED" as const,
    canonicalProviderState: "PROCESSING" as const,
    failureClassification: {
      code: "PROVIDER_FAILED" as const,
      retryable: true,
      terminal: false,
      reconciliationRequired: false,
      sanitizedMessage: "Transient provider infrastructure failure",
    },
    reconciliationRequired: false,
    workerContractVersion: WORKER_RUNTIME_CONTRACT_VERSION,
    attemptContractVersion: WORKER_ATTEMPT_CONTRACT_VERSION,
    producedAt,
    executionAllowed: false as const,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
    automaticFallbackEnabled: false as const,
  };
  return WorkerExecutionResultSchema.parse({
    ...withoutHash,
    deterministicIntegrityHash: computeWorkerExecutionResultHash(withoutHash),
  });
}

export function buildAcceptanceUnknownWorkerResult(
  bundle: SceneProjectionValidatedBundle
): WorkerExecutionResult {
  const producedAt = "2026-08-05T13:00:00.000Z";
  const withoutHash = {
    workerExecutionResultId: "10000000-0000-5000-8000-000000000831",
    providerExecutionId: bundle.providerExecutionId,
    providerAttemptId: "10000000-0000-5000-8000-000000000832",
    dispatchId: bundle.dispatch.dispatchId,
    outboxJobId: bundle.outboxJobId,
    routingDecisionId: bundle.routingDecision.routingDecisionId,
    providerId: bundle.routingDecision.selectedProviderId,
    adapterVersion: bundle.routingDecision.selectedAdapterVersion,
    routerVersion: SCENE_ROUTER_VERSION,
    workerState: "ACCEPTANCE_UNKNOWN" as const,
    acceptanceClassification: "ACCEPTANCE_UNKNOWN" as const,
    canonicalProviderState: "ACCEPTANCE_UNKNOWN" as const,
    failureClassification: {
      code: "PROVIDER_ACCEPTANCE_UNKNOWN" as const,
      retryable: false,
      terminal: false,
      reconciliationRequired: true,
      sanitizedMessage: "Provider acceptance unknown",
    },
    reconciliationRequired: true,
    workerContractVersion: WORKER_RUNTIME_CONTRACT_VERSION,
    attemptContractVersion: WORKER_ATTEMPT_CONTRACT_VERSION,
    producedAt,
    executionAllowed: false as const,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
    automaticFallbackEnabled: false as const,
  };
  return WorkerExecutionResultSchema.parse({
    ...withoutHash,
    deterministicIntegrityHash: computeWorkerExecutionResultHash(withoutHash),
  });
}
