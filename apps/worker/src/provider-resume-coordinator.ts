import { requestHash } from "@ceo-agent/shared";
import type {
  ProviderResumeRepository,
  ProviderResumeSnapshot,
} from "@ceo-agent/db";
import type { ExecutionFinalizationOutcome } from "./provider-execution-finalizer";

const RESUME_COORDINATOR_VERSION = "1.0.0";

export type ResumeDecisionStatus =
  | "READY_TO_RESUME"
  | "DO_NOT_RESUME"
  | "WAIT_FOR_RECONCILIATION"
  | "UNKNOWN";

export interface ResumeCoordinatorInput {
  readonly finalization: ExecutionFinalizationOutcome;
  readonly policyVersion: string;
  readonly trace: Readonly<Record<string, string>>;
}

export interface ResumeMarkerReader {
  hasResumeMarker(
    executionId: string,
    finalizationIdentity: string
  ): Promise<boolean>;
}

export interface ResumeSignal {
  readonly executionId: string;
  readonly attemptId: string;
  readonly providerId?: string;
  readonly capabilityId?: string;
  readonly capabilityVersion?: string;
  readonly correlationId?: string;
  readonly decision: ResumeDecisionStatus;
  readonly decisionReason: string;
  readonly decisionTimestamp: string;
  readonly finalizationIdentity: string;
  readonly signalHash: string;
}

export interface ResumeAuditMetadata {
  readonly coordinatorVersion: string;
  readonly policyVersion: string;
  readonly evaluationDurationMs: number;
  readonly decisionHash: string;
  readonly trace: Readonly<Record<string, string>>;
}

export interface ResumeDecision {
  readonly decision: ResumeDecisionStatus;
  readonly reasons: readonly string[];
  readonly signal: ResumeSignal;
  readonly audit: ResumeAuditMetadata;
}

export interface ResumeCoordinatorLogEntry {
  readonly event:
    | "provider_resume.evaluation_started"
    | "provider_resume.eligibility_passed"
    | "provider_resume.eligibility_rejected"
    | "provider_resume.decision_produced"
    | "provider_resume.evaluation_finished";
  readonly executionId: string;
  readonly decision?: ResumeDecisionStatus;
  readonly reason?: string;
  readonly timestamp: string;
}

export interface ResumeCoordinatorLogger {
  log(entry: ResumeCoordinatorLogEntry): void;
}

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

function finalizationIdentity(finalization: ExecutionFinalizationOutcome): string {
  return [
    finalization.executionId,
    finalization.attemptId,
    finalization.jobId,
    finalization.completedAt,
    finalization.resultReference,
  ].join(":");
}

function evaluate(
  input: ResumeCoordinatorInput,
  snapshot: ProviderResumeSnapshot | null,
  alreadyResumed: boolean
): { decision: ResumeDecisionStatus; reasons: string[] } {
  if (!snapshot) {
    return { decision: "UNKNOWN", reasons: ["EXECUTION_NOT_FOUND"] };
  }
  const { execution, acceptedAttempt, acceptedResult, outboxJob } = snapshot;
  if (
    execution.identity.executionId !== input.finalization.executionId ||
    execution.acceptedAttemptId !== input.finalization.attemptId ||
    acceptedAttempt?.attemptId !== input.finalization.attemptId ||
    outboxJob?.jobId !== input.finalization.jobId ||
    execution.completedAt !== input.finalization.completedAt
  ) {
    return { decision: "UNKNOWN", reasons: ["FINALIZATION_IDENTITY_MISMATCH"] };
  }
  if (execution.status === "RECONCILING") {
    return {
      decision: "WAIT_FOR_RECONCILIATION",
      reasons: ["RECONCILIATION_PENDING"],
    };
  }
  if (execution.status === "CANCELLED") {
    return { decision: "DO_NOT_RESUME", reasons: ["EXECUTION_CANCELLED"] };
  }
  if (execution.status === "SUPERSEDED") {
    return { decision: "DO_NOT_RESUME", reasons: ["EXECUTION_SUPERSEDED"] };
  }
  if (alreadyResumed) {
    return { decision: "DO_NOT_RESUME", reasons: ["RESUME_MARKER_EXISTS"] };
  }
  if (execution.status !== "SUCCEEDED") {
    return { decision: "DO_NOT_RESUME", reasons: ["EXECUTION_NOT_FINALIZED"] };
  }
  if (!acceptedResult || !acceptedAttempt || acceptedAttempt.status !== "SUCCEEDED") {
    return { decision: "DO_NOT_RESUME", reasons: ["ACCEPTED_RESULT_MISSING"] };
  }
  if (acceptedResult.resultReference !== input.finalization.resultReference) {
    return { decision: "UNKNOWN", reasons: ["FINALIZATION_IDENTITY_MISMATCH"] };
  }
  if (
    !outboxJob ||
    outboxJob.status !== "COMPLETED" ||
    !outboxJob.completedAt ||
    !outboxJob.completionWorkerId ||
    !outboxJob.completionMetadata
  ) {
    return { decision: "DO_NOT_RESUME", reasons: ["OUTBOX_NOT_COMPLETED"] };
  }
  return { decision: "READY_TO_RESUME", reasons: ["FINALIZATION_VERIFIED"] };
}

