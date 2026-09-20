import { z } from "zod";
import { sha256CanonicalIntegrityHash } from "./canonical-integrity";
import { CertificationEnvironmentSchema } from "./certification-environment";
export { CertificationEnvironmentSchema } from "./certification-environment";
export type { CertificationEnvironment } from "./certification-environment";

export const CERTIFICATION_COMMERCIAL_CONTRACT_VERSION = "1" as const;
export const CERTIFICATION_COMMERCIAL_REASON =
  "AI Story V1 STAGING real-provider certification" as const;
export const CERTIFICATION_MAX_PROVIDER_COST_USD = "5.00" as const;
export const CERTIFICATION_MAX_PROVIDER_SUBMISSIONS = 4 as const;
export const PRODUCTION_SETTLEMENT_CEILING_AMENDMENT_REASON =
  "Human-authorized Production settlement ceiling amendment" as const;
export const CERTIFICATION_COMMERCIAL_EVENT_CEILING_AMENDED = "CEILING_AMENDED" as const;
export const CERTIFICATION_COMMERCIAL_EVENT_SUBMISSION_QUOTA_AMENDED = "SUBMISSION_QUOTA_AMENDED" as const;
export const PRODUCTION_SETTLEMENT_RECOVERY_MAX_PROVIDER_SUBMISSIONS = 1 as const;
/**
 * Official ModelArk token rate for dreamina-seedance-2-0-260128 at 480p
 * without video input. BytePlus prices this model/spec by resolution and
 * video-input inclusion, not by TEXT_TO_VIDEO vs first-frame I2V.
 */
export const CERTIFIED_BYTEPLUS_SEEDANCE_20_OFFICIAL_SOURCE_URL =
  "https://docs.byteplus.com/docs/ModelArk/1099320" as const;
export const CERTIFIED_BYTEPLUS_SEEDANCE_20_PRICING_VERSION =
  "byteplus-2026-08-01.v1" as const;
export const CERTIFIED_BYTEPLUS_SEEDANCE_20_MODEL_ID =
  "dreamina-seedance-2-0-260128" as const;
export const CERTIFIED_BYTEPLUS_SEEDANCE_20_NO_VIDEO_INPUT_480P_USD_PER_MILLION =
  "7.0000" as const;
export const CERTIFIED_BYTEPLUS_SEEDANCE_20_NO_VIDEO_INPUT_APPLICABLE_MODES = [
  "TEXT_TO_VIDEO",
  "FIRST_FRAME_IMAGE_TO_VIDEO",
] as const;
export const PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON =
  "Human-authorized Production additional Provider submission" as const;

