/**
 * Sprint 4 Phase E — Commercial Authorization runtime authority.
 *
 * Sole path to create Commercial Execution Authorization for billable Execute.
 * Fail closed. Browser cannot call this. Does not own Billing/Credits/Pricing.
 */
import {
  BillingAccountRepositoryImpl,
  CommercialAuthorizationError,
  CommercialAuthorizationRepositoryImpl,
  CertificationCommercialAuthorityService,
  CreditsAccountingError,
  CreditsAccountingService,
  EntitlementRepositoryImpl,
  SubscriptionRepositoryImpl,
  type BillingAccountRepository,
  type CommercialAuthorizationRepository,
  type EntitlementRepository,
  type SubscriptionRepository,
} from "@ceo-agent/db";
import {
  commercialExecutionIdentityForPlan,
  buildCommercialExecutionAuthorization,
  effectiveProjectionHasCapability,
  resolveProductPricingRuleForCapability,
  subscriptionStatusAllowsPlanCapabilities,
  type CapabilityKey,
  type CommercialExecutionAuthorization,
  type ProductPricingRule,
} from "@ceo-agent/shared/server";

export {
  CommercialAuthorizationError,
  type CommercialAuthorizationErrorCode,
} from "@ceo-agent/db";

export type ResolvePricingRule = (
  capabilityKey: CapabilityKey
) => ProductPricingRule | null;

export type AuthorizeBillableExecuteInput = {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly capabilityKey: CapabilityKey;
  readonly executionIdentity: string;
  readonly authorizedAt: string;
  /** Optional override for tests / future catalogs. */
  readonly resolvePricingRule?: ResolvePricingRule;
};

export type AuthorizeBillableExecuteResult = {
  readonly authorization: CommercialExecutionAuthorization;
  readonly replayed: boolean;
  readonly pricingRule: ProductPricingRule | null;
};

type CertificationCommercialReader = Pick<
  CertificationCommercialAuthorityService,
  "getActiveScope" | "getActivePricingEvidence"
>;

export class CommercialAuthorizationService {
  private certificationCommercial?: CertificationCommercialReader;

  constructor(
    private readonly billing: BillingAccountRepository = new BillingAccountRepositoryImpl(),
    private readonly subscriptions: SubscriptionRepository = new SubscriptionRepositoryImpl(),
    private readonly entitlements: EntitlementRepository = new EntitlementRepositoryImpl(),
    private readonly credits: CreditsAccountingService = new CreditsAccountingService(),
    private readonly authorizations: CommercialAuthorizationRepository = new CommercialAuthorizationRepositoryImpl(),
    private readonly defaultResolvePricing: ResolvePricingRule = resolveProductPricingRuleForCapability,
    certificationCommercial?: CertificationCommercialReader
  ) {
    this.certificationCommercial = certificationCommercial;
  }

  private certificationReader(): CertificationCommercialReader {
    this.certificationCommercial ??= new CertificationCommercialAuthorityService();
    return this.certificationCommercial;
  }

