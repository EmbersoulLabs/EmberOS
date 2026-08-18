/**
 * Sprint 4 Phase E — Source-controlled Product Pricing catalog.
 *
 * Product Pricing Rule authority remains buildProductPricingRule.
 * This catalog only resolves which rule applies to a capability.
 * Amounts are integer credit units — not provider USD cost.
 *
 * Catalog v1 documents fixture-grade prices for billable Execute gates.
 * Do not treat these as customer-facing Stripe prices.
 */
import {
  buildProductPricingRule,
  type ProductPricingRule,
} from "./commercial-pricing";
import type { CapabilityKey } from "./commercial-entitlements";

export const PRODUCT_PRICING_CATALOG_VERSION = "1" as const;

type CatalogEntry = {
  readonly ruleKey: string;
  readonly ruleVersion: string;
  readonly creditAmount: number;
};

/**
 * Frozen catalog entries. Missing capability → fail closed at authorize time.
 */
const PRODUCT_PRICING_CATALOG_V1: Readonly<
  Partial<Record<CapabilityKey, CatalogEntry>>
> = Object.freeze({
  "ai_story.execute": Object.freeze({
    ruleKey: "ai_story.execute",
    ruleVersion: "1",
    /** Fixture-grade credit units for Sprint 4 Phase E billable Execute. */
    creditAmount: 10,
  }),
  "creative_studio.execute": Object.freeze({
    ruleKey: "creative_studio.execute",
    ruleVersion: "1",
    /** Fixture-grade credit units for MS-016 Creative Studio execute. */
    creditAmount: 5,
  }),
});

export function resolveProductPricingRuleForCapability(
  capabilityKey: CapabilityKey
): ProductPricingRule | null {
  const entry = PRODUCT_PRICING_CATALOG_V1[capabilityKey];
  if (!entry) return null;
  return buildProductPricingRule({
    ruleKey: entry.ruleKey,
    ruleVersion: entry.ruleVersion,
    capabilityKey,
    creditAmount: entry.creditAmount,
  });
}
