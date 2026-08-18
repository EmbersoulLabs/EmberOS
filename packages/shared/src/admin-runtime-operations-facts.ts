/**
 * Sprint 4 Phase F — Deterministic Runtime Ops / Recovery fact builders (server-only).
 */
import {
  ADMIN_RUNTIME_OPERATIONS_CONTRACT_VERSION,
  RuntimeRecoveryCommandResultSchema,
  type RuntimeRecoveryCommandResult,
  type RuntimeRecoveryCommandType,
  type RuntimeRecoveryExplanation,
} from "./admin-runtime-operations";
import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "./canonical-integrity";

export type BuildRuntimeRecoveryCommandResultInput = {
  commandType: RuntimeRecoveryCommandType;
  commandId: string;
  executionPlanId?: string | null;
  targetId: string;
  status: RuntimeRecoveryCommandResult["status"];
  explanation: RuntimeRecoveryExplanation;
  outcomeSummary: string;
  acceptedAt: string;
  identitySeed?: string;
};

export function buildRuntimeRecoveryCommandResult(
  input: BuildRuntimeRecoveryCommandResultInput
): RuntimeRecoveryCommandResult {
  const withoutHash = {
    contractVersion: ADMIN_RUNTIME_OPERATIONS_CONTRACT_VERSION,
    commandType: input.commandType,
    commandId: input.commandId,
    executionPlanId: input.executionPlanId ?? null,
    targetId: input.targetId,
    status: input.status,
    explanation: input.explanation,
    outcomeSummary: input.outcomeSummary,
    acceptedAt: input.acceptedAt,
  };
  return RuntimeRecoveryCommandResultSchema.parse({
    ...withoutHash,
    integrityHash: sha256CanonicalIntegrityHash(withoutHash),
  });
}

export function recoveryCommandReceiptId(input: {
  commandType: RuntimeRecoveryCommandType;
  idempotencyKey: string;
  targetId: string;
}): string {
  return deterministicUuidFromFingerprint(
    "runtime-recovery-command-receipt",
    `${input.commandType}:${input.idempotencyKey}:${input.targetId}`
  );
}

export function explanationForRecoveryCommand(
  commandType: RuntimeRecoveryCommandType
): RuntimeRecoveryExplanation {
  switch (commandType) {
    case "ReconcileProviderAcceptance":
      return {
        willHappen: [
          "Load Provider reconciliation snapshot for the target attempt",
          "Perform provider lookup-only reconciliation decision",
          "Record decision evidence for Admin audit",
        ],
        willNotHappen: [
          "Resubmit generation / create a new Provider Execution",
          "Mutate Billing, Credits, Subscription, or Entitlement",
          "Bypass Commercial Authorization or Runtime Authorization",
        ],
      };
    case "RetryProjection":
      return {
        willHappen: [
          "Replay projection from already-accepted durable facts",
          "Converge Scene / Final Story Result projection if eligible",
        ],
        willNotHappen: [
          "Resubmit provider generation",
          "Schedule new scenes",
          "Change commercial authorities",
        ],
      };
    case "RebuildReadModel":
      return {
        willHappen: [
          "Rebuild Admin Runtime read model and Execution Timeline from persisted facts",
        ],
        willNotHappen: [
          "Write Provider ledger mutations",
          "Retry workers or outbox dispatch",
          "Alter Commercial Authorization",
        ],
      };
  }
}
