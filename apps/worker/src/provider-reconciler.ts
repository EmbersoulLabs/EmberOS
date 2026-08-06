import { requestHash } from "@ceo-agent/shared";
import type {
  ProviderExecutionContext,
  ProviderLookupResult,
} from "@ceo-agent/agents/provider-adapters";
import type { ProviderAdapterRegistry } from "@ceo-agent/agents/provider-router";
import type {
  ProviderReconciliationRepository,
  ProviderReconciliationSnapshot,
} from "@ceo-agent/db";

const RECONCILER_VERSION = "1.0.0";

export type ReconciliationTrigger =
  | "TIMEOUT_UNKNOWN"
  | "UNKNOWN_PROVIDER_COMPLETION"
  | "MISSING_FINALIZATION"
  | "LOOKUP_AMBIGUITY"
  | "WORKER_CRASH"
  | "STATE_DISAGREEMENT"
  | "INCOMPLETE_PROVIDER_METADATA";

export type ReconciliationState =
  | "CONSISTENT"
  | "RECOVERABLE"
  | "INCONSISTENT"
  | "UNKNOWN";

export type ReconciliationDecisionStatus =
  | "CONSISTENT"
  | "FINALIZE_REQUIRED"
  | "RESUME_ALLOWED"
  | "WAIT"
  | "UNSUPPORTED"
  | "MANUAL_INTERVENTION_REQUIRED"
  | "UNKNOWN";

export interface ProviderReconciliationRequest {
  readonly reconciliationRequestId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly jobId: string;
  readonly providerId: string;
  readonly adapterVersion: string;
  readonly providerRequestId?: string;
  readonly requestSchemaVersion: string;
  readonly resultSchemaVersion: string;
  readonly trigger: ReconciliationTrigger;
  readonly policyVersion: string;
  readonly dataHandling: ProviderExecutionContext["dataHandling"];
  readonly trace: Readonly<Record<string, string>>;
}

export interface ProviderReconciliationAudit {
  readonly reconcilerVersion: string;
  readonly policyVersion: string;
  readonly lookupPerformed: boolean;
  readonly lookupLatencyMs: number;
  readonly decisionHash: string;
  readonly decisionTimestamp: string;
  readonly trace: Readonly<Record<string, string>>;
}

export interface ProviderReconciliationDecision {
  readonly reconciliationRequestId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly state: ReconciliationState;
  readonly decision: ReconciliationDecisionStatus;
  readonly reasons: readonly string[];
  readonly providerState?: ProviderLookupResult["status"];
  readonly audit: ProviderReconciliationAudit;
}

export interface ProviderReconciliationLogEntry {
  readonly event:
    | "provider_reconciliation.started"
    | "provider_reconciliation.lookup_started"
    | "provider_reconciliation.lookup_completed"
    | "provider_reconciliation.decision_produced"
    | "provider_reconciliation.completed";
  readonly executionId: string;
  readonly attemptId: string;
  readonly providerId: string;
  readonly decision?: ReconciliationDecisionStatus;
  readonly providerState?: ProviderLookupResult["status"];
  readonly reason?: string;
  readonly timestamp: string;
}

export interface ProviderReconciliationLogger {
  log(entry: ProviderReconciliationLogEntry): void;
}

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

function finalizedAndConsistent(snapshot: ProviderReconciliationSnapshot): boolean {
  const { ledger, outboxJob } = snapshot;
  return (
    ledger.execution.status === "SUCCEEDED" &&
    Boolean(ledger.acceptedResult) &&
    ledger.execution.acceptedAttemptId === ledger.acceptedResult?.providerAttemptId &&
    outboxJob?.status === "COMPLETED" &&
    outboxJob.executionId === ledger.execution.identity.executionId
  );
}

