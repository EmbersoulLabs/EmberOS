/**
 * Sprint 3 PR 3.7 Phase D — Canonical Execute API contracts.
 *
 * Product-safe request/response only. Never accepts Provider/Worker/routing
 * authority fields. Never unlocks PHASE1_EXECUTION_LOCKED globally.
 */
import { z } from "zod";
import { PHASE1_EXECUTION_LOCKED } from "./ai-story-phase1-execution-lock";
import { RUNTIME_PROJECTION_VERSION } from "./ai-story-runtime-contracts";

export const CANONICAL_EXECUTE_CONTRACT_VERSION = "1" as const;

/**
 * Strict empty/object request. Forbidden authority fields are rejected (not ignored).
 */
export const CanonicalExecuteRequestSchema = z
  .object({})
  .strict()
  .describe("Canonical Execute accepts no client authority fields");

export type CanonicalExecuteRequest = z.infer<typeof CanonicalExecuteRequestSchema>;

export const CanonicalExecuteRuntimeStatusSchema = z.enum([
  "AUTHORIZED_AND_SCHEDULED",
  "ALREADY_AUTHORIZED_AND_SCHEDULED",
]);

export type CanonicalExecuteRuntimeStatus = z.infer<
  typeof CanonicalExecuteRuntimeStatusSchema
>;

/**
 * Product-safe Execute response. Omits Provider/Outbox/Dispatch/Worker ids.
 */
export const CanonicalExecuteResponseSchema = z.object({
  contractVersion: z.literal(CANONICAL_EXECUTE_CONTRACT_VERSION),
  executionPlanId: z.string().min(1),
  runtimeAuthorizationId: z.string().min(1),
  runtimeStatus: CanonicalExecuteRuntimeStatusSchema,
  runtimeProjectionVersion: z.literal(RUNTIME_PROJECTION_VERSION),
  scheduledSceneCount: z.number().int().nonnegative(),
  converged: z.boolean(),
  /** Phase 1 lock remains in force for legacy paths; selective Execute is the sole unlock. */
  executionLockCode: z.literal(PHASE1_EXECUTION_LOCKED),
  automaticFallbackEnabled: z.literal(false),
});

export type CanonicalExecuteResponse = z.infer<typeof CanonicalExecuteResponseSchema>;

/** Forbidden mass-assignment / injection keys for Execute request bodies. */
export const CANONICAL_EXECUTE_FORBIDDEN_BODY_KEYS = [
  "providerId",
  "adapterVersion",
  "sceneIds",
  "sceneExecutionIds",
  "routingDecisionId",
  "providerExecutionId",
  "runtimeAuthorizationId",
  "workspaceId",
  "orgId",
  "artifactId",
  "ready",
  "executionAllowed",
] as const;
