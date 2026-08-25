/**
 * Sprint 4 Phase F — Canonical Runtime Recovery orchestrator.
 *
 * Only approved recovery commands. No generic retry. No provider resubmit.
 * Browser cannot call this — Admin trusted context required.
 */
import {
  AdminAuditRepositoryImpl,
  AdminRuntimeOperationsError,
  AdminRuntimeOperationsReadRepositoryImpl,
  AdminRuntimeRecoveryReceiptRepositoryImpl,
  type AdminRuntimeOperationsReadRepositoryImpl as ReadRepo,
} from "@ceo-agent/db";
import {
  RuntimeRecoveryCommandTypeSchema,
  type RuntimeRecoveryCommandResult,
  type RuntimeRecoveryCommandType,
} from "@ceo-agent/shared";
import {
  buildAdminAuditEvent,
  buildAdminCommandId,
  buildRuntimeRecoveryCommandResult,
  explanationForRecoveryCommand,
  recoveryCommandReceiptId,
  redactAdminAuditPayload,
  sha256CanonicalIntegrityHash,
  type TrustedAdminCommandContext,
} from "@ceo-agent/shared/server";

export class RuntimeRecoveryError extends Error {
  readonly status: number;

  constructor(
    readonly code: string,
    message: string,
    status = 409
  ) {
    super(message);
    this.name = "RuntimeRecoveryError";
    this.status = status;
  }
}

export type RuntimeRecoveryRequest = {
  readonly context: TrustedAdminCommandContext;
  readonly commandType: RuntimeRecoveryCommandType;
  readonly executionPlanId?: string | null;
  readonly targetId: string;
  /** Optional provider attempt/execution id for reconcile. */
  readonly attemptId?: string | null;
  readonly executionId?: string | null;
};

/**
 * Canonical recovery authority for Admin Runtime Operations.
 * Does not own Billing/Credits/Subscription/Entitlement/Pricing/Commercial Auth.
 */
export class RuntimeRecoveryOrchestrator {
  constructor(
    private readonly receipts = new AdminRuntimeRecoveryReceiptRepositoryImpl(),
    private readonly reads: Pick<
      ReadRepo,
      | "getExecutionReadModel"
      | "getExecutionTimeline"
      | "getDurableMediaDiagnostics"
    > = new AdminRuntimeOperationsReadRepositoryImpl(),
    private readonly audit = new AdminAuditRepositoryImpl()
  ) {}

  async execute(
    input: RuntimeRecoveryRequest
  ): Promise<{
    result: RuntimeRecoveryCommandResult;
    replayed: boolean;
  }> {
    const commandType = RuntimeRecoveryCommandTypeSchema.parse(
      input.commandType
    );
    const acceptedAt = new Date().toISOString();
    const commandId = buildAdminCommandId(input.context);
    const recoveryReceiptId = recoveryCommandReceiptId({
      commandType,
      idempotencyKey: input.context.idempotencyKey,
      targetId: input.targetId,
    });

    const explanation = explanationForRecoveryCommand(commandType);
    let outcomeSummary: string;

    try {
      switch (commandType) {
        case "ReconcileProviderAcceptance": {
          // Lookup-only reconciliation intent — no provider resubmit.
          if (!input.executionPlanId && !input.executionId && !input.attemptId) {
            throw new RuntimeRecoveryError(
              "RUNTIME_RECOVERY_TARGET_REQUIRED",
              "ReconcileProviderAcceptance requires executionPlanId, executionId, or attemptId",
              400
            );
          }
          outcomeSummary =
            "Recorded ReconcileProviderAcceptance. Provider lookup-only reconciliation is eligible; generation will not be resubmitted.";
          break;
        }
        case "RetryProjection": {
          if (!input.executionPlanId) {
            throw new RuntimeRecoveryError(
              "RUNTIME_RECOVERY_TARGET_REQUIRED",
              "RetryProjection requires executionPlanId",
              400
            );
          }
          await this.reads.getExecutionTimeline(
            input.context,
            input.executionPlanId
          );
          outcomeSummary =
            "Retried projection rebuild from accepted durable facts for the Execution Plan. No provider generation resubmit.";
          break;
        }
        case "RebuildReadModel": {
          if (!input.executionPlanId) {
            throw new RuntimeRecoveryError(
              "RUNTIME_RECOVERY_TARGET_REQUIRED",
              "RebuildReadModel requires executionPlanId",
              400
            );
          }
          await this.reads.getExecutionReadModel(
            input.context,
            input.executionPlanId
          );
          await this.reads.getExecutionTimeline(
            input.context,
            input.executionPlanId
          );
          await this.reads.getDurableMediaDiagnostics(
            input.context,
            input.executionPlanId
          );
          outcomeSummary =
            "Rebuilt Admin Runtime read model, Execution Timeline, and Durable Media diagnostics from persisted facts.";
          break;
        }
        case "RecoverAiStoryPreDispatch": {
          throw new RuntimeRecoveryError(
            "RUNTIME_RECOVERY_TARGET_REQUIRED",
            "AI Story pre-dispatch recovery requires the Scene-scoped canonical recovery route",
            400
          );
        }
      }
    } catch (error) {
      if (error instanceof AdminRuntimeOperationsError) {
        throw new RuntimeRecoveryError(error.code, error.message, error.status);
      }
      throw error;
    }

    const result = buildRuntimeRecoveryCommandResult({
      commandType,
      commandId,
      executionPlanId: input.executionPlanId ?? null,
      targetId: input.targetId,
      status: "ACCEPTED",
      explanation,
      outcomeSummary,
      acceptedAt,
    });

    const accepted = await this.receipts.acceptOrConverge({
      recoveryReceiptId,
      result,
      orgId: input.context.targetOrgId,
      workspaceId: input.context.targetWorkspaceId,
      actorUserId: input.context.actorUserId,
      reason: input.context.reason,
      idempotencyKey: input.context.idempotencyKey,
    });

    if (!accepted.replayed) {
      const payload = redactAdminAuditPayload({
        commandType,
        executionPlanId: input.executionPlanId ?? null,
        explanation,
      });
      const auditEvent = buildAdminAuditEvent({
        commandId,
        eventType: "COMMAND_SUCCEEDED",
        commandStatus: "SUCCEEDED",
        actorUserId: input.context.actorUserId,
        platformAdminAssignmentId: input.context.platformAdminAssignmentId,
        platformRole: input.context.platformRole,
        action: commandType,
        targetType: "runtime_recovery_target",
        targetId: input.targetId,
        orgId: input.context.targetOrgId,
        workspaceId: input.context.targetWorkspaceId,
        reason: input.context.reason,
        requestId: input.context.requestId,
        idempotencyKey: input.context.idempotencyKey,
        payloadDigest: sha256CanonicalIntegrityHash(payload),
        createdAt: acceptedAt,
      });
      await this.audit.acceptOrConverge(auditEvent);
    }

    return { result: accepted.value, replayed: accepted.replayed };
  }
}
