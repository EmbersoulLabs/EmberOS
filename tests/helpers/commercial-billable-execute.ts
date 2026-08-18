/**
 * Sprint 4 Phase E — Test helpers for billable Commercial Authorization.
 */
import {
  BillingAccountRepositoryImpl,
  CommercialAuthorizationRepositoryImpl,
  CreditsAccountingService,
  EntitlementRepositoryImpl,
  SubscriptionRepositoryImpl,
} from "@ceo-agent/db";
import {
  buildBillingAccount,
  buildCommercialExecutionAuthorization,
  buildCreditLedgerEntry,
  buildSubscriptionProjection,
  commercialExecutionIdentityForPlan,
  resolveProductPricingRuleForCapability,
} from "@ceo-agent/shared/server";

const NOW = "2026-08-10T20:00:00.000Z";

/**
 * Seed Billing → ACTIVE agency Subscription → Effective Entitlement → credit grant.
 * Required before CommercialAuthorizationService / canonical Execute.
 */
export async function seedBillableCommercialPrerequisites(input: {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly creditGrantAmount?: number;
  readonly projectedAt?: string;
}): Promise<{ billingAccountId: string }> {
  const projectedAt = input.projectedAt ?? NOW;
  const billing = new BillingAccountRepositoryImpl();
  const account = buildBillingAccount({
    orgId: input.orgId,
    externalCustomerReference: `cus_phase_e_${input.orgId.slice(0, 8)}`,
    createdAt: projectedAt,
    identitySeed: `phase-e-billing:${input.orgId}`,
  });
  await billing.createOrConverge(account);

  const subscriptions = new SubscriptionRepositoryImpl();
  const projection = buildSubscriptionProjection({
    billingAccountId: account.billingAccountId,
    orgId: input.orgId,
    status: "ACTIVE",
    planKey: "agency",
    projectedAt,
    identitySeed: `phase-e-sub:${input.orgId}`,
  });
  await subscriptions.upsertProjection(projection);

  const entitlements = new EntitlementRepositoryImpl();
  await entitlements.rebuildEffectiveProjection({
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    projectedAt,
  });

  const credits = new CreditsAccountingService();
  const wallet = await credits.rebuildWallet(input.orgId, projectedAt);
  if ((input.creditGrantAmount ?? 1_000) > 0) {
    await credits.appendLedgerEntry(
      buildCreditLedgerEntry({
        creditWalletId: wallet.creditWalletId,
        orgId: input.orgId,
        entryType: "GRANT",
        amount: input.creditGrantAmount ?? 1_000,
        reason: "phase-e-seed",
        idempotencyKey: `phase-e-grant:${input.orgId}`,
        createdAt: projectedAt,
      })
    );
  }

  return { billingAccountId: account.billingAccountId };
}

/**
 * Persist a Commercial Authorization fixture for SceneSchedulingCoordinator tests
 * that do not go through CommercialAuthorizationService.
 */
export async function acceptCommercialAuthorizationFixture(input: {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly executionPlanId: string;
  readonly authorizedAt?: string;
  readonly creditReservationId?: string | null;
}): Promise<{ commercialAuthorizationId: string }> {
  const pricing =
    resolveProductPricingRuleForCapability("ai_story.execute") ??
    (() => {
      throw new Error("ai_story.execute pricing catalog missing");
    })();
  const authorization = buildCommercialExecutionAuthorization({
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    capabilityKey: "ai_story.execute",
    executionIdentity: commercialExecutionIdentityForPlan(
      input.executionPlanId
    ),
    entitlementEvidenceId: `fixture-entitlement:${input.executionPlanId}`,
    pricingRuleKey: pricing.ruleKey,
    pricingRuleVersion: pricing.ruleVersion,
    pricingRuleIntegrityHash: pricing.integrityHash,
    creditReservationId: input.creditReservationId ?? null,
    authorizedAt: input.authorizedAt ?? NOW,
  });
  const accepted = await new CommercialAuthorizationRepositoryImpl().acceptOrConverge(
    authorization
  );
  return {
    commercialAuthorizationId:
      accepted.value.commercialAuthorizationId,
  };
}
