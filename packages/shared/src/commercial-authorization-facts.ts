/**
 * Sprint 4 Phase E — Deterministic Commercial Authorization fact builders.
 */
import {
  COMMERCIAL_EXECUTION_AUTHORIZATION_CONTRACT_VERSION,
  CommercialExecutionAuthorizationSchema,
  type CommercialExecutionAuthorization,
} from "./commercial-authorization";
import type { CapabilityKey } from "./commercial-entitlements";
import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "./canonical-integrity";

export type BuildCommercialExecutionAuthorizationInput = {
  orgId: string;
  workspaceId: string;
  capabilityKey: CapabilityKey;
  executionIdentity: string;
  entitlementEvidenceId: string;
  pricingRuleKey: string;
  pricingRuleVersion: string;
  pricingRuleIntegrityHash: string;
  creditReservationId?: string | null;
  authorizedAt: string;
  identitySeed?: string;
};

export function buildCommercialExecutionAuthorization(
  input: BuildCommercialExecutionAuthorizationInput
): CommercialExecutionAuthorization {
  const commercialAuthorizationId = deterministicUuidFromFingerprint(
    "commercial-execution-authorization",
    input.identitySeed ??
      `${input.orgId}:${input.workspaceId}:${input.capabilityKey}:${input.executionIdentity}`
  );
  const withoutHash = {
    contractVersion: COMMERCIAL_EXECUTION_AUTHORIZATION_CONTRACT_VERSION,
    commercialAuthorizationId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    capabilityKey: input.capabilityKey,
    executionIdentity: input.executionIdentity,
    entitlementEvidenceId: input.entitlementEvidenceId,
    pricingRuleKey: input.pricingRuleKey,
    pricingRuleVersion: input.pricingRuleVersion,
    pricingRuleIntegrityHash: input.pricingRuleIntegrityHash,
    creditReservationId: input.creditReservationId ?? null,
    authorizedAt: input.authorizedAt,
  };
  return CommercialExecutionAuthorizationSchema.parse({
    ...withoutHash,
    integrityHash: sha256CanonicalIntegrityHash(withoutHash),
  });
}

/** Canonical execution identity for AI Story billable Execute. */
export function commercialExecutionIdentityForPlan(
  executionPlanId: string
): string {
  return `execution-plan:${executionPlanId}`;
}