function classifyLookup(
  request: ProviderReconciliationRequest,
  snapshot: ProviderReconciliationSnapshot,
  lookup: ProviderLookupResult
): {
  state: ReconciliationState;
  decision: ReconciliationDecisionStatus;
  reasons: string[];
} {
  const attempt = snapshot.ledger.attempts.find(
    (entry) => entry.attempt.attemptId === request.attemptId
  )?.attempt;
  if (lookup.status === "RUNNING") {
    return { state: "RECOVERABLE", decision: "WAIT", reasons: ["PROVIDER_RUNNING"] };
  }
  if (lookup.status === "NOT_FOUND") {
    return {
      state: "RECOVERABLE",
      decision: "RESUME_ALLOWED",
      reasons: ["PROVIDER_REQUEST_NOT_FOUND"],
    };
  }
  if (lookup.status === "UNKNOWN") {
    return { state: "UNKNOWN", decision: "UNKNOWN", reasons: ["PROVIDER_STATE_UNKNOWN"] };
  }
  if (lookup.status === "UNSUPPORTED") {
    return {
      state: "UNKNOWN",
      decision: "UNSUPPORTED",
      reasons: ["RECONCILIATION_UNSUPPORTED"],
    };
  }
  if (lookup.status === "FAILED") {
    return lookup.error.retryable
      ? {
          state: "RECOVERABLE",
          decision: "RESUME_ALLOWED",
          reasons: ["PROVIDER_RETRYABLE_FAILURE"],
        }
      : {
          state: "INCONSISTENT",
          decision: "MANUAL_INTERVENTION_REQUIRED",
          reasons: ["PROVIDER_TERMINAL_FAILURE"],
        };
  }

  if (lookup.status !== "SUCCEEDED") {
    return {
      state: "UNKNOWN",
      decision: "UNKNOWN",
      reasons: ["PROVIDER_STATE_UNKNOWN"],
    };
  }
  if (!lookup.result) {
    return {
      state: "UNKNOWN",
      decision: "MANUAL_INTERVENTION_REQUIRED",
      reasons: ["PROVIDER_RESULT_UNAVAILABLE"],
    };
  }
  if (
    snapshot.ledger.acceptedResult &&
    snapshot.outboxJob?.status !== "COMPLETED"
  ) {
    return {
      state: "INCONSISTENT",
      decision: "MANUAL_INTERVENTION_REQUIRED",
      reasons: ["PARTIAL_FINALIZATION_STATE"],
    };
  }
  if (
    !attempt ||
    lookup.result.executionId !== request.executionId ||
    lookup.result.providerAttemptId !== request.attemptId ||
    lookup.result.providerMetadata.providerId !== request.providerId ||
    lookup.result.requestHash !== snapshot.ledger.requestHash ||
    attempt.requestHash !== lookup.result.requestHash ||
    (attempt.responseHash !== undefined &&
      attempt.responseHash !== lookup.result.responseHash)
  ) {
    return {
      state: "INCONSISTENT",
      decision: "MANUAL_INTERVENTION_REQUIRED",
      reasons: ["LEDGER_PROVIDER_STATE_MISMATCH"],
    };
  }
  return {
    state: "RECOVERABLE",
    decision: "FINALIZE_REQUIRED",
    reasons: ["PROVIDER_RESULT_VERIFIED"],
  };
}

export class ProviderReconciler {
  private readonly logger: ProviderReconciliationLogger;
  private readonly now: () => Date;

  constructor(
    private readonly repository: Pick<ProviderReconciliationRepository, "load">,
    private readonly adapters: ProviderAdapterRegistry,
    options: {
      logger?: ProviderReconciliationLogger;
      now?: () => Date;
    } = {}
  ) {
    this.logger = options.logger ?? { log: () => undefined };
    this.now = options.now ?? (() => new Date());
  }

