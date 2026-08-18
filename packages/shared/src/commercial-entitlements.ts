/**
 * Sprint 4 Phase B / B1 — Entitlement contracts.
 *
 * CapabilityKey is NOT PlatformRole / OrgRole / WorkspaceRole.
 * Revocation targets one specific grant/source fact — never global capability wipe.
 */
import { z } from "zod";

export const COMMERCIAL_ENTITLEMENT_CONTRACT_VERSION = "1" as const;

const UuidSchema = z.string().uuid();
const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "Expected sha256:<64 hex>");
const IsoDatetimeSchema = z.string().datetime();

/** Frozen V1 capability vocabulary. */
export const CAPABILITY_KEYS = [
  "ai_story.access",
  "ai_story.execute",
  "video_generation.execute",
  "video_generation.export.720p",
  "video_generation.export.1080p",
  "video_generation.export.2k",
  "creative_studio.access",
  "creative_studio.execute",
  "usage.view",
  "billing.manage",
] as const;

export const CapabilityKeySchema = z.enum(CAPABILITY_KEYS);
export type CapabilityKey = z.infer<typeof CapabilityKeySchema>;

export const ENTITLEMENT_SOURCES = [
  "PLAN",
  "INTERNAL",
  "SUPPORT",
  "PROMOTIONAL",
] as const;

export const EntitlementSourceSchema = z.enum(ENTITLEMENT_SOURCES);
export type EntitlementSource = z.infer<typeof EntitlementSourceSchema>;

export const EntitlementGrantSchema = z
  .object({
    contractVersion: z.literal(COMMERCIAL_ENTITLEMENT_CONTRACT_VERSION),
    entitlementGrantId: UuidSchema,
    orgId: UuidSchema,
    workspaceId: UuidSchema.nullable(),
    capabilityKey: CapabilityKeySchema,
    source: EntitlementSourceSchema,
    /** Optional plan mapping / subscription projection reference when source=PLAN. */
    sourceReference: NonEmptyTextSchema.nullable(),
    reason: NonEmptyTextSchema,
    grantedByUserId: UuidSchema.nullable(),
    grantedAt: IsoDatetimeSchema,
    expiresAt: IsoDatetimeSchema.nullable(),
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type EntitlementGrant = z.infer<typeof EntitlementGrantSchema>;

/**
 * Revokes one specific grant identity. Does not imply global capability deletion.
 */
export const EntitlementRevocationSchema = z
  .object({
    contractVersion: z.literal(COMMERCIAL_ENTITLEMENT_CONTRACT_VERSION),
    entitlementRevocationId: UuidSchema,
    /** Exact grant being revoked — required. */
    entitlementGrantId: UuidSchema,
    orgId: UuidSchema,
    capabilityKey: CapabilityKeySchema,
    source: EntitlementSourceSchema,
    reason: NonEmptyTextSchema,
    revokedByUserId: UuidSchema,
    revokedAt: IsoDatetimeSchema,
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type EntitlementRevocation = z.infer<typeof EntitlementRevocationSchema>;

export const EffectiveEntitlementEntrySchema = z
  .object({
    capabilityKey: CapabilityKeySchema,
    source: EntitlementSourceSchema,
    entitlementGrantId: UuidSchema,
    grantedAt: IsoDatetimeSchema,
    expiresAt: IsoDatetimeSchema.nullable(),
  })
  .strict();

export type EffectiveEntitlementEntry = z.infer<
  typeof EffectiveEntitlementEntrySchema
>;

/**
 * Read-only effective entitlement projection. Not browser-editable authority.
 */
export const EffectiveEntitlementProjectionSchema = z
  .object({
    contractVersion: z.literal(COMMERCIAL_ENTITLEMENT_CONTRACT_VERSION),
    orgId: UuidSchema,
    workspaceId: UuidSchema.nullable(),
    entries: z.array(EffectiveEntitlementEntrySchema),
    projectedAt: IsoDatetimeSchema,
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type EffectiveEntitlementProjection = z.infer<
  typeof EffectiveEntitlementProjectionSchema
>;

export function parseEntitlementGrant(value: unknown): EntitlementGrant {
  return EntitlementGrantSchema.parse(value);
}

export function parseEntitlementRevocation(
  value: unknown
): EntitlementRevocation {
  return EntitlementRevocationSchema.parse(value);
}

export function parseEffectiveEntitlementProjection(
  value: unknown
): EffectiveEntitlementProjection {
  return EffectiveEntitlementProjectionSchema.parse(value);
}

export function effectiveProjectionHasCapability(
  projection: EffectiveEntitlementProjection,
  capability: CapabilityKey
): boolean {
  return projection.entries.some((entry) => entry.capabilityKey === capability);
}
