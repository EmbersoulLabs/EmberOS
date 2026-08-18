/**
 * Sprint 4 Phase B / B1 — Product Pricing Rule contracts.
 *
 * Provider Cost ≠ Product Pricing Rule ≠ Customer Credit Charge.
 * Do not invent production credit prices — fixtures belong in tests only.
 */
import { z } from "zod";
import { CapabilityKeySchema } from "./commercial-entitlements";
import { sha256CanonicalIntegrityHash } from "./canonical-integrity";

export const PRODUCT_PRICING_RULE_CONTRACT_VERSION = "1" as const;

const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "Expected sha256:<64 hex>");

/**
 * Versioned product pricing rule identity.
 * Amounts are integer credit units when present — never provider USD cost.
 */
export const ProductPricingRuleSchema = z
  .object({
    contractVersion: z.literal(PRODUCT_PRICING_RULE_CONTRACT_VERSION),
    ruleKey: NonEmptyTextSchema,
    ruleVersion: NonEmptyTextSchema,
    capabilityKey: CapabilityKeySchema,
    /** Optional credit charge amount for fixtures / future catalogs. */
    creditAmount: z.number().int().nonnegative().nullable(),
    currencyUnit: z.literal("credit"),
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type ProductPricingRule = z.infer<typeof ProductPricingRuleSchema>;

export type ProductPricingRuleInput = {
  ruleKey: string;
  ruleVersion: string;
  capabilityKey: z.infer<typeof CapabilityKeySchema>;
  creditAmount?: number | null;
};

export function buildProductPricingRule(
  input: ProductPricingRuleInput
): ProductPricingRule {
  const withoutHash = {
    contractVersion: PRODUCT_PRICING_RULE_CONTRACT_VERSION,
    ruleKey: input.ruleKey,
    ruleVersion: input.ruleVersion,
    capabilityKey: input.capabilityKey,
    creditAmount: input.creditAmount ?? null,
    currencyUnit: "credit" as const,
  };
  const integrityHash = sha256CanonicalIntegrityHash(withoutHash);
  return ProductPricingRuleSchema.parse({ ...withoutHash, integrityHash });
}

export function parseProductPricingRule(value: unknown): ProductPricingRule {
  return ProductPricingRuleSchema.parse(value);
}

/**
 * Explicit separation marker — ProviderCost is not a ProductPricingRule.
 */
export const PRODUCT_PRICING_AUTHORITY = "PRODUCT_PRICING_RULE" as const;
export const PROVIDER_COST_AUTHORITY = "PROVIDER_COST" as const;
export const CUSTOMER_CREDIT_CHARGE_AUTHORITY =
  "CUSTOMER_CREDIT_CHARGE" as const;
