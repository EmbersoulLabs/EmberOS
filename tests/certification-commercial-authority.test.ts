import { describe, expect, it } from "vitest";
import {
  CERTIFICATION_COMMERCIAL_REASON,
  CERTIFICATION_MAX_PROVIDER_COST_USD,
  CERTIFICATION_MAX_PROVIDER_SUBMISSIONS,
  ProviderUsdPricingRuleSchema,
  estimateProviderCostUsd,
  withIntegrity,
} from "@ceo-agent/shared/server";

const rule = ProviderUsdPricingRuleSchema.parse(withIntegrity({
  contractVersion: "1" as const,
  providerUsdPricingRuleId: "10000000-0000-4000-8000-000000000001",
  providerKey: "BYTEPLUS_MODELARK" as const,
  modelId: "dreamina-seedance-2-0-260128" as const,
  generationMode: "TEXT_TO_VIDEO" as const,
  durationSeconds: 5,
  aspectRatio: "16:9" as const,
  resolution: "480p" as const,
  inputVideoIncluded: false as const,
  outputWidthPixels: 864,
  outputHeightPixels: 480,
  outputFrameRate: 24,
  currency: "USD" as const,
  usdPerMillionTokens: "7.0000",
  costBasis: "OFFICIAL_TOKEN_RATE_ESTIMATE" as const,
  sourceUrl: "https://docs.byteplus.com/docs/ModelArk/1099320" as const,
  version: "byteplus-2026-08-01.v1",
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  effectiveTo: null,
  createdBy: "10000000-0000-4000-8000-000000000002",
  createdAt: "2026-08-31T00:00:00.000Z",
}));

describe("certification commercial authority contract", () => {
  it("freezes truthful bounded STAGING certification semantics", () => {
    expect(CERTIFICATION_COMMERCIAL_REASON).toBe(
      "AI Story V1 STAGING real-provider certification"
    );
    expect(CERTIFICATION_MAX_PROVIDER_COST_USD).toBe("5.00");
    expect(CERTIFICATION_MAX_PROVIDER_SUBMISSIONS).toBe(4);
  });

  it("keeps Provider USD cost separate from product credits", () => {
    expect(rule.currency).toBe("USD");
    expect(rule.costBasis).toBe("OFFICIAL_TOKEN_RATE_ESTIMATE");
    expect(rule).not.toHaveProperty("creditAmount");
    expect(estimateProviderCostUsd(rule)).toBe("0.35");
  });

  it("fails closed for unsupported or unversioned price shapes", () => {
    expect(() => ProviderUsdPricingRuleSchema.parse({ ...rule, currency: "credit" })).toThrow();
    expect(() => ProviderUsdPricingRuleSchema.parse({ ...rule, inputVideoIncluded: true })).toThrow();
    expect(() => ProviderUsdPricingRuleSchema.parse({ ...rule, sourceUrl: "https://example.com" })).toThrow();
  });
});
