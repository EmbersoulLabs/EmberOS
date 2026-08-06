/**
 * Sprint 3 PR 3.1 — Runtime Contracts & Authorization language.
 *
 * Contracts only. Does not execute runtime, schedule work, open Outbox,
 * dispatch providers, unlock PHASE1_EXECUTION_LOCKED, or enable automatic
 * cross-provider fallback (DISABLED for V1 per PR 3.0).
 *
 * Aggregate hierarchy (no new Aggregate Root):
 *   Execution Plan (sole Aggregate Root)
 *     └── RuntimeAuthorizedFact (subordinate execution authority)
 *           └── Scene Runtime (subordinate)
 *                 └── Scene Result (subordinate)
 *     └── Final Story Result (subordinate to Execution Plan)
 *
 * READY_FOR_EXECUTION remains DERIVED ONLY and is never persisted as
 * execution authority. RuntimeAuthorizedFact is the only execution authority.
 */
import { z } from "zod";
import { PHASE1_EXECUTION_LOCKED } from "./ai-story-phase1-execution-lock";

export const RUNTIME_AUTHORIZATION_CONTRACT_VERSION = "1" as const;
export const SCENE_RUNTIME_CONTRACT_VERSION = "1" as const;
export const SCENE_RESULT_CONTRACT_VERSION = "1" as const;
export const FINAL_STORY_RESULT_CONTRACT_VERSION = "1" as const;

/**
 * Explicit immutable Runtime Authorization fact version (integer).
 * Not inferred from package version. Included in RuntimeAuthorizedFact
 * deterministic integrity hash. Default / freeze value = 1.
 */
export const RUNTIME_AUTHORIZATION_VERSION = 1 as const;

/**
 * Explicit Runtime Projection read-model version (integer).
 * Lives only on projections — never on RuntimeAuthorizedFact.
 * Changing this must never invalidate RuntimeAuthorizedFact hashes.
 */
export const RUNTIME_PROJECTION_VERSION = 1 as const;

const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = NonEmptyTextSchema;

/** Immutable media reference — never embeds provider payloads or credentials. */
export const RuntimeMediaReferenceSchema = z.object({
  uri: NonEmptyTextSchema,
  contentHash: IntegrityHashSchema,
  mediaType: NonEmptyTextSchema,
});

export type RuntimeMediaReference = z.infer<typeof RuntimeMediaReferenceSchema>;

/* -------------------------------------------------------------------------- */
/* 7. Runtime Identity Contracts                                              */
/* -------------------------------------------------------------------------- */

/**
 * Canonical ownership identity chain subordinate to the Execution Plan.
 * Never creates a parallel Aggregate Root.
 */
export const RuntimeOwnershipIdentitySchema = z.object({
  orgId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  campaignId: z.string().uuid(),
  storyId: z.string().uuid(),
  storyVersionId: z.string().uuid(),
  animationPackageId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
});

export type RuntimeOwnershipIdentity = z.infer<
  typeof RuntimeOwnershipIdentitySchema
>;

/** Stable identity for one RuntimeAuthorizedFact under one Execution Plan. */
export const RuntimeAuthorizationIdentitySchema = z.object({
  runtimeAuthorizationId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  runtimeAuthorizationVersion: z
    .number()
    .int()
    .positive()
    .default(RUNTIME_AUTHORIZATION_VERSION),
  deterministicIntegrityHash: IntegrityHashSchema,
  authorizationContractVersion: z.literal(RUNTIME_AUTHORIZATION_CONTRACT_VERSION),
});

export type RuntimeAuthorizationIdentity = z.infer<
  typeof RuntimeAuthorizationIdentitySchema
>;

/** Stable identity for one Scene Runtime subordinate to Execution Plan + auth. */
export const SceneRuntimeIdentitySchema = z.object({
  sceneRuntimeId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  sceneExecutionId: z.string().uuid(),
  sceneId: NonEmptyTextSchema,
  sceneOrder: z.number().int().nonnegative(),
  runtimeAuthorizationId: z.string().uuid().nullable(),
  contractVersion: z.literal(SCENE_RUNTIME_CONTRACT_VERSION),
  deterministicFingerprint: IntegrityHashSchema,
});

