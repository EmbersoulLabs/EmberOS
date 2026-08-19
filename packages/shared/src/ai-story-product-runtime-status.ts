/**
 * Sprint 3 PR 3.7 Phase E — product-safe runtime status projection.
 *
 * Derived read-model only. Owns no lifecycle authority.
 * Never exposes Provider/Outbox/Worker/credentials fields.
 */
import { z } from "zod";
import { RUNTIME_PROJECTION_VERSION } from "./ai-story-runtime-contracts";
import { AiStoryProviderSpendProjectionSchema } from "./ai-story-provider-attempt-cost";
import { GeneratedSceneReviewReadModelSchema } from "./ai-story-generated-scene-review";

export const PRODUCT_RUNTIME_STATUS_CONTRACT_VERSION = "1" as const;

/**
 * Canonical browser-facing runtime states.
 * NOT_READY covers pre-Execute plans that fail readiness derivation.
 */
export const PRODUCT_RUNTIME_STATUSES = [
  "NOT_READY",
  "READY_FOR_EXECUTION",
  "AUTHORIZED",
  "SCENES_RUNNING",
  "RECONCILIATION_REQUIRED",
  "SCENES_FAILED",
  "SCENES_COMPLETE",
  "WAITING_FOR_ASSEMBLY",
  "ASSEMBLING",
  "ASSEMBLY_FAILED",
  "SUCCEEDED",
] as const;

export const ProductRuntimeStatusSchema = z.enum(PRODUCT_RUNTIME_STATUSES);
export type ProductRuntimeStatus = z.infer<typeof ProductRuntimeStatusSchema>;

export const PRODUCT_RUNTIME_TERMINAL_STATUSES = [
  "NOT_READY",
  "READY_FOR_EXECUTION",
  "SCENES_FAILED",
  "ASSEMBLY_FAILED",
  "SUCCEEDED",
] as const;

export const ProductRuntimeTerminalStatusSchema = z.enum(
  PRODUCT_RUNTIME_TERMINAL_STATUSES
);
export type ProductRuntimeTerminalStatus = z.infer<
  typeof ProductRuntimeTerminalStatusSchema
>;

export const PRODUCT_RUNTIME_POLLING_STATUSES = [
  "AUTHORIZED",
  "SCENES_RUNNING",
  "RECONCILIATION_REQUIRED",
  "SCENES_COMPLETE",
  "WAITING_FOR_ASSEMBLY",
  "ASSEMBLING",
] as const;

export const ProductRuntimePollingStatusSchema = z.enum(
  PRODUCT_RUNTIME_POLLING_STATUSES
);
export type ProductRuntimePollingStatus = z.infer<
  typeof ProductRuntimePollingStatusSchema
>;

export const ProductRuntimeAssemblyStateSchema = z.enum([
  "NONE",
  "ACCEPTED",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
]);
export type ProductRuntimeAssemblyState = z.infer<
  typeof ProductRuntimeAssemblyStateSchema
>;

/**
 * Safe aggregate projection for Browser / GET runtime.
 * canExecute is UI convenience only — Phase D API remains the authority gate.
 */
export const ProductRuntimeProjectionSchema = z.object({
  contractVersion: z.literal(PRODUCT_RUNTIME_STATUS_CONTRACT_VERSION),
  executionPlanId: z.string().uuid(),
  runtimeAuthorizationId: z.string().uuid().nullable(),
  status: ProductRuntimeStatusSchema,
  runtimeProjectionVersion: z.literal(RUNTIME_PROJECTION_VERSION),
  requiredSceneCount: z.number().int().nonnegative(),
  succeededSceneCount: z.number().int().nonnegative(),
  failedSceneCount: z.number().int().nonnegative(),
  reconciliationCount: z.number().int().nonnegative(),
  assemblyState: ProductRuntimeAssemblyStateSchema,
  hasFinalStoryResult: z.boolean(),
  /** UI convenience only. Not authority. */
  canExecute: z.boolean(),
  safeFailureSummary: z.string().nullable(),
  /** EXEC-05 provider spend reconstruction. Optional for legacy projection clients. */
  providerSpend: AiStoryProviderSpendProjectionSchema.optional(),
  /** EXEC-04 generated-media review. Optional for legacy projection clients. */
  generatedSceneReviews: z.array(GeneratedSceneReviewReadModelSchema).optional(),
  pendingReviewSceneCount: z.number().int().nonnegative().optional(),
  approvedSceneCount: z.number().int().nonnegative().optional(),
  derivedAt: z.string().datetime(),
});

export type ProductRuntimeProjection = z.infer<
  typeof ProductRuntimeProjectionSchema
>;

/** Fields forbidden from product runtime / FSR read responses. */
export const PRODUCT_RUNTIME_FORBIDDEN_RESPONSE_KEYS = [
  "providerId",
  "adapterVersion",
  "providerRequestId",
  "providerExecutionId",
  "routingDecisionId",
  "outboxJobId",
  "dispatchId",
  "workerAttemptId",
  "apiKey",
  "credentials",
  "rawProviderPayload",
  "providerPayload",
  "ffmpegArgs",
  "localFilesystemPath",
  "tempPath",
] as const;

export function isProductRuntimePollingStatus(
  status: ProductRuntimeStatus
): boolean {
  return (PRODUCT_RUNTIME_POLLING_STATUSES as readonly string[]).includes(status);
}

/**
 * Pure status derivation from persisted authorities.
 * Precedence matches Phase E freeze specification.
 */
export function deriveProductRuntimeStatus(input: {
  readonly hasFinalStoryResult: boolean;
  readonly assemblyState: ProductRuntimeAssemblyState;
  readonly requiredSceneCount: number;
  readonly succeededSceneCount: number;
  readonly failedSceneCount: number;
  readonly reconciliationCount: number;
  readonly hasActiveSceneRuntime: boolean;
  readonly hasRuntimeAuthorizedFact: boolean;
  readonly canonicalReadinessSatisfied: boolean;
}): ProductRuntimeStatus {
  if (input.hasFinalStoryResult) return "SUCCEEDED";
  if (input.assemblyState === "FAILED") return "ASSEMBLY_FAILED";
  if (input.assemblyState === "PROCESSING") return "ASSEMBLING";
  if (input.assemblyState === "ACCEPTED") return "WAITING_FOR_ASSEMBLY";
  if (
    input.requiredSceneCount > 0 &&
    input.succeededSceneCount >= input.requiredSceneCount &&
    input.failedSceneCount === 0 &&
    input.reconciliationCount === 0
  ) {
    return "SCENES_COMPLETE";
  }
  if (input.reconciliationCount > 0) return "RECONCILIATION_REQUIRED";
  if (input.failedSceneCount > 0) return "SCENES_FAILED";
  if (input.hasActiveSceneRuntime) return "SCENES_RUNNING";
  if (input.hasRuntimeAuthorizedFact) return "AUTHORIZED";
  if (input.canonicalReadinessSatisfied) return "READY_FOR_EXECUTION";
  return "NOT_READY";
}

export function deriveProductCanExecute(input: {
  readonly status: ProductRuntimeStatus;
  readonly hasRuntimeAuthorizedFact: boolean;
  readonly callerMayExecute: boolean;
}): boolean {
  return (
    input.callerMayExecute &&
    input.status === "READY_FOR_EXECUTION" &&
    !input.hasRuntimeAuthorizedFact
  );
}
