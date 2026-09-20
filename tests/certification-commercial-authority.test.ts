import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CERTIFICATION_COMMERCIAL_REASON,
  CERTIFICATION_MAX_PROVIDER_COST_USD,
  CERTIFICATION_MAX_PROVIDER_SUBMISSIONS,
  CERTIFICATION_COMMERCIAL_EVENT_CEILING_AMENDED,
  CERTIFIED_BYTEPLUS_SEEDANCE_20_MODEL_ID,
  CERTIFIED_BYTEPLUS_SEEDANCE_20_NO_VIDEO_INPUT_480P_USD_PER_MILLION,
  CERTIFIED_BYTEPLUS_SEEDANCE_20_OFFICIAL_SOURCE_URL,
  CERTIFIED_BYTEPLUS_SEEDANCE_20_PRICING_VERSION,
  CertifiedSeedancePricingAuthorityError,
  PRODUCTION_SETTLEMENT_CEILING_AMENDMENT_REASON,
  PRODUCTION_SETTLEMENT_RECOVERY_MAX_PROVIDER_SUBMISSIONS,
  ProviderUsdPricingRuleSchema,
  assertCertifiedSeedance20NoVideoInputRateAppliesToFirstFrameI2v,
  certifiedSeedanceFirstFrameI2vSiblingFields,
  estimateProviderCostUsd,
  settleProviderCostUsdFromCompletionTokens,
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

  it("freezes the Production settlement ceiling amendment contract", () => {
    expect(PRODUCTION_SETTLEMENT_CEILING_AMENDMENT_REASON).toBe(
      "Human-authorized Production settlement ceiling amendment"
    );
    expect(CERTIFICATION_COMMERCIAL_EVENT_CEILING_AMENDED).toBe("CEILING_AMENDED");
    expect(PRODUCTION_SETTLEMENT_RECOVERY_MAX_PROVIDER_SUBMISSIONS).toBe(1);
  });

  it("keeps Production cost-ceiling amendment independent of submission quota size", () => {
    const source = readFileSync(
      resolve(process.cwd(), "packages/db/src/queries/certification-commercial-authority.ts"),
      "utf8"
    );
    expect(source).toContain("amendActiveProductionScopeCeiling");
    expect(source).not.toContain("maxProviderSubmissions above 2");
    expect(source).not.toContain("maxProviderSubmissions above 1");
    expect(source).not.toMatch(
      /amendActiveProductionScopeCeiling[\s\S]*PRODUCTION_SETTLEMENT_RECOVERY_MAX_PROVIDER_SUBMISSIONS/
    );
  });

  it("keeps Provider USD cost separate from product credits", () => {
    expect(rule.currency).toBe("USD");
    expect(rule.costBasis).toBe("OFFICIAL_TOKEN_RATE_ESTIMATE");
    expect(rule).not.toHaveProperty("creditAmount");
    expect(estimateProviderCostUsd(rule)).toBe("0.35");
  });

  it("settles Provider USD from completion tokens at cent precision", () => {
    expect(settleProviderCostUsdFromCompletionTokens(40_000, "7.0000")).toBe("0.28");
    expect(settleProviderCostUsdFromCompletionTokens(38_571, "7.0000")).toBe("0.27");
  });

  it("fails closed for unsupported or unversioned price shapes", () => {
    expect(() => ProviderUsdPricingRuleSchema.parse({ ...rule, currency: "credit" })).toThrow();
    expect(() => ProviderUsdPricingRuleSchema.parse({ ...rule, inputVideoIncluded: true })).toThrow();
    expect(() => ProviderUsdPricingRuleSchema.parse({ ...rule, sourceUrl: "https://example.com" })).toThrow();
  });
});

const officialT2v = ProviderUsdPricingRuleSchema.parse(withIntegrity({
  contractVersion: "1" as const,
  providerUsdPricingRuleId: "06638afd-e222-5bab-ae84-2412214a17a7",
  providerKey: "BYTEPLUS_MODELARK" as const,
  modelId: CERTIFIED_BYTEPLUS_SEEDANCE_20_MODEL_ID,
  generationMode: "TEXT_TO_VIDEO" as const,
  durationSeconds: 4,
  aspectRatio: "9:16" as const,
  resolution: "480p" as const,
  inputVideoIncluded: false as const,
  outputWidthPixels: 480,
  outputHeightPixels: 854,
  outputFrameRate: 24,
  currency: "USD" as const,
  usdPerMillionTokens: CERTIFIED_BYTEPLUS_SEEDANCE_20_NO_VIDEO_INPUT_480P_USD_PER_MILLION,
  costBasis: "OFFICIAL_TOKEN_RATE_ESTIMATE" as const,
  sourceUrl: CERTIFIED_BYTEPLUS_SEEDANCE_20_OFFICIAL_SOURCE_URL,
  version: CERTIFIED_BYTEPLUS_SEEDANCE_20_PRICING_VERSION,
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  effectiveTo: null,
  createdBy: "59f4e673-2bbe-4165-9106-25a984527bb8",
  createdAt: "2026-09-19T08:05:46.409Z",
}));

describe("certified Seedance first-frame I2V sibling pricing authority", () => {
  it("proves the persisted official 480p no-video-input rate applies to first-frame I2V", () => {
    expect(() => assertCertifiedSeedance20NoVideoInputRateAppliesToFirstFrameI2v(officialT2v)).not.toThrow();
    const sibling = certifiedSeedanceFirstFrameI2vSiblingFields(officialT2v);
    expect(sibling.generationMode).toBe("FIRST_FRAME_IMAGE_TO_VIDEO");
    expect(sibling.usdPerMillionTokens).toBe(officialT2v.usdPerMillionTokens);
    expect(sibling.version).toBe(CERTIFIED_BYTEPLUS_SEEDANCE_20_PRICING_VERSION);
    expect(sibling.sourceUrl).toBe(CERTIFIED_BYTEPLUS_SEEDANCE_20_OFFICIAL_SOURCE_URL);
    expect(estimateProviderCostUsd({
      ...sibling,
      providerUsdPricingRuleId: "00000000-0000-4000-8000-000000000099",
      integrityHash: officialT2v.integrityHash,
    })).toBe("0.27");
  });

  it("refuses to clone a rate from a non-official or unrelated Seedance spec", () => {
    expect(() => assertCertifiedSeedance20NoVideoInputRateAppliesToFirstFrameI2v(rule)).toThrow(
      CertifiedSeedancePricingAuthorityError
    );
    expect(() => assertCertifiedSeedance20NoVideoInputRateAppliesToFirstFrameI2v({
      ...officialT2v,
      modelId: "dreamina-seedance-2-0-fast-260128" as typeof officialT2v.modelId,
    })).toThrow(CertifiedSeedancePricingAuthorityError);
    expect(() => assertCertifiedSeedance20NoVideoInputRateAppliesToFirstFrameI2v({
      ...officialT2v,
      usdPerMillionTokens: "5.6000",
    })).toThrow(CertifiedSeedancePricingAuthorityError);
    expect(() => assertCertifiedSeedance20NoVideoInputRateAppliesToFirstFrameI2v({
      ...officialT2v,
      version: "unofficial-test.v1",
    })).toThrow(CertifiedSeedancePricingAuthorityError);
  });
});