export type SceneRuntimeIdentity = z.infer<typeof SceneRuntimeIdentitySchema>;

/** Stable identity for one Canonical Scene Result. */
export const CanonicalSceneResultIdentitySchema = z.object({
  sceneResultId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  sceneRuntimeId: z.string().uuid(),
  sceneExecutionId: z.string().uuid(),
  contractVersion: z.literal(SCENE_RESULT_CONTRACT_VERSION),
  integrityHash: IntegrityHashSchema,
});

export type CanonicalSceneResultIdentity = z.infer<
  typeof CanonicalSceneResultIdentitySchema
>;

/** Stable identity for one Final Story Result under the Execution Plan. */
export const FinalStoryResultIdentitySchema = z.object({
  storyResultId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  runtimeAuthorizationId: z.string().uuid(),
  contractVersion: z.literal(FINAL_STORY_RESULT_CONTRACT_VERSION),
  integrityHash: IntegrityHashSchema,
});

export type FinalStoryResultIdentity = z.infer<
  typeof FinalStoryResultIdentitySchema
>;

export const RuntimeIdentityBundleSchema = z.object({
  ownership: RuntimeOwnershipIdentitySchema,
  authorization: RuntimeAuthorizationIdentitySchema.nullable(),
  sceneRuntimes: z.array(SceneRuntimeIdentitySchema),
  sceneResults: z.array(CanonicalSceneResultIdentitySchema),
  storyResult: FinalStoryResultIdentitySchema.nullable(),
});

export type RuntimeIdentityBundle = z.infer<typeof RuntimeIdentityBundleSchema>;

/* -------------------------------------------------------------------------- */
/* 6. Runtime Failure Classification                                          */
/* -------------------------------------------------------------------------- */

/**
 * Canonical runtime failure classifications.
 * Contracts only — no retry logic and no fallback logic.
 */
export const RUNTIME_FAILURE_CLASSIFICATIONS = [
  "BUSINESS_VALIDATION_FAILED",
  "QC_BLOCKED",
  "OWNERSHIP_INVALID",
  "NO_ELIGIBLE_PROVIDER",
  "PROVIDER_NOT_ACCEPTED",
  "PROVIDER_ACCEPTANCE_UNKNOWN",
  "PROVIDER_REJECTED",
  "PROVIDER_MODERATION_REJECTED",
  "PROVIDER_FAILED",
  "PROVIDER_TIMEOUT",
  "INFRASTRUCTURE_TRANSIENT",
  "INFRASTRUCTURE_TERMINAL",
  "FINALIZATION_FAILED",
  "PROJECTION_FAILED",
  "IDENTITY_CONFLICT",
] as const;

export const RuntimeFailureClassificationSchema = z.enum(
  RUNTIME_FAILURE_CLASSIFICATIONS
);
export type RuntimeFailureClassification = z.infer<
  typeof RuntimeFailureClassificationSchema
>;

export const RuntimeFailureFactSchema = z.object({
  classification: RuntimeFailureClassificationSchema,
  message: NonEmptyTextSchema,
  executionPlanId: z.string().uuid().optional(),
  sceneRuntimeId: z.string().uuid().optional(),
  sceneExecutionId: z.string().uuid().optional(),
  occurredAt: z.string().datetime(),
  details: z.record(z.unknown()).default({}),
});

export type RuntimeFailureFact = z.infer<typeof RuntimeFailureFactSchema>;

/* -------------------------------------------------------------------------- */
/* 1. RuntimeAuthorizedFact                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Immutable execution authority subordinate to the Execution Plan.
 * Equivalent authorization must converge; conflicting authorization fails closed.
 * Issuing this fact does NOT unlock PHASE1_EXECUTION_LOCKED.
 *
 * `runtimeAuthorizationVersion` is an explicit immutable integer fact version
 * (default 1). It is part of the deterministic integrity hash and is never
 * inferred from package version.
 */
