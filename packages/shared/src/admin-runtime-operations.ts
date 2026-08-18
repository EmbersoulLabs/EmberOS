/**
 * Sprint 4 Phase F — Admin Runtime Operations contracts.
 *
 * Runtime Ops consumes prior authorities; it does NOT own Billing / Credits /
 * Subscription / Entitlement / Pricing / Commercial Authorization / Provider execution.
 */
import { z } from "zod";

export const ADMIN_RUNTIME_OPERATIONS_CONTRACT_VERSION = "1" as const;

const UuidSchema = z.string().uuid();
const NonEmptyTextSchema = z.string().trim().min(1);
const IsoDatetimeSchema = z.string().datetime();
const IntegrityHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "Expected sha256:<64 hex>");

/** Canonical recovery commands only — no generic retry / resubmit generation. */
export const RUNTIME_RECOVERY_COMMAND_TYPES = [
  "ReconcileProviderAcceptance",
  "RetryProjection",
  "RebuildReadModel",
] as const;

export const RuntimeRecoveryCommandTypeSchema = z.enum(
  RUNTIME_RECOVERY_COMMAND_TYPES
);
export type RuntimeRecoveryCommandType = z.infer<
  typeof RuntimeRecoveryCommandTypeSchema
>;

export const RUNTIME_TIMELINE_STAGES = [
  "COMMERCIAL_AUTHORIZATION",
  "RUNTIME_AUTHORIZATION",
  "SCENE_SCHEDULING",
  "PROVIDER_ACCEPTANCE",
  "PROVIDER_COMPLETION",
  "ASSEMBLY",
  "FINAL_STORY_RESULT",
  "DURABLE_MEDIA",
] as const;

export const RuntimeTimelineStageKeySchema = z.enum(RUNTIME_TIMELINE_STAGES);
export type RuntimeTimelineStageKey = z.infer<
  typeof RuntimeTimelineStageKeySchema
>;

export const RuntimeTimelineStageStatusSchema = z.enum([
  "NOT_STARTED",
  "IN_PROGRESS",
  "SUCCEEDED",
  "FAILED",
  "RECONCILIATION_REQUIRED",
  "BLOCKED",
  "UNKNOWN",
]);
export type RuntimeTimelineStageStatus = z.infer<
  typeof RuntimeTimelineStageStatusSchema
>;

export const RuntimeTimelineStageSchema = z
  .object({
    stage: RuntimeTimelineStageKeySchema,
    status: RuntimeTimelineStageStatusSchema,
    occurredAt: IsoDatetimeSchema.nullable(),
    evidenceKind: NonEmptyTextSchema.nullable(),
    evidenceId: NonEmptyTextSchema.nullable(),
    eligibleRecoveryCommands: z.array(RuntimeRecoveryCommandTypeSchema),
    summary: NonEmptyTextSchema,
  })
  .strict();

export type RuntimeTimelineStage = z.infer<typeof RuntimeTimelineStageSchema>;

export const RuntimeExecutionTimelineSchema = z
  .object({
    contractVersion: z.literal(ADMIN_RUNTIME_OPERATIONS_CONTRACT_VERSION),
    executionPlanId: UuidSchema,
    orgId: UuidSchema,
    workspaceId: UuidSchema,
    projectedAt: IsoDatetimeSchema,
    stages: z.array(RuntimeTimelineStageSchema),
  })
  .strict();

export type RuntimeExecutionTimeline = z.infer<
  typeof RuntimeExecutionTimelineSchema
>;

export const AdminRuntimeReadModelSchema = z
  .object({
    contractVersion: z.literal(ADMIN_RUNTIME_OPERATIONS_CONTRACT_VERSION),
    executionPlanId: UuidSchema,
    orgId: UuidSchema,
    workspaceId: UuidSchema,
    campaignId: UuidSchema.nullable(),
    storyId: UuidSchema.nullable(),
    productRuntimeStatus: NonEmptyTextSchema.nullable(),
    commercialAuthorizationId: UuidSchema.nullable(),
    runtimeAuthorizationId: UuidSchema.nullable(),
    sceneCount: z.number().int().nonnegative(),
    providerAttemptCount: z.number().int().nonnegative(),
    assemblyJobId: UuidSchema.nullable(),
    assemblyStatus: NonEmptyTextSchema.nullable(),
    finalStoryResultId: UuidSchema.nullable(),
    durableMediaAttestationCount: z.number().int().nonnegative(),
    workerDispatchCount: z.number().int().nonnegative(),
    outboxPendingCount: z.number().int().nonnegative(),
    outboxDeadLetterCount: z.number().int().nonnegative(),
    reconciliationRequired: z.boolean(),
    projectedAt: IsoDatetimeSchema,
  })
  .strict();

export type AdminRuntimeReadModel = z.infer<typeof AdminRuntimeReadModelSchema>;

