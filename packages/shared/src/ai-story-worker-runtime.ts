/**
 * Sprint 3 PR 3.3 — Provider-neutral Worker runtime contracts.
 *
 * Canonical boundary:
 * Outbox Job → Dispatch → Worker → bound Adapter → Worker Execution Result → STOP
 *
 * Does not finalize Provider executions, project Scene Results, or unlock Phase 1.
 * Automatic cross-provider fallback remains DISABLED (PR 3.0 Outcome B).
 * Persisted Routing Decision (including routerVersion) remains authoritative.
 */
import { z } from "zod";
import { PHASE1_EXECUTION_LOCKED } from "./ai-story-phase1-execution-lock";

export const WORKER_RUNTIME_CONTRACT_VERSION = "1" as const;
export const WORKER_ATTEMPT_CONTRACT_VERSION = 1 as const;
/** Frozen router contract version persisted on Routing Decision (PR 3.3). */
export const SCENE_ROUTER_VERSION = 1 as const;

const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = NonEmptyTextSchema;

export const WORKER_RUNTIME_ERROR_CODES = [
  "WORKER_DISPATCH_INVALID",
  "WORKER_ENVELOPE_INVALID",
  "WORKER_ROUTING_BINDING_INVALID",
  "WORKER_ATTEMPT_CONFLICT",
  "ADAPTER_NOT_REGISTERED",
  "PROVIDER_NOT_ACCEPTED",
  "PROVIDER_ACCEPTANCE_UNKNOWN",
  "PROVIDER_REJECTED",
  "PROVIDER_MODERATION_REJECTED",
  "PROVIDER_FAILED",
  "PROVIDER_TIMEOUT",
  "RECONCILIATION_REQUIRED",
  "OWNERSHIP_INTEGRITY_VIOLATION",
  "IDENTITY_CONFLICT",
  "PHASE1_EXECUTION_LOCKED",
] as const;

export const WorkerRuntimeErrorCodeSchema = z.enum(WORKER_RUNTIME_ERROR_CODES);
export type WorkerRuntimeErrorCode = z.infer<typeof WorkerRuntimeErrorCodeSchema>;

/**
 * Provider-neutral Worker operational states.
 * Distinct from Scene Runtime, Provider Ledger, Outbox, and Scene Result states.
 */
export const WORKER_EXECUTION_STATES = [
  "RECEIVED",
  "VALIDATED",
  "SUBMISSION_PENDING",
  "ACCEPTED",
  "NOT_ACCEPTED",
  "ACCEPTANCE_UNKNOWN",
  "PROCESSING",
  "TERMINAL_SUCCESS",
  "TERMINAL_FAILURE",
] as const;

export const WorkerExecutionStateSchema = z.enum(WORKER_EXECUTION_STATES);
export type WorkerExecutionState = z.infer<typeof WorkerExecutionStateSchema>;

/**
 * Submission/acceptance classification for V1 Worker contract.
 * No state permits switching Provider.
 */
export const PROVIDER_ACCEPTANCE_CLASSIFICATIONS = [
  "NOT_SUBMITTED",
  "NOT_ACCEPTED",
  "ACCEPTANCE_UNKNOWN",
  "ACCEPTED",
] as const;

export const ProviderAcceptanceClassificationSchema = z.enum(
  PROVIDER_ACCEPTANCE_CLASSIFICATIONS
);
export type ProviderAcceptanceClassification = z.infer<
  typeof ProviderAcceptanceClassificationSchema
>;

export const CANONICAL_PROVIDER_STATES = [
  "NOT_SUBMITTED",
  "SUBMITTED",
  "ACCEPTED",
  "NOT_ACCEPTED",
  "ACCEPTANCE_UNKNOWN",
  "PROCESSING",
  "SUCCEEDED",
  "REJECTED",
  "FAILED",
  "TIMED_OUT",
  "RECONCILING",
] as const;

export const CanonicalProviderStateSchema = z.enum(CANONICAL_PROVIDER_STATES);
export type CanonicalProviderState = z.infer<typeof CanonicalProviderStateSchema>;

export const WorkerFailureClassificationSchema = z.object({
  code: WorkerRuntimeErrorCodeSchema,
  retryable: z.boolean(),
  terminal: z.boolean(),
  reconciliationRequired: z.boolean(),
  sanitizedMessage: NonEmptyTextSchema,
});

export type WorkerFailureClassification = z.infer<
  typeof WorkerFailureClassificationSchema
>;

export const NormalizedUsageFactsSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  units: z.number().nonnegative().optional(),
  unitKind: NonEmptyTextSchema.optional(),
  requestedDurationSeconds: z.number().nonnegative().optional(),
  requestedResolution: NonEmptyTextSchema.optional(),
});