export const RuntimeAuthorizedFactSchema = z.object({
  runtimeAuthorizationId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  runtimeAuthorizationVersion: z
    .number()
    .int()
    .positive()
    .default(RUNTIME_AUTHORIZATION_VERSION),
  reviewDecisionId: z.string().uuid(),
  reviewHash: IntegrityHashSchema,
  assemblyDefinitionId: z.string().uuid(),
  assemblyHash: IntegrityHashSchema,
  orderedSceneExecutionIds: z.array(z.string().uuid()).min(1),
  qcResultIds: z.array(z.string().uuid()).min(1),
  ownership: RuntimeOwnershipIdentitySchema,
  authorizationContractVersion: z.literal(RUNTIME_AUTHORIZATION_CONTRACT_VERSION),
  authorizedBy: z.string().uuid(),
  authorizedAt: z.string().datetime(),
  deterministicIntegrityHash: IntegrityHashSchema,
});

export type RuntimeAuthorizedFact = z.infer<typeof RuntimeAuthorizedFactSchema>;

/* -------------------------------------------------------------------------- */
/* 2–3. Scene Runtime Contracts + Projection                                  */
/* -------------------------------------------------------------------------- */

/**
 * Scene Runtime states. CANCELLED is intentionally absent.
 * Provider states and projection states remain separate.
 */
export const SCENE_RUNTIME_STATES = [
  "READY",
  "AUTHORIZED",
  "ACTIVE",
  "SUCCEEDED",
  "FAILED",
] as const;

export const SceneRuntimeStateSchema = z.enum(SCENE_RUNTIME_STATES);
export type SceneRuntimeState = z.infer<typeof SceneRuntimeStateSchema>;

/**
 * Allowed Scene Runtime transitions (contracts only — no executor).
 * READY → AUTHORIZED → ACTIVE → SUCCEEDED | FAILED
 */
export const SCENE_RUNTIME_ALLOWED_TRANSITIONS: Record<
  SceneRuntimeState,
  readonly SceneRuntimeState[]
> = {
  READY: ["AUTHORIZED"],
  AUTHORIZED: ["ACTIVE"],
  ACTIVE: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
};