export const ProviderHealthSnapshotSchema = z
  .object({
    contractVersion: z.literal(ADMIN_RUNTIME_OPERATIONS_CONTRACT_VERSION),
    projectedAt: IsoDatetimeSchema,
    orgId: UuidSchema.nullable(),
    providers: z.array(
      z
        .object({
          providerId: NonEmptyTextSchema,
          attemptCount: z.number().int().nonnegative(),
          succeededCount: z.number().int().nonnegative(),
          failedCount: z.number().int().nonnegative(),
          acceptanceUnknownCount: z.number().int().nonnegative(),
          successRate: z.number().min(0).max(1).nullable(),
          failureRate: z.number().min(0).max(1).nullable(),
          averageLatencyMs: z.number().nonnegative().nullable(),
          usageEventCount: z.number().int().nonnegative(),
          costEventCount: z.number().int().nonnegative(),
        })
        .strict()
    ),
  })
  .strict();

export type ProviderHealthSnapshot = z.infer<typeof ProviderHealthSnapshotSchema>;

export const WorkerHealthSnapshotSchema = z
  .object({
    contractVersion: z.literal(ADMIN_RUNTIME_OPERATIONS_CONTRACT_VERSION),
    projectedAt: IsoDatetimeSchema,
    heartbeatAvailable: z.boolean(),
    workers: z.array(
      z
        .object({
          workerKey: NonEmptyTextSchema,
          state: NonEmptyTextSchema,
          currentJobId: NonEmptyTextSchema.nullable(),
          build: NonEmptyTextSchema.nullable(),
          queueAssignment: NonEmptyTextSchema.nullable(),
          lastObservedAt: IsoDatetimeSchema.nullable(),
        })
        .strict()
    ),
  })
  .strict();

export type WorkerHealthSnapshot = z.infer<typeof WorkerHealthSnapshotSchema>;

export const QueueHealthSnapshotSchema = z
  .object({
    contractVersion: z.literal(ADMIN_RUNTIME_OPERATIONS_CONTRACT_VERSION),
    projectedAt: IsoDatetimeSchema,
    bullmq: z
      .object({
        available: z.boolean(),
        pending: z.number().int().nonnegative().nullable(),
        active: z.number().int().nonnegative().nullable(),
        failed: z.number().int().nonnegative().nullable(),
        delayed: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    providerOutbox: z
      .object({
        pending: z.number().int().nonnegative(),
        claimed: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
        deadLetter: z.number().int().nonnegative(),
        oldestPendingAt: IsoDatetimeSchema.nullable(),
        expiredLeaseCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type QueueHealthSnapshot = z.infer<typeof QueueHealthSnapshotSchema>;

export const DurableMediaDiagnosticSchema = z
  .object({
    contractVersion: z.literal(ADMIN_RUNTIME_OPERATIONS_CONTRACT_VERSION),
    executionPlanId: UuidSchema,
    orgId: UuidSchema,
    workspaceId: UuidSchema,
    projectedAt: IsoDatetimeSchema,
    items: z.array(
      z
        .object({
          mediaAttestationId: UuidSchema,
          sceneExecutionId: UuidSchema,
          durableObjectReference: NonEmptyTextSchema,
          contentHash: IntegrityHashSchema,
          availability: z.enum(["ATTESTED", "MISSING_ATTESTATION", "UNKNOWN"]),
          retentionClass: z.literal("workspace_scoped_object"),
          verification: z.enum(["HASH_PRESENT", "UNVERIFIED"]),
          attestedAt: IsoDatetimeSchema.nullable(),
        })
        .strict()
    ),
  })
  .strict();

export type DurableMediaDiagnostic = z.infer<typeof DurableMediaDiagnosticSchema>;

export const RuntimeRecoveryExplanationSchema = z
  .object({
    willHappen: z.array(NonEmptyTextSchema),
    willNotHappen: z.array(NonEmptyTextSchema),
  })
  .strict();

export type RuntimeRecoveryExplanation = z.infer<
  typeof RuntimeRecoveryExplanationSchema
>;

export const RuntimeRecoveryCommandResultSchema = z
  .object({
    contractVersion: z.literal(ADMIN_RUNTIME_OPERATIONS_CONTRACT_VERSION),
    commandType: RuntimeRecoveryCommandTypeSchema,
    commandId: UuidSchema,
    executionPlanId: UuidSchema.nullable(),
    targetId: NonEmptyTextSchema,
    status: z.enum(["ACCEPTED", "REPLAYED", "REJECTED"]),
    explanation: RuntimeRecoveryExplanationSchema,
    outcomeSummary: NonEmptyTextSchema,
    acceptedAt: IsoDatetimeSchema,
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type RuntimeRecoveryCommandResult = z.infer<
  typeof RuntimeRecoveryCommandResultSchema
>;

export function parseAdminRuntimeReadModel(value: unknown): AdminRuntimeReadModel {
  return AdminRuntimeReadModelSchema.parse(value);
}

export function parseRuntimeExecutionTimeline(
  value: unknown
): RuntimeExecutionTimeline {
  return RuntimeExecutionTimelineSchema.parse(value);
}

export function parseRuntimeRecoveryCommandResult(
  value: unknown
): RuntimeRecoveryCommandResult {
  return RuntimeRecoveryCommandResultSchema.parse(value);
}
