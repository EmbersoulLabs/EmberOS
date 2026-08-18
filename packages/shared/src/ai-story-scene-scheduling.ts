/**
 * Sprint 3 PR 3.2 — Scene Scheduling contracts.
 *
 * Canonical scheduling language only. Converts RuntimeAuthorizedFact + Scene
 * into Provider Execution + Routing Decision + Envelope + Outbox correlation.
 * Does not invoke Adapters, Workers, Finalizer, usage/cost, or unlock Phase 1.
 *
 * Automatic cross-provider fallback remains DISABLED (PR 3.0 Outcome B).
 */
import { z } from "zod";
import { PHASE1_EXECUTION_LOCKED } from "./ai-story-phase1-execution-lock";
import {
  RUNTIME_AUTHORIZATION_CONTRACT_VERSION,
  RuntimeAuthorizedFactSchema,
  RuntimeOwnershipIdentitySchema,
} from "./ai-story-runtime-contracts";
import { SCENE_ROUTER_VERSION } from "./ai-story-worker-runtime";

export const SCENE_SCHEDULING_CONTRACT_VERSION = "1" as const;
export const SCENE_ROUTING_DECISION_CONTRACT_VERSION = "1" as const;
export { SCENE_ROUTER_VERSION };

const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = NonEmptyTextSchema;

export const SCENE_SCHEDULING_ERROR_CODES = [
  "RUNTIME_AUTHORIZATION_REQUIRED",
  "RUNTIME_AUTHORIZATION_CONFLICT",
  "COMMERCIAL_AUTHORIZATION_REQUIRED",
  "COMMERCIAL_AUTHORIZATION_DENIED",
  "SCENE_NOT_AUTHORIZED",
  "SCENE_SCHEDULING_NOT_ELIGIBLE",
  "QC_BLOCKED",
  "OWNERSHIP_INTEGRITY_VIOLATION",
  "ROUTING_DECISION_CONFLICT",
  "NO_ELIGIBLE_PROVIDER",
  "PROVIDER_BINDING_CONFLICT",
  "PROVIDER_EXECUTION_CONFLICT",
  "EXECUTION_ENVELOPE_CONFLICT",
  "OUTBOX_SCHEDULING_CONFLICT",
  "IDENTITY_CONFLICT",
  "PHASE1_EXECUTION_LOCKED",
] as const;

export const SceneSchedulingErrorCodeSchema = z.enum(SCENE_SCHEDULING_ERROR_CODES);
export type SceneSchedulingErrorCode = z.infer<typeof SceneSchedulingErrorCodeSchema>;

/**
 * Immutable persisted routing decision for one Scene schedule.
 * Provider binding is frozen after acceptance. automaticFallbackEnabled=false.
 */
export const PersistedSceneRoutingDecisionSchema = z.object({
  routingDecisionId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  sceneExecutionId: z.string().uuid(),
  runtimeAuthorizationId: z.string().uuid(),
  capabilityId: z.literal("animation-video-generation"),
  capabilityVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  selectedProviderId: NonEmptyTextSchema,
  selectedAdapterVersion: NonEmptyTextSchema,
  /** Frozen router contract version; Worker must use this, never current code inference. */
  routerVersion: z.literal(SCENE_ROUTER_VERSION),
  registrySnapshotHash: IntegrityHashSchema,
  capabilitySnapshot: z.record(z.unknown()),
  policySnapshot: z.record(z.unknown()),
  candidateSummary: z.array(
    z.object({
      providerId: NonEmptyTextSchema,
      adapterVersion: NonEmptyTextSchema,
      selected: z.boolean(),
      scoreTotal: z.number().optional(),
      exclusionCodes: z.array(NonEmptyTextSchema).default([]),
    })
  ),
  decidedAt: z.string().datetime(),
  deterministicIntegrityHash: IntegrityHashSchema,
  automaticFallbackEnabled: z.literal(false),
  contractVersion: z.literal(SCENE_ROUTING_DECISION_CONTRACT_VERSION),
  ownership: RuntimeOwnershipIdentitySchema,
});

export type PersistedSceneRoutingDecision = z.infer<
  typeof PersistedSceneRoutingDecisionSchema
>;

/**
 * Scene ↔ Provider Execution correlation.
 * References and integrity hashes only — no provider raw payloads.
 */
export const SceneProviderSchedulingCorrelationSchema = z.object({
  correlationId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  sceneExecutionId: z.string().uuid(),
  runtimeAuthorizationId: z.string().uuid(),
  routingDecisionId: z.string().uuid(),
  providerExecutionId: NonEmptyTextSchema,
  envelopeId: NonEmptyTextSchema,
  outboxJobId: NonEmptyTextSchema,
  requestHash: IntegrityHashSchema,
  envelopeHash: IntegrityHashSchema,
  routingDecisionHash: IntegrityHashSchema,
  authorizationHash: IntegrityHashSchema,
  schedulingIdentityHash: IntegrityHashSchema,
  ownership: RuntimeOwnershipIdentitySchema,
  contractVersion: z.literal(SCENE_SCHEDULING_CONTRACT_VERSION),
  scheduledAt: z.string().datetime(),
  scheduledBy: z.string().uuid(),
});

export type SceneProviderSchedulingCorrelation = z.infer<
  typeof SceneProviderSchedulingCorrelationSchema
>;

/** Complete accepted scheduling bundle for one Scene. */
export const SceneSchedulingBundleSchema = z.object({
  correlation: SceneProviderSchedulingCorrelationSchema,
  routingDecision: PersistedSceneRoutingDecisionSchema,
  runtimeAuthorization: RuntimeAuthorizedFactSchema,
  providerExecutionId: NonEmptyTextSchema,
  envelopeId: NonEmptyTextSchema,
  outboxJobId: NonEmptyTextSchema,
  payloadReference: NonEmptyTextSchema,
  requestHash: IntegrityHashSchema,
  envelopeHash: IntegrityHashSchema,
  replayed: z.boolean(),
  executionAllowed: z.literal(false),
  executionLockCode: z.literal(PHASE1_EXECUTION_LOCKED),
  automaticFallbackEnabled: z.literal(false),
  authorizationContractVersion: z.literal(RUNTIME_AUTHORIZATION_CONTRACT_VERSION),
  schedulingContractVersion: z.literal(SCENE_SCHEDULING_CONTRACT_VERSION),
});

export type SceneSchedulingBundle = z.infer<typeof SceneSchedulingBundleSchema>;

/**
 * True only when the full canonical scheduling bundle exists for a Scene.
 * Outbox alone is insufficient.
 */
export function isSceneSchedulingBundleComplete(input: {
  readonly hasRuntimeAuthorization: boolean;
  readonly hasRoutingDecision: boolean;
  readonly hasProviderExecution: boolean;
  readonly hasEnvelope: boolean;
  readonly hasOutboxJob: boolean;
  readonly hasCorrelation: boolean;
}): boolean {
  return (
    input.hasRuntimeAuthorization &&
    input.hasRoutingDecision &&
    input.hasProviderExecution &&
    input.hasEnvelope &&
    input.hasOutboxJob &&
    input.hasCorrelation
  );
}