export function assertSceneRuntimeTransition(
  from: SceneRuntimeState,
  to: SceneRuntimeState
): void {
  if (from === to) return;
  const allowed = SCENE_RUNTIME_ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid Scene Runtime transition: ${from} → ${to}`);
  }
}

/** Immutable Scene Runtime contract (language only — not an executor). */
export const SceneRuntimeContractSchema = z.object({
  identity: SceneRuntimeIdentitySchema,
  state: SceneRuntimeStateSchema,
  ownership: RuntimeOwnershipIdentitySchema,
  failure: RuntimeFailureFactSchema.nullable().default(null),
  contractVersion: z.literal(SCENE_RUNTIME_CONTRACT_VERSION),
});

export type SceneRuntimeContract = z.infer<typeof SceneRuntimeContractSchema>;

/**
 * Derived Scene Runtime projection.
 * Derives AUTHORIZED when a RuntimeAuthorizedFact covers the scene.
 * Never authorizes execution and never unlocks the Phase 1 lock.
 */
export const SceneRuntimeProjectionSchema = z.object({
  /** Read-model only — never part of RuntimeAuthorizedFact integrity. */
  projectionVersion: z.literal(RUNTIME_PROJECTION_VERSION),
  executionPlanId: z.string().uuid(),
  sceneExecutionId: z.string().uuid(),
  sceneId: NonEmptyTextSchema,
  sceneOrder: z.number().int().nonnegative(),
  state: SceneRuntimeStateSchema,
  runtimeAuthorizationId: z.string().uuid().nullable(),
  coveredByAuthorization: z.boolean(),
  executionAllowed: z.literal(false),
  executionLockCode: z.literal(PHASE1_EXECUTION_LOCKED),
  derivedAt: z.string().datetime(),
});

export type SceneRuntimeProjection = z.infer<typeof SceneRuntimeProjectionSchema>;

/* -------------------------------------------------------------------------- */
/* 4. Canonical Scene Result Contract                                         */
/* -------------------------------------------------------------------------- */

/**
 * Canonical immutable Scene Result.
 * No provider payload, raw prompt, credentials, or provider-specific fields.
 */
export const CanonicalSceneResultSchema = z.object({
  sceneResultId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  sceneRuntimeId: z.string().uuid(),
  sceneExecutionId: z.string().uuid(),
  sceneId: NonEmptyTextSchema,
  sceneOrder: z.number().int().nonnegative(),
  ownership: RuntimeOwnershipIdentitySchema,
  status: z.enum(["SUCCEEDED", "FAILED"]),
  failureClassification: RuntimeFailureClassificationSchema.nullable().default(null),
  mediaReference: RuntimeMediaReferenceSchema.nullable().default(null),
  durationMs: z.number().int().positive().nullable().default(null),
  acceptedAt: z.string().datetime(),
  integrityHash: IntegrityHashSchema,
  contractVersion: z.literal(SCENE_RESULT_CONTRACT_VERSION),
});

export type CanonicalSceneResult = z.infer<typeof CanonicalSceneResultSchema>;

/* -------------------------------------------------------------------------- */
/* 5. Final Story Result Contract                                             */
/* -------------------------------------------------------------------------- */

/**
 * Immutable Final Story Result subordinate to the Execution Plan.
 * Contract only — does NOT implement assembly runtime.
 */
export const FinalStoryResultSchema = z.object({
  storyResultId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  runtimeAuthorizationId: z.string().uuid(),
  ownership: RuntimeOwnershipIdentitySchema,
  orderedSceneResultIds: z.array(z.string().uuid()).min(1),
  orderedSceneExecutionIds: z.array(z.string().uuid()).min(1),
  status: z.enum(["SUCCEEDED", "FAILED"]),
  failureClassification: RuntimeFailureClassificationSchema.nullable().default(null),
  mediaReference: RuntimeMediaReferenceSchema.nullable().default(null),
  completedAt: z.string().datetime(),
  integrityHash: IntegrityHashSchema,
  contractVersion: z.literal(FINAL_STORY_RESULT_CONTRACT_VERSION),
});

export type FinalStoryResult = z.infer<typeof FinalStoryResultSchema>;

/* -------------------------------------------------------------------------- */
/* 9. Authorization Projection                                                */
/* -------------------------------------------------------------------------- */

export const EXECUTION_PLAN_DERIVED_READINESS = [
  "READY_FOR_EXECUTION",
  "NOT_READY",
] as const;

export const ExecutionPlanDerivedReadinessSchema = z.enum(
  EXECUTION_PLAN_DERIVED_READINESS
);
export type ExecutionPlanDerivedReadiness = z.infer<
  typeof ExecutionPlanDerivedReadinessSchema
>;

/**
 * Derived authorization projection.
 * Never authorizes execution. Never persists READY_FOR_EXECUTION as authority.
 * RuntimeAuthorizedFact (when present) is the only execution authority token;
 * PHASE1_EXECUTION_LOCKED still keeps execution impossible.
 */
export const RuntimeAuthorizationProjectionSchema = z.object({
  /** Read-model only — never part of RuntimeAuthorizedFact integrity. */
  projectionVersion: z.literal(RUNTIME_PROJECTION_VERSION),
  executionPlanId: z.string().uuid(),
  ownership: RuntimeOwnershipIdentitySchema,
  hasAuthorizedFact: z.boolean(),
  authorizedFact: RuntimeAuthorizedFactSchema.nullable(),
  sceneProjections: z.array(SceneRuntimeProjectionSchema),
  /** Derived readiness only — never execution authority. */
  derivedReadiness: ExecutionPlanDerivedReadinessSchema,
  /** Authority pointer: NONE until a RuntimeAuthorizedFact exists. */
  executionAuthority: z.enum(["NONE", "RUNTIME_AUTHORIZED_FACT"]),
  executionAllowed: z.literal(false),
  executionLockCode: z.literal(PHASE1_EXECUTION_LOCKED),
  automaticFallbackEnabled: z.literal(false),
  derivedAt: z.string().datetime(),
});

export type RuntimeAuthorizationProjection = z.infer<
  typeof RuntimeAuthorizationProjectionSchema
>;

export type SceneRuntimeProjectionStateResult = {
  readonly state: SceneRuntimeState;
  /** Read-model only — never part of RuntimeAuthorizedFact integrity. */
  readonly projectionVersion: typeof RUNTIME_PROJECTION_VERSION;
};

/**
 * Derive Scene Runtime projection state from authorization coverage.
 * READY when unauthorized; AUTHORIZED when covered by RuntimeAuthorizedFact.
 * Does not advance to ACTIVE/SUCCEEDED/FAILED (those require a future executor).
 * Always exposes frozen projectionVersion on the read-model result.
 */
export function deriveSceneRuntimeProjectionState(input: {
  readonly coveredByAuthorization: boolean;
  /** Full scheduling bundle required before ACTIVE (PR 3.2). */
  readonly schedulingBundleComplete?: boolean;
  readonly observedState?: SceneRuntimeState;
}): SceneRuntimeProjectionStateResult {
  let state: SceneRuntimeState = "READY";
  if (input.observedState === "SUCCEEDED") state = "SUCCEEDED";
  else if (input.observedState === "FAILED") state = "FAILED";
  else if (input.schedulingBundleComplete === true) state = "ACTIVE";
  else if (input.coveredByAuthorization) state = "AUTHORIZED";
  return {
    state,
    projectionVersion: RUNTIME_PROJECTION_VERSION,
  };
}

/**
 * Build Scene Runtime projections for ordered scenes under an optional auth fact.
 * Projection never authorizes execution.
 */
export function projectSceneRuntimes(input: {
  readonly executionPlanId: string;
  readonly scenes: readonly {
    readonly sceneExecutionId: string;
    readonly sceneId: string;
    readonly sceneOrder: number;
    readonly observedState?: SceneRuntimeState;
    readonly schedulingBundleComplete?: boolean;
  }[];
  readonly authorizedFact: RuntimeAuthorizedFact | null;
  readonly derivedAt: string;
}): SceneRuntimeProjection[] {
  const covered = new Set(input.authorizedFact?.orderedSceneExecutionIds ?? []);
  const authId = input.authorizedFact?.runtimeAuthorizationId ?? null;

  return input.scenes.map((scene) => {
    const coveredByAuthorization = covered.has(scene.sceneExecutionId);
    const derived = deriveSceneRuntimeProjectionState({
      coveredByAuthorization,
      schedulingBundleComplete: scene.schedulingBundleComplete === true,
      observedState: scene.observedState,
    });
    return SceneRuntimeProjectionSchema.parse({
      projectionVersion: derived.projectionVersion,
      executionPlanId: input.executionPlanId,
      sceneExecutionId: scene.sceneExecutionId,
      sceneId: scene.sceneId,
      sceneOrder: scene.sceneOrder,
      state: derived.state,
      runtimeAuthorizationId: coveredByAuthorization ? authId : null,
      coveredByAuthorization,
      executionAllowed: false,
      executionLockCode: PHASE1_EXECUTION_LOCKED,
      derivedAt: input.derivedAt,
    });
  });
}

/**
 * Build the Authorization Projection.
 * Never treats derived readiness as execution authority.
 */
export function projectRuntimeAuthorization(input: {
  readonly ownership: RuntimeOwnershipIdentity;
  readonly authorizedFact: RuntimeAuthorizedFact | null;
  readonly scenes: readonly {
    readonly sceneExecutionId: string;
    readonly sceneId: string;
    readonly sceneOrder: number;
    readonly observedState?: SceneRuntimeState;
    readonly schedulingBundleComplete?: boolean;
  }[];
  readonly derivedReadiness: ExecutionPlanDerivedReadiness;
  readonly derivedAt: string;
}): RuntimeAuthorizationProjection {
  const sceneProjections = projectSceneRuntimes({
    executionPlanId: input.ownership.executionPlanId,
    scenes: input.scenes,
    authorizedFact: input.authorizedFact,
    derivedAt: input.derivedAt,
  });

  return RuntimeAuthorizationProjectionSchema.parse({
    projectionVersion: RUNTIME_PROJECTION_VERSION,
    executionPlanId: input.ownership.executionPlanId,
    ownership: input.ownership,
    hasAuthorizedFact: input.authorizedFact !== null,
    authorizedFact: input.authorizedFact,
    sceneProjections,
    derivedReadiness: input.derivedReadiness,
    executionAuthority:
      input.authorizedFact !== null ? "RUNTIME_AUTHORIZED_FACT" : "NONE",
    executionAllowed: false,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
    automaticFallbackEnabled: false,
    derivedAt: input.derivedAt,
  });
}