  async reconcile(
    input: ProviderReconciliationRequest
  ): Promise<ProviderReconciliationDecision> {
    const request = freeze(
      structuredClone(input)
    ) as ProviderReconciliationRequest;
    const startedAt = this.now();
    const logBase = {
      executionId: request.executionId,
      attemptId: request.attemptId,
      providerId: request.providerId,
    };
    this.logger.log({
      event: "provider_reconciliation.started",
      ...logBase,
      timestamp: startedAt.toISOString(),
    });

    const snapshot = await this.repository.load(request.executionId, request.jobId);
    let lookup: ProviderLookupResult | undefined;
    let lookupPerformed = false;
    let lookupLatencyMs = 0;
    let evaluated: {
      state: ReconciliationState;
      decision: ReconciliationDecisionStatus;
      reasons: string[];
    };

    if (!snapshot) {
      evaluated = {
        state: "UNKNOWN",
        decision: "UNKNOWN",
        reasons: ["EXECUTION_NOT_FOUND"],
      };
    } else if (finalizedAndConsistent(snapshot)) {
      evaluated = {
        state: "CONSISTENT",
        decision: "CONSISTENT",
        reasons: ["FINALIZED_STATE_CONSISTENT"],
      };
    } else {
      const attempt = snapshot.ledger.attempts.find(
        (entry) => entry.attempt.attemptId === request.attemptId
      )?.attempt;
      if (!attempt) {
        evaluated = {
          state: "UNKNOWN",
          decision: "UNKNOWN",
          reasons: ["ATTEMPT_NOT_FOUND"],
        };
      } else if (
        attempt.providerId !== request.providerId ||
        attempt.providerRequestId !== request.providerRequestId
      ) {
        evaluated = {
          state: "INCONSISTENT",
          decision: "MANUAL_INTERVENTION_REQUIRED",
          reasons: ["PROVIDER_IDENTITY_MISMATCH"],
        };
      } else if (!request.providerRequestId) {
        evaluated = {
          state: "UNKNOWN",
          decision: "MANUAL_INTERVENTION_REQUIRED",
          reasons: ["PROVIDER_REQUEST_ID_MISSING"],
        };
      } else {
        const declarations = this.adapters.get(
          request.providerId,
          request.adapterVersion
        );
        const adapter = this.adapters.resolve(
          request.providerId,
          request.adapterVersion
        );
        if (
          !adapter ||
          !adapter.lookup ||
          !declarations.some(
            (declaration) =>
              declaration.capabilityId ===
                snapshot.ledger.execution.identity.capabilityId &&
              declaration.lookup
          )
        ) {
          evaluated = {
            state: "UNKNOWN",
            decision: "UNSUPPORTED",
            reasons: ["RECONCILIATION_UNSUPPORTED"],
          };
        } else {
          const lookupStartedAt = this.now();
          this.logger.log({
            event: "provider_reconciliation.lookup_started",
            ...logBase,
            timestamp: lookupStartedAt.toISOString(),
          });
          lookupPerformed = true;
          try {
            lookup = await adapter.lookup(request.providerRequestId, {
              executionId: request.executionId,
              providerAttemptId: request.attemptId,
              correlationId: snapshot.ledger.execution.metadata.correlationId,
              tenantId: snapshot.ledger.execution.identity.tenantId,
              workspaceId: snapshot.ledger.execution.identity.workspaceId,
              timeoutDeadline: new Date(
                lookupStartedAt.getTime() + 30_000
              ).toISOString(),
              idempotencyKey: snapshot.ledger.execution.identity.idempotencyKey,
              capability: {
                capabilityId: snapshot.ledger.execution.identity.capabilityId,
                capabilityVersion:
                  snapshot.ledger.execution.identity.capabilityVersion,
                requestSchemaVersion: request.requestSchemaVersion,
                resultSchemaVersion: request.resultSchemaVersion,
              },
              dataHandling: request.dataHandling,
              trace: request.trace,
            });
          } catch {
            lookup = { status: "UNKNOWN" };
          }
          const lookupFinishedAt = this.now();
          lookupLatencyMs = Math.max(
            0,
            lookupFinishedAt.getTime() - lookupStartedAt.getTime()
          );
          this.logger.log({
            event: "provider_reconciliation.lookup_completed",
            ...logBase,
            providerState: lookup.status,
            timestamp: lookupFinishedAt.toISOString(),
          });
          evaluated = classifyLookup(request, snapshot, lookup);
        }
      }
    }

    const decisionTimestamp = this.now().toISOString();
    const stableDecision = {
      reconciliationRequestId: request.reconciliationRequestId,
      executionId: request.executionId,
      attemptId: request.attemptId,
      state: evaluated.state,
      decision: evaluated.decision,
      reasons: evaluated.reasons,
      providerState: lookup?.status,
      lookupPerformed,
      policyVersion: request.policyVersion,
      reconcilerVersion: RECONCILER_VERSION,
      trace: request.trace,
    };
    const decision = freeze({
      reconciliationRequestId: request.reconciliationRequestId,
      executionId: request.executionId,
      attemptId: request.attemptId,
      state: evaluated.state,
      decision: evaluated.decision,
      reasons: evaluated.reasons,
      providerState: lookup?.status,
      audit: {
        reconcilerVersion: RECONCILER_VERSION,
        policyVersion: request.policyVersion,
        lookupPerformed,
        lookupLatencyMs,
        decisionHash: await requestHash(stableDecision),
        decisionTimestamp,
        trace: request.trace,
      },
    }) as ProviderReconciliationDecision;
    this.logger.log({
      event: "provider_reconciliation.decision_produced",
      ...logBase,
      decision: decision.decision,
      providerState: decision.providerState,
      reason: decision.reasons.join(","),
      timestamp: decisionTimestamp,
    });
    this.logger.log({
      event: "provider_reconciliation.completed",
      ...logBase,
      decision: decision.decision,
      timestamp: this.now().toISOString(),
    });
    return decision;
  }
}
