/**
 * Sprint 3 PR 3.5 (remediated) — AI Story Scene Projection contracts.
 *
 * Projection-only. Provider usage/cost/terminal/outbox remain owned by the
 * Production Provider Finalizer. Scene stores references, never duplicate ledgers.
 */
import { z } from "zod";
import { PHASE1_EXECUTION_LOCKED } from "./ai-story-phase1-execution-lock";
import {
  CanonicalSceneResultSchema,
  RuntimeFailureClassificationSchema,
  type CanonicalSceneResult,
  type RuntimeAuthorizedFact,
  type RuntimeOwnershipIdentity,
} from "./ai-story-runtime-contracts";
import type { ExecutionDispatch } from "./provider-execution-dispatch";
import type { ExecutionEnvelope } from "./provider-execution-envelope";
import type {
  PersistedSceneRoutingDecision,
  SceneProviderSchedulingCorrelation,
} from "./ai-story-scene-scheduling";
import type { WorkerExecutionResult } from "./ai-story-worker-runtime";

export const SCENE_PROJECTION_CONTRACT_VERSION = "1" as const;
export const SCENE_PROJECTION_VERSION = 1 as const;

export const SCENE_PROJECTION_ERROR_CODES = [
  "SCENE_PROJECTION_CHAIN_INVALID",
  "SCENE_PROJECTION_OWNERSHIP_VIOLATION",
  "SCENE_PROJECTION_HASH_MISMATCH",
  "SCENE_PROJECTION_CONFLICT",
  "SCENE_PROJECTION_FINALIZATION_REQUIRED",
  "SCENE_PROJECTION_NON_TERMINAL",
  "SCENE_PROJECTION_TRANSACTION_FAILED",
  "BRIDGE_BINDING_INVALID",
  "PHASE1_EXECUTION_LOCKED",
] as const;

export const SceneProjectionErrorCodeSchema = z.enum(SCENE_PROJECTION_ERROR_CODES);
export type SceneProjectionErrorCode = z.infer<typeof SceneProjectionErrorCodeSchema>;

/**
 * Canonical Scene Result extended with Provider artifact references only.
 * No raw provider payload, credentials, or duplicated usage/cost amounts.
 */
export const ProjectedSceneResultSchema = CanonicalSceneResultSchema.extend({
  providerExecutionId: z.string().min(1),
  providerAttemptId: z.string().min(1),
  providerFinalizationReference: z.string().min(1),
  providerUsageReference: z.string().min(1),
  providerCostReference: z.string().min(1),
  projectedAt: z.string().datetime(),
  projectionVersion: z.literal(SCENE_PROJECTION_VERSION),
});

export type ProjectedSceneResult = z.infer<typeof ProjectedSceneResultSchema>;

export const SceneProjectionCorrelationSchema = z.object({
  projectionCorrelationId: z.string().uuid(),
  sceneExecutionId: z.string().uuid(),
  workerExecutionResultId: z.string().uuid(),
  providerExecutionId: z.string().min(1),
  providerAttemptId: z.string().min(1),
  outboxJobId: z.string().min(1),
  dispatchId: z.string().min(1),
  providerFinalizationReference: z.string().min(1),
  sceneResultId: z.string().uuid(),
  ownershipOrgId: z.string().uuid(),
  ownershipWorkspaceId: z.string().uuid(),
  projectedAt: z.string().datetime(),
  integrityHash: z.string().min(1),
  contractVersion: z.literal(SCENE_PROJECTION_CONTRACT_VERSION),
  executionAllowed: z.literal(false),
  executionLockCode: z.literal(PHASE1_EXECUTION_LOCKED),
  automaticFallbackEnabled: z.literal(false),
});

export type SceneProjectionCorrelation = z.infer<
  typeof SceneProjectionCorrelationSchema
>;

export const SceneProjectionOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("PROJECTED"),
    correlation: SceneProjectionCorrelationSchema,
    sceneResult: ProjectedSceneResultSchema,
    providerFinalizationReference: z.string().min(1),
    replayed: z.boolean(),
    finalizerInvoked: z.boolean(),
    executionAllowed: z.literal(false),
    automaticFallbackEnabled: z.literal(false),
  }),
  z.object({
    outcome: z.literal("RECONCILIATION_REQUIRED"),
    dispatchId: z.string().min(1),
    providerExecutionId: z.string().min(1),
    outboxJobId: z.string().min(1),
    reason: z.string().min(1),
    finalizerInvoked: z.literal(false),
    executionAllowed: z.literal(false),
    automaticFallbackEnabled: z.literal(false),
  }),
  z.object({
    outcome: z.literal("RETRY_SCHEDULED"),
    dispatchId: z.string().min(1),
    providerExecutionId: z.string().min(1),
    outboxJobId: z.string().min(1),
    nextVisibleAt: z.string().datetime(),
    retryClassification: z.string().min(1),
    finalizerInvoked: z.literal(false),
    executionAllowed: z.literal(false),
    automaticFallbackEnabled: z.literal(false),
  }),
]);