export class ResumeCoordinator {
  private readonly logger: ResumeCoordinatorLogger;
  private readonly now: () => Date;

  constructor(
    private readonly repository: Pick<ProviderResumeRepository, "load">,
    private readonly markers: ResumeMarkerReader,
    options: {
      logger?: ResumeCoordinatorLogger;
      now?: () => Date;
    } = {}
  ) {
    this.logger = options.logger ?? { log: () => undefined };
    this.now = options.now ?? (() => new Date());
  }

  async evaluate(input: ResumeCoordinatorInput): Promise<ResumeDecision> {
    const request = freeze(structuredClone(input)) as ResumeCoordinatorInput;
    const startedAt = this.now();
    const identity = finalizationIdentity(request.finalization);
    this.logger.log({
      event: "provider_resume.evaluation_started",
      executionId: request.finalization.executionId,
      timestamp: startedAt.toISOString(),
    });

    const snapshot = await this.repository.load(
      request.finalization.executionId,
      request.finalization.jobId
    );
    const alreadyResumed = snapshot
      ? await this.markers.hasResumeMarker(
          request.finalization.executionId,
          identity
        )
      : false;
    const evaluated = evaluate(request, snapshot, alreadyResumed);
    const decisionTimestamp = this.now().toISOString();
    this.logger.log({
      event:
        evaluated.decision === "READY_TO_RESUME"
          ? "provider_resume.eligibility_passed"
          : "provider_resume.eligibility_rejected",
      executionId: request.finalization.executionId,
      decision: evaluated.decision,
      reason: evaluated.reasons.join(","),
      timestamp: decisionTimestamp,
    });

    const stableSignal = {
      executionId: request.finalization.executionId,
      attemptId: request.finalization.attemptId,
      providerId: snapshot?.acceptedResult?.providerMetadata.providerId,
      capabilityId: snapshot?.execution.identity.capabilityId,
      capabilityVersion: snapshot?.execution.identity.capabilityVersion,
      correlationId: snapshot?.execution.metadata.correlationId,
      decision: evaluated.decision,
      decisionReason: evaluated.reasons.join(","),
      finalizationIdentity: identity,
    };
    const signalHash = await requestHash(stableSignal);
    const signal = freeze({
      ...stableSignal,
      decisionTimestamp,
      signalHash,
    }) as ResumeSignal;
    const decisionHash = await requestHash({
      signal: stableSignal,
      policyVersion: request.policyVersion,
      coordinatorVersion: RESUME_COORDINATOR_VERSION,
      trace: request.trace,
    });
    const finishedAt = this.now();
    const decision = freeze({
      decision: evaluated.decision,
      reasons: evaluated.reasons,
      signal,
      audit: {
        coordinatorVersion: RESUME_COORDINATOR_VERSION,
        policyVersion: request.policyVersion,
        evaluationDurationMs: Math.max(
          0,
          finishedAt.getTime() - startedAt.getTime()
        ),
        decisionHash,
        trace: request.trace,
      },
    }) as ResumeDecision;
    this.logger.log({
      event: "provider_resume.decision_produced",
      executionId: request.finalization.executionId,
      decision: decision.decision,
      reason: decision.reasons.join(","),
      timestamp: decisionTimestamp,
    });
    this.logger.log({
      event: "provider_resume.evaluation_finished",
      executionId: request.finalization.executionId,
      decision: decision.decision,
      timestamp: finishedAt.toISOString(),
    });
    return decision;
  }
}
