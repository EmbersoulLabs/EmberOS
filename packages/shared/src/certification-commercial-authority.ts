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
export const PRODUCTION_SETTLEMENT_RECOVERY_MAX_PROVIDER_SUBMISSIONS = 1 as const;

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