export type NormalizedUsageFacts = z.infer<typeof NormalizedUsageFactsSchema>;

export const NormalizedCostMetadataSchema = z.object({
  currency: NonEmptyTextSchema.optional(),
  amount: z.number().nonnegative().nullable().optional(),
  estimated: z.boolean().optional(),
  costSource: z
    .enum([
      "PROVIDER_REPORTED",
      "MODEL_PRICING_TABLE",
      "CONFIGURED_ESTIMATE",
      "UNKNOWN",
      "LEGACY_UNKNOWN",
    ])
    .optional(),
  modelKey: NonEmptyTextSchema.optional(),
});

export type NormalizedCostMetadata = z.infer<typeof NormalizedCostMetadataSchema>;

export const CanonicalTerminalMediaMetadataSchema = z.object({
  mediaType: NonEmptyTextSchema,
  uriReference: NonEmptyTextSchema.optional(),
  contentHash: IntegrityHashSchema.optional(),
  durationMs: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export type CanonicalTerminalMediaMetadata = z.infer<
  typeof CanonicalTerminalMediaMetadataSchema
>;

/**
 * Immutable canonical Worker Execution Result.
 * Handed to Finalizer in PR 3.5 — this PR must not invoke Finalizer.
 */
export const WorkerExecutionResultSchema = z.object({
  workerExecutionResultId: z.string().uuid(),
  providerExecutionId: NonEmptyTextSchema,
  providerAttemptId: NonEmptyTextSchema,
  dispatchId: NonEmptyTextSchema,
  outboxJobId: NonEmptyTextSchema,
  routingDecisionId: z.string().uuid(),
  providerId: NonEmptyTextSchema,
  adapterVersion: NonEmptyTextSchema,
  routerVersion: z.literal(SCENE_ROUTER_VERSION),
  providerRequestId: NonEmptyTextSchema.optional(),
  workerState: WorkerExecutionStateSchema,
  acceptanceClassification: ProviderAcceptanceClassificationSchema,
  canonicalProviderState: CanonicalProviderStateSchema,
  normalizedResultReference: NonEmptyTextSchema.optional(),
  terminalMedia: CanonicalTerminalMediaMetadataSchema.optional(),
  normalizedUsageFacts: NormalizedUsageFactsSchema.optional(),
  normalizedCostMetadata: NormalizedCostMetadataSchema.optional(),
  failureClassification: WorkerFailureClassificationSchema.optional(),
  reconciliationRequired: z.boolean(),
  workerContractVersion: z.literal(WORKER_RUNTIME_CONTRACT_VERSION),
  attemptContractVersion: z.literal(WORKER_ATTEMPT_CONTRACT_VERSION),
  producedAt: z.string().datetime(),
  deterministicIntegrityHash: IntegrityHashSchema,
  executionAllowed: z.literal(false),
  executionLockCode: z.literal(PHASE1_EXECUTION_LOCKED),
  automaticFallbackEnabled: z.literal(false),
});

export type WorkerExecutionResult = z.infer<typeof WorkerExecutionResultSchema>;

/** Provider-neutral callback receipt contract (no public endpoint in PR 3.3). */
export const ProviderCallbackReceiptSchema = z.object({
  providerId: NonEmptyTextSchema,
  callbackEventId: NonEmptyTextSchema,
  providerRequestId: NonEmptyTextSchema,
  signatureVerified: z.boolean(),
  callbackTimestamp: z.string().datetime(),
  replayWindowExpiresAt: z.string().datetime().optional(),
  receiptHash: IntegrityHashSchema,
  normalizedWorkerResultHash: IntegrityHashSchema.optional(),
  contractVersion: z.literal(WORKER_RUNTIME_CONTRACT_VERSION),
});

export type ProviderCallbackReceipt = z.infer<typeof ProviderCallbackReceiptSchema>;

export const ProviderCallbackNormalizationInputSchema = z.object({
  providerId: NonEmptyTextSchema,
  rawEventReference: NonEmptyTextSchema,
  providerRequestId: NonEmptyTextSchema.optional(),
  headers: z.record(z.string()).optional(),
  receivedAt: z.string().datetime(),
});

export type ProviderCallbackNormalizationInput = z.infer<
  typeof ProviderCallbackNormalizationInputSchema
>;

export function isTerminalWorkerState(state: WorkerExecutionState): boolean {
  return state === "TERMINAL_SUCCESS" || state === "TERMINAL_FAILURE" || state === "NOT_ACCEPTED";
}

export function workerAcceptanceAllowsProviderSwitch(
  _classification: ProviderAcceptanceClassification
): false {
  return false;
}
