/**
 * Sprint 4 Phase B / B1 — Commercial Execution Authorization contract.
 *
 * Evidence that future billable scheduling passed commercial gates.
 * Do NOT wire into Execute in B1 — Phase E owns runtime integration.
 */
import { z } from "zod";
import { CapabilityKeySchema } from "./commercial-entitlements";

export const COMMERCIAL_EXECUTION_AUTHORIZATION_CONTRACT_VERSION = "1" as const;

const UuidSchema = z.string().uuid();
const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "Expected sha256:<64 hex>");
const IsoDatetimeSchema = z.string().datetime();

export const CommercialExecutionAuthorizationSchema = z
  .object({
    contractVersion: z.literal(
      COMMERCIAL_EXECUTION_AUTHORIZATION_CONTRACT_VERSION
    ),
    commercialAuthorizationId: UuidSchema,
    orgId: UuidSchema,
    workspaceId: UuidSchema,
    capabilityKey: CapabilityKeySchema,
    executionIdentity: NonEmptyTextSchema,
    /** Effective entitlement evidence reference (grant id or projection digest). */
    entitlementEvidenceId: NonEmptyTextSchema,
    pricingRuleKey: NonEmptyTextSchema,
    pricingRuleVersion: NonEmptyTextSchema,
    pricingRuleIntegrityHash: IntegrityHashSchema,
    /** Present when credit reservation is required for the capability. */
    creditReservationId: UuidSchema.nullable(),
    authorizedAt: IsoDatetimeSchema,
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type CommercialExecutionAuthorization = z.infer<
  typeof CommercialExecutionAuthorizationSchema
>;

export function parseCommercialExecutionAuthorization(
  value: unknown
): CommercialExecutionAuthorization {
  return CommercialExecutionAuthorizationSchema.parse(value);
}