export type SceneProjectionOutcome = z.infer<typeof SceneProjectionOutcomeSchema>;

export type SceneProjectionValidatedBundle = {
  readonly dispatch: ExecutionDispatch;
  readonly outboxJobId: string;
  readonly providerExecutionId: string;
  readonly envelope: ExecutionEnvelope;
  readonly correlation: SceneProviderSchedulingCorrelation;
  readonly routingDecision: PersistedSceneRoutingDecision;
  readonly runtimeAuthorization: RuntimeAuthorizedFact;
  readonly registrySnapshotHash: string;
  readonly sceneId: string;
  readonly sceneOrder: number;
};

export type AcceptedProviderFinalization = {
  readonly executionId: string;
  readonly attemptId: string;
  readonly jobId: string;
  readonly workerId: string;
  readonly completedAt: string;
  readonly resultReference: string;
  readonly responseHash: string;
  readonly providerId: string;
  readonly adapterVersion: string;
  readonly completionMetadata: Readonly<Record<string, unknown>>;
  /** Production Finalizer terminal class for this acceptance. */
  readonly terminalKind?: "SUCCEEDED" | "TERMINAL_FAILURE";
  readonly failureCode?: string;
};

export type SceneProjectionPersistInput = {
  readonly correlation: SceneProjectionCorrelation;
  readonly sceneResult: ProjectedSceneResult;
};

export type SceneProjectionPersistResult = {
  readonly correlation: SceneProjectionCorrelation;
  readonly sceneResult: ProjectedSceneResult;
  readonly converged: boolean;
};

export function buildProviderUsageReference(attemptId: string): string {
  return `provider-attempt-usage://${attemptId}`;
}

export function buildProviderCostReference(attemptId: string): string {
  return `provider-attempt-cost://${attemptId}`;
}

export function buildProviderFinalizationReference(input: {
  readonly executionId: string;
  readonly attemptId: string;
  readonly jobId: string;
  readonly completedAt: string;
  readonly resultReference: string;
}): string {
  return [
    input.executionId,
    input.attemptId,
    input.jobId,
    input.completedAt,
    input.resultReference,
  ].join(":");
}

export function mapWorkerFailureToProjectionFailure(
  code: string | undefined
): z.infer<typeof RuntimeFailureClassificationSchema> | null {
  switch (code) {
    case "PROVIDER_MODERATION_REJECTED":
      return "PROVIDER_MODERATION_REJECTED";
    case "PROVIDER_REJECTED":
      return "PROVIDER_REJECTED";
    case "PROVIDER_TIMEOUT":
      return "PROVIDER_TIMEOUT";
    case "PROVIDER_FAILED":
    case "PROVIDER_NOT_ACCEPTED":
      return "PROVIDER_FAILED";
    default:
      return code ? "FINALIZATION_FAILED" : null;
  }
}

/**
 * Maps Worker canonical provider state + failure code to Scene Result status.
 * Projection-only; does not own Provider terminal writes.
 */
export function mapWorkerResultToSceneStatus(input: {
  readonly canonicalProviderState: WorkerExecutionResult["canonicalProviderState"];
  readonly failureCode?: string;
}): "SUCCEEDED" | "FAILED" | "REJECTED" | "TIMEOUT" {
  if (input.canonicalProviderState === "SUCCEEDED") return "SUCCEEDED";
  if (input.canonicalProviderState === "TIMED_OUT") return "TIMEOUT";
  if (input.canonicalProviderState === "REJECTED") return "REJECTED";
  if (
    input.failureCode === "PROVIDER_TIMEOUT" ||
    input.failureCode === "PROVIDER_MODERATION_REJECTED" ||
    input.failureCode === "PROVIDER_REJECTED"
  ) {
    if (input.failureCode === "PROVIDER_TIMEOUT") return "TIMEOUT";
    return "REJECTED";
  }
  return "FAILED";
}

/** Terminal Worker outcomes that Production Finalizer may terminalize as failure. */
export const FINALIZER_TERMINAL_FAILURE_STATES = [
  "FAILED",
  "REJECTED",
  "TIMED_OUT",
] as const;

export type FinalizerTerminalFailureState =
  (typeof FINALIZER_TERMINAL_FAILURE_STATES)[number];

export function isFinalizerTerminalFailureState(
  state: WorkerExecutionResult["canonicalProviderState"]
): state is FinalizerTerminalFailureState {
  return (FINALIZER_TERMINAL_FAILURE_STATES as readonly string[]).includes(state);
}

export type {
  CanonicalSceneResult,
  RuntimeOwnershipIdentity,
  WorkerExecutionResult,
};