  /**
   * Evaluate commercial chain and accept-or-converge Commercial Authorization.
   * Exactly-once for (org, workspace, capability, executionIdentity).
   */
  async authorizeBillableExecute(
    input: AuthorizeBillableExecuteInput
  ): Promise<AuthorizeBillableExecuteResult> {
    const existing = await this.authorizations.getByExecutionIdentity({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      capabilityKey: input.capabilityKey,
      executionIdentity: input.executionIdentity,
    });
    if (existing) {
      const pricingRule = existing.pricingRuleKey.startsWith("provider-usd:")
        ? null
        : (input.resolvePricingRule ?? this.defaultResolvePricing)(input.capabilityKey) ?? ({
          contractVersion: "1",
          ruleKey: existing.pricingRuleKey,
          ruleVersion: existing.pricingRuleVersion,
          capabilityKey: input.capabilityKey,
          creditAmount: null,
          currencyUnit: "credit",
          integrityHash: existing.pricingRuleIntegrityHash,
          } satisfies ProductPricingRule);
      return {
        authorization: existing,
        replayed: true,
        pricingRule,
      };
    }

    const billingAccount = await this.billing.getByOrgId(input.orgId);
    if (!billingAccount) {
      throw new CommercialAuthorizationError(
        "COMMERCIAL_AUTH_BILLING_MISSING",
        "Billing Account is required before Commercial Authorization"
      );
    }

    const subscription = await this.subscriptions.getProjectionByOrgId(input.orgId);
    const subscriptionEligible = Boolean(
      subscription && subscriptionStatusAllowsPlanCapabilities(subscription.status)
    );
    const certificationScope =
      !subscriptionEligible && input.capabilityKey === "ai_story.execute"
        ? await this.certificationReader().getActiveScope(input.orgId, input.workspaceId)
        : null;
    if (!subscriptionEligible && !certificationScope) {
      throw new CommercialAuthorizationError(
        "COMMERCIAL_AUTH_SUBSCRIPTION_INVALID",
        "An eligible Subscription Projection or exact active STAGING certification commercial scope is required"
      );
    }

    const projection =
      (await this.entitlements.getEffectiveProjection({
        orgId: input.orgId,
        workspaceId: input.workspaceId,
      })) ??
      (await this.entitlements.rebuildEffectiveProjection({
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        projectedAt: input.authorizedAt,
      }));

    if (
      !effectiveProjectionHasCapability(projection, input.capabilityKey)
    ) {
      throw new CommercialAuthorizationError(
        "COMMERCIAL_AUTH_ENTITLEMENT_DENIED",
        `Effective Entitlement lacks capability ${input.capabilityKey}`
      );
    }

    const entry = projection.entries.find(
      (candidate) => candidate.capabilityKey === input.capabilityKey
    );
    const entitlementEvidenceId =
      entry?.entitlementGrantId ?? projection.integrityHash;

    if (certificationScope) {
      const providerPricing = await this.certificationReader().getActivePricingEvidence(input.authorizedAt);
      if (!providerPricing) {
        throw new CommercialAuthorizationError(
          "COMMERCIAL_AUTH_PRICING_MISSING",
          "Canonical Provider USD pricing is required for certification execution"
        );
      }
      const authorization = buildCommercialExecutionAuthorization({
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        capabilityKey: input.capabilityKey,
        executionIdentity: input.executionIdentity,
        entitlementEvidenceId: `${entitlementEvidenceId}:${certificationScope.certificationScopeId}`,
        pricingRuleKey: providerPricing.ruleKey,
        pricingRuleVersion: providerPricing.ruleVersion,
        pricingRuleIntegrityHash: providerPricing.integrityHash,
        creditReservationId: null,
        authorizedAt: input.authorizedAt,
      });
      const accepted = await this.authorizations.acceptOrConverge(authorization);
      return { authorization: accepted.value, replayed: accepted.replayed, pricingRule: null };
    }

    const resolvePricing =
      input.resolvePricingRule ?? this.defaultResolvePricing;
    const pricingRule = resolvePricing(input.capabilityKey);
    if (!pricingRule || pricingRule.creditAmount === null) {
      throw new CommercialAuthorizationError(
        "COMMERCIAL_AUTH_PRICING_MISSING",
        `No Product Pricing Rule for capability ${input.capabilityKey}`
      );
    }

    let creditReservationId: string | null = null;
    if (pricingRule.creditAmount > 0) {
      try {
        const reserved = await this.credits.reserveCredits({
          orgId: input.orgId,
          workspaceId: input.workspaceId,
          amount: pricingRule.creditAmount,
          pricingRuleKey: pricingRule.ruleKey,
          pricingRuleVersion: pricingRule.ruleVersion,
          executionIdentity: input.executionIdentity,
          createdAt: input.authorizedAt,
          identitySeed: `commercial-auth:${input.orgId}:${input.workspaceId}:${input.capabilityKey}:${input.executionIdentity}`,
        });
        creditReservationId = reserved.reservation.creditReservationId;
      } catch (error) {
        if (
          error instanceof CreditsAccountingError &&
          error.code === "CREDITS_INSUFFICIENT"
        ) {
          throw new CommercialAuthorizationError(
            "COMMERCIAL_AUTH_CREDITS_INSUFFICIENT",
            error.message,
            403
          );
        }
        throw error;
      }
    }

    const authorization = buildCommercialExecutionAuthorization({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      capabilityKey: input.capabilityKey,
      executionIdentity: input.executionIdentity,
      entitlementEvidenceId,
      pricingRuleKey: pricingRule.ruleKey,
      pricingRuleVersion: pricingRule.ruleVersion,
      pricingRuleIntegrityHash: pricingRule.integrityHash,
      creditReservationId,
      authorizedAt: input.authorizedAt,
    });

    const accepted = await this.authorizations.acceptOrConverge(authorization);
    return {
      authorization: accepted.value,
      replayed: accepted.replayed,
      pricingRule,
    };
  }

  async authorizeExecutionPlanExecute(input: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly executionPlanId: string;
    readonly authorizedAt: string;
    readonly resolvePricingRule?: ResolvePricingRule;
  }): Promise<AuthorizeBillableExecuteResult> {
    return this.authorizeBillableExecute({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      capabilityKey: "ai_story.execute",
      executionIdentity: commercialExecutionIdentityForPlan(
        input.executionPlanId
      ),
      authorizedAt: input.authorizedAt,
      resolvePricingRule: input.resolvePricingRule,
    });
  }
}
