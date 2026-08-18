/**
 * Sprint 4 Phase B / B1 — Product Usage contracts.
 *
 * Explicitly separate from Provider Usage / Provider Cost
 * (see provider-reliability-contracts.ts).
 *
 * No persistence in B1.
 */
import { z } from "zod";
import { CapabilityKeySchema } from "./commercial-entitlements";

export const PRODUCT_USAGE_CONTRACT_VERSION = "1" as const;

const UuidSchema = z.string().uuid();
const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "Expected sha256:<64 hex>");
const IsoDatetimeSchema = z.string().datetime();

/**
 * Customer product usage event — commercial attribution authority.
 * Must not be confused with ProviderUsageSchema.
 */
export const ProductUsageEventSchema = z
  .object({
    contractVersion: z.literal(PRODUCT_USAGE_CONTRACT_VERSION),
    productUsageEventId: UuidSchema,
    orgId: UuidSchema,
    workspaceId: UuidSchema.nullable(),
    capabilityKey: CapabilityKeySchema,
    executionIdentity: NonEmptyTextSchema,
    pricingRuleKey: NonEmptyTextSchema.nullable(),
    pricingRuleVersion: NonEmptyTextSchema.nullable(),
    commercialAuthorizationId: UuidSchema.nullable(),
    quantity: z.number().positive(),
    occurredAt: IsoDatetimeSchema,
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type ProductUsageEvent = z.infer<typeof ProductUsageEventSchema>;

export const PRODUCT_USAGE_AUTHORITY = "PRODUCT_USAGE" as const;
export const PROVIDER_USAGE_AUTHORITY = "PROVIDER_USAGE" as const;

export function parseProductUsageEvent(value: unknown): ProductUsageEvent {
  return ProductUsageEventSchema.parse(value);
}