const uuid = z.string().uuid();
const instant = z.string().datetime();
const money = z.string().regex(/^\d+\.\d{2}$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const CertificationCommercialScopeSchema = z.object({
  contractVersion: z.literal(CERTIFICATION_COMMERCIAL_CONTRACT_VERSION),
  certificationScopeId: uuid,
  environment: CertificationEnvironmentSchema,
  orgId: uuid,
  workspaceId: uuid,
  capabilityKey: z.literal("ai_story.execute"),
  status: z.enum(["ACTIVE", "CLOSED", "REVOKED"]),
  maxProviderCostUsd: money,
  maxProviderSubmissions: z.number().int().positive(),
  spentProviderCostUsd: money,
  reservedProviderCostUsd: money,
  consumedProviderSubmissions: z.number().int().nonnegative(),
  reservedProviderSubmissions: z.number().int().nonnegative(),
  createdBy: uuid,
  reason: z.string().min(1),
  createdAt: instant,
  closedAt: instant.nullable(),
  revokedAt: instant.nullable(),
  integrityHash: hash,
}).strict();
export type CertificationCommercialScope = z.infer<typeof CertificationCommercialScopeSchema>;

export const ProviderUsdPricingRuleSchema = z.object({
  contractVersion: z.literal(CERTIFICATION_COMMERCIAL_CONTRACT_VERSION),
  providerUsdPricingRuleId: uuid,
  providerKey: z.literal("BYTEPLUS_MODELARK"),
  modelId: z.literal("dreamina-seedance-2-0-260128"),
  generationMode: z.enum(["TEXT_TO_VIDEO", "FIRST_FRAME_IMAGE_TO_VIDEO"]),
  durationSeconds: z.number().int().positive(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
  resolution: z.enum(["480p", "720p", "1080p"]),
  inputVideoIncluded: z.literal(false),
  outputWidthPixels: z.number().int().positive(),
  outputHeightPixels: z.number().int().positive(),
  outputFrameRate: z.number().int().positive(),
  currency: z.literal("USD"),
  usdPerMillionTokens: z.string().regex(/^\d+\.\d{4}$/),
  costBasis: z.literal("OFFICIAL_TOKEN_RATE_ESTIMATE"),
  sourceUrl: z.literal("https://docs.byteplus.com/docs/ModelArk/1099320"),
  version: z.string().min(1),
  effectiveFrom: instant,
  effectiveTo: instant.nullable(),
  createdBy: uuid,
  createdAt: instant,
  integrityHash: hash,
}).strict();
export type ProviderUsdPricingRule = z.infer<typeof ProviderUsdPricingRuleSchema>;

export function estimateProviderCostUsd(rule: ProviderUsdPricingRule): string {
  const estimatedTokens =
    (rule.durationSeconds * rule.outputWidthPixels * rule.outputHeightPixels *
      rule.outputFrameRate) /
    1024;
  const estimatedUsd =
    (estimatedTokens * Number(rule.usdPerMillionTokens)) / 1_000_000;
  return (Math.ceil(estimatedUsd * 100) / 100).toFixed(2);
}

export function settleProviderCostUsdFromCompletionTokens(
  completionTokens: number,
  usdPerMillionTokens: string
): string {
  const rateTimes1e4 = Math.round(Number(usdPerMillionTokens) * 10_000);
  return (Math.ceil((completionTokens * rateTimes1e4) / 100_000_000) / 100).toFixed(2);
}

export const CertificationCommercialReservationSchema = z.object({
  contractVersion: z.literal(CERTIFICATION_COMMERCIAL_CONTRACT_VERSION),
  certificationReservationId: uuid,
  certificationScopeId: uuid,
  providerUsdPricingRuleId: uuid,
  orgId: uuid,
  workspaceId: uuid,
  executionIdentity: z.string().min(1),
  reservedCostUsd: money,
  settledCostUsd: money.nullable(),
  status: z.enum(["RESERVED", "SUBMITTED", "SETTLED", "RELEASED"]),
  createdAt: instant,
  submittedAt: instant.nullable(),
  settledAt: instant.nullable(),
  releasedAt: instant.nullable(),
  integrityHash: hash,
}).strict();
export type CertificationCommercialReservation = z.infer<typeof CertificationCommercialReservationSchema>;

export function withIntegrity<T extends Record<string, unknown>>(value: T): T & { integrityHash: string } {
  return { ...value, integrityHash: sha256CanonicalIntegrityHash(value) };
}

export class CertifiedSeedancePricingAuthorityError extends Error {
  readonly code = "PROVIDER_USD_PRICE_DIVERGENT" as const;

  constructor(message: string) {
    super(message);
    this.name = "CertifiedSeedancePricingAuthorityError";
  }
}

export function certifiedSeedanceFirstFrameI2vSiblingIdentity(
  source: ProviderUsdPricingRule
): {
  providerKey: ProviderUsdPricingRule["providerKey"];
  modelId: ProviderUsdPricingRule["modelId"];
  generationMode: "FIRST_FRAME_IMAGE_TO_VIDEO";
  durationSeconds: number;
  aspectRatio: ProviderUsdPricingRule["aspectRatio"];
  resolution: ProviderUsdPricingRule["resolution"];
  version: string;
} {
  assertCertifiedSeedance20NoVideoInputRateAppliesToFirstFrameI2v(source);
  return {
    providerKey: source.providerKey,
    modelId: source.modelId,
    generationMode: "FIRST_FRAME_IMAGE_TO_VIDEO",
    durationSeconds: source.durationSeconds,
    aspectRatio: source.aspectRatio,
    resolution: source.resolution,
    version: source.version,
  };
}

export function assertCertifiedSeedance20NoVideoInputRateAppliesToFirstFrameI2v(
  source: ProviderUsdPricingRule
): void {
  if (source.providerKey !== "BYTEPLUS_MODELARK") {
    throw new CertifiedSeedancePricingAuthorityError(
      "I2V sibling requires BYTEPLUS_MODELARK Provider authority"
    );
  }
  if (source.modelId !== CERTIFIED_BYTEPLUS_SEEDANCE_20_MODEL_ID) {
    throw new CertifiedSeedancePricingAuthorityError(
      "I2V sibling requires the exact certified Seedance 2.0 model, not a Fast or Mini substitute"
    );
  }
  if (source.generationMode !== "TEXT_TO_VIDEO") {
    throw new CertifiedSeedancePricingAuthorityError(
      "I2V sibling must be derived from the matching TEXT_TO_VIDEO official price"
    );
  }
  if (source.sourceUrl !== CERTIFIED_BYTEPLUS_SEEDANCE_20_OFFICIAL_SOURCE_URL) {
    throw new CertifiedSeedancePricingAuthorityError(
      "I2V sibling requires the persisted official ModelArk pricing source"
    );
  }
  if (source.version !== CERTIFIED_BYTEPLUS_SEEDANCE_20_PRICING_VERSION) {
    throw new CertifiedSeedancePricingAuthorityError(
      "I2V sibling requires the persisted official Seedance pricing version"
    );
  }
  if (source.costBasis !== "OFFICIAL_TOKEN_RATE_ESTIMATE") {
    throw new CertifiedSeedancePricingAuthorityError(
      "I2V sibling requires official token-rate cost basis"
    );
  }
  if (source.inputVideoIncluded !== false) {
    throw new CertifiedSeedancePricingAuthorityError(
      "First-frame I2V is not video-input; the source T2V rule must be the no-video-input rate"
    );
  }
  if (source.resolution !== "480p") {
    throw new CertifiedSeedancePricingAuthorityError(
      "This certified I2V sibling is defined only for the persisted 480p official rate"
    );
  }
  if (source.usdPerMillionTokens !== CERTIFIED_BYTEPLUS_SEEDANCE_20_NO_VIDEO_INPUT_480P_USD_PER_MILLION) {
    throw new CertifiedSeedancePricingAuthorityError(
      "Persisted T2V official 480p no-video-input rate does not match the certified Seedance 2.0 token rate"
    );
  }
  if (
    source.durationSeconds !== 4 ||
    source.aspectRatio !== "9:16" ||
    source.outputWidthPixels !== 480 ||
    source.outputHeightPixels !== 854 ||
    source.outputFrameRate !== 24
  ) {
    throw new CertifiedSeedancePricingAuthorityError(
      "I2V sibling requires the exact persisted 4s 9:16 480x854@24fps T2V spec"
    );
  }
  if (
    !CERTIFIED_BYTEPLUS_SEEDANCE_20_NO_VIDEO_INPUT_APPLICABLE_MODES.includes("FIRST_FRAME_IMAGE_TO_VIDEO")
  ) {
    throw new CertifiedSeedancePricingAuthorityError(
      "Official no-video-input rate does not apply to FIRST_FRAME_IMAGE_TO_VIDEO"
    );
  }
}

export function certifiedSeedanceFirstFrameI2vSiblingFields(
  source: ProviderUsdPricingRule
): Omit<ProviderUsdPricingRule, "providerUsdPricingRuleId" | "integrityHash"> {
  assertCertifiedSeedance20NoVideoInputRateAppliesToFirstFrameI2v(source);
  return {
    contractVersion: source.contractVersion,
    providerKey: source.providerKey,
    modelId: source.modelId,
    generationMode: "FIRST_FRAME_IMAGE_TO_VIDEO",
    durationSeconds: source.durationSeconds,
    aspectRatio: source.aspectRatio,
    resolution: source.resolution,
    inputVideoIncluded: source.inputVideoIncluded,
    outputWidthPixels: source.outputWidthPixels,
    outputHeightPixels: source.outputHeightPixels,
    outputFrameRate: source.outputFrameRate,
    currency: source.currency,
    usdPerMillionTokens: source.usdPerMillionTokens,
    costBasis: source.costBasis,
    sourceUrl: source.sourceUrl,
    version: source.version,
    effectiveFrom: source.effectiveFrom,
    effectiveTo: source.effectiveTo,
    createdBy: source.createdBy,
    createdAt: source.createdAt,
  };
}
