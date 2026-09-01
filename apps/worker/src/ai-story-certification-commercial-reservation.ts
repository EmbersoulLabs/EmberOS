import { CertificationCommercialAuthorityService } from "@ceo-agent/db";
import type { SceneProviderWorkerRuntimeDependencies } from "@ceo-agent/agents";
import { compiledProviderRequestIdForSchedule } from "@ceo-agent/agents";

type CommercialGate = NonNullable<
  SceneProviderWorkerRuntimeDependencies["commercialReservation"]
>;

const terminalSuccess = new Set(["SUCCEEDED"]);
const terminalNoCharge = new Set(["NOT_ACCEPTED", "NOT_SUBMITTED", "REJECTED", "FAILED", "TIMED_OUT"]);

/**
 * Mandatory pre-dispatch certification budget gate for the production STAGING
 * AI Story worker. It never reads credentials and never calls a Provider.
 */
export class AiStoryCertificationCommercialReservationGate implements CommercialGate {
  constructor(
    private readonly authority = new CertificationCommercialAuthorityService()
  ) {}

  private resolveCompiledRequestBinding(
    input: Parameters<CommercialGate["reserveBeforeSubmit"]>[0]
  ) {
    const compiledRequestId =
      input.bundle.envelope.executionContext.trace?.compiledRequestId?.trim() ??
      compiledProviderRequestIdForSchedule({
        sceneExecutionId: input.bundle.correlation.sceneExecutionId,
        scheduledAt: input.bundle.correlation.scheduledAt,
      });
    const requestFingerprint =
      input.bundle.envelope.executionContext.trace?.compiledRequestFingerprint?.trim();
    return { compiledRequestId, requestFingerprint };
  }

  async previewBeforeSubmit(input: Parameters<CommercialGate["reserveBeforeSubmit"]>[0]) {
    const { compiledRequestId, requestFingerprint } =
      this.resolveCompiledRequestBinding(input);
    await this.authority.previewForSceneExecution({
      orgId: input.bundle.correlation.ownership.orgId,
      workspaceId: input.bundle.envelope.workspaceId,
      sceneExecutionId: input.bundle.correlation.sceneExecutionId,
      compiledRequestId,
      ...(requestFingerprint ? { requestFingerprint } : {}),
      executionIdentity: input.providerAttemptId,
      reservedAt: input.reservedAt,
    });
  }

  async reserveBeforeSubmit(input: Parameters<CommercialGate["reserveBeforeSubmit"]>[0]) {
    const { compiledRequestId, requestFingerprint } =
      this.resolveCompiledRequestBinding(input);
    const { pricingRule } = await this.authority.previewForSceneExecution({
      orgId: input.bundle.correlation.ownership.orgId,
      workspaceId: input.bundle.envelope.workspaceId,
      sceneExecutionId: input.bundle.correlation.sceneExecutionId,
      compiledRequestId,
      ...(requestFingerprint ? { requestFingerprint } : {}),
      executionIdentity: input.providerAttemptId,
      reservedAt: input.reservedAt,
    });
    const result = await this.authority.reserve({
      orgId: input.bundle.correlation.ownership.orgId,
      workspaceId: input.bundle.envelope.workspaceId,
      executionIdentity: input.providerAttemptId,
      pricingRule,
      createdAt: input.reservedAt,
      claimSubmission: false,
    });
    return { reservationId: result.reservation.certificationReservationId };
  }

  async claimSubmissionBeforeAdapter(
    input: Parameters<NonNullable<CommercialGate["claimSubmissionBeforeAdapter"]>>[0]
  ) {
    const reservation = await this.authority.getReservationByExecutionIdentity({
      executionIdentity: input.providerAttemptId,
    });
    if (!reservation || reservation.certificationReservationId !== input.reservationId) {
      throw new Error("CERTIFICATION_RESERVATION_ATTEMPT_BINDING_INVALID");
    }
    const result = await this.authority.markSubmitted(
      input.reservationId,
      input.claimedAt
    );
    if (!['SUBMITTED', 'SETTLED'].includes(result.reservation.status)) {
      throw new Error("CERTIFICATION_SUBMISSION_SLOT_NOT_CLAIMED");
    }
  }

  async releaseBeforeAdapterFailure(
    input: Parameters<NonNullable<CommercialGate["releaseBeforeAdapterFailure"]>>[0]
  ) {
    const reservation = await this.authority.getReservationById(input.reservationId);
    if (reservation?.status === "RESERVED") {
      await this.authority.release(input.reservationId, input.occurredAt);
    }
  }

  async loadForOutcome(input: Parameters<CommercialGate["loadForOutcome"]>[0]) {
    // Worker Attempt is deterministic and is the protected commercial identity.
    const result = await this.authority.getReservationByExecutionIdentity({
      executionIdentity: input.providerAttemptId,
    });
    return result ? { reservationId: result.certificationReservationId } : null;
  }

  async recordProviderOutcome(input: Parameters<CommercialGate["recordProviderOutcome"]>[0]) {
    if (input.phase === "submit") {
      if (
        input.acceptanceClassification !== "ACCEPTED" &&
        input.acceptanceClassification !== "ACCEPTANCE_UNKNOWN"
      ) {
        await this.authority.release(input.reservationId, input.occurredAt);
      }
      return;
    }
    if (terminalSuccess.has(input.canonicalProviderState)) {
      await this.authority.settleFromProviderUsage({
        reservationId: input.reservationId,
        completionTokens:
          input.normalizedUsageFacts?.unitKind === "tokens"
            ? input.normalizedUsageFacts.units
            : undefined,
        settledAt: input.occurredAt,
      });
    } else if (terminalNoCharge.has(input.canonicalProviderState)) {
      // ModelArk documents no charge for unsuccessful generation.
      await this.authority.release(input.reservationId, input.occurredAt);
    }
  }
}
