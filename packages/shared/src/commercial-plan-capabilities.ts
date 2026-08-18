/**
 * Sprint 4 Phase B / B1 — Versioned Plan Capability Mapping (server-owned).
 *
 * Deterministic, hashable, source-controlled. Not browser-editable.
 * Not database-editable in B1.
 *
 * Frozen AI Story product rule:
 * - AGENCY may include ai_story.access + ai_story.execute
 * - FREE must NOT automatically include them
 * - PRO must NOT automatically include them
 *
 * Plan keys align with legacy organizations.plan vocabulary for compatibility
 * naming — this mapping is NOT organizations.plan commercial authority.
 */
import {
  CAPABILITY_KEYS,
  type CapabilityKey,
} from "./commercial-entitlements";
import { sha256CanonicalIntegrityHash } from "./canonical-integrity";

export const PLAN_CAPABILITY_MAPPING_CONTRACT_VERSION = "1" as const;
export const PLAN_CAPABILITY_MAPPING_VERSION = "plan-capability-mapping.v2" as const;

/** Plan keys recognized by the frozen V1 mapping. */
export const PLAN_CAPABILITY_PLAN_KEYS = [
  "free",
  "pro",
  "pro_plus",
  "agency",
  "enterprise",
  "paid",
  "starter",
] as const;

export type PlanCapabilityPlanKey = (typeof PLAN_CAPABILITY_PLAN_KEYS)[number];

export type PlanCapabilityMapping = {
  readonly contractVersion: typeof PLAN_CAPABILITY_MAPPING_CONTRACT_VERSION;
  readonly mappingVersion: typeof PLAN_CAPABILITY_MAPPING_VERSION;
  readonly plans: Readonly<Record<PlanCapabilityPlanKey, readonly CapabilityKey[]>>;
  readonly mappingHash: string;
};

const AI_STORY_ACCESS = "ai_story.access" as const satisfies CapabilityKey;
const AI_STORY_EXECUTE = "ai_story.execute" as const satisfies CapabilityKey;
const CREATIVE_STUDIO_ACCESS =
  "creative_studio.access" as const satisfies CapabilityKey;
const CREATIVE_STUDIO_EXECUTE =
  "creative_studio.execute" as const satisfies CapabilityKey;
const VIDEO_STUDIO_EXECUTE =
  "video_generation.execute" as const satisfies CapabilityKey;
const VIDEO_STUDIO_EXPORT_720P =
  "video_generation.export.720p" as const satisfies CapabilityKey;
const VIDEO_STUDIO_EXPORT_1080P =
  "video_generation.export.1080p" as const satisfies CapabilityKey;
const VIDEO_STUDIO_EXPORT_2K =
  "video_generation.export.2k" as const satisfies CapabilityKey;

const VIDEO_STUDIO_PRO = Object.freeze([
  VIDEO_STUDIO_EXECUTE,
  VIDEO_STUDIO_EXPORT_720P,
  VIDEO_STUDIO_EXPORT_1080P,
] as CapabilityKey[]);

const VIDEO_STUDIO_FULL = Object.freeze([
  ...VIDEO_STUDIO_PRO,
  VIDEO_STUDIO_EXPORT_2K,
] as CapabilityKey[]);

/**
 * Frozen V1 plan → capability map.
 * Only encode approved decisions. Do not invent future capabilities.
 */
const PLAN_CAPABILITY_TABLE: Readonly<
  Record<PlanCapabilityPlanKey, readonly CapabilityKey[]>
> = Object.freeze({
  free: Object.freeze([] as CapabilityKey[]),
  pro: VIDEO_STUDIO_PRO,
  pro_plus: VIDEO_STUDIO_FULL,
  // Agency may include AI Story + Creative Studio access/execute.
  agency: Object.freeze([
    AI_STORY_ACCESS,
    AI_STORY_EXECUTE,
    CREATIVE_STUDIO_ACCESS,
    CREATIVE_STUDIO_EXECUTE,
    ...VIDEO_STUDIO_FULL,
  ] as CapabilityKey[]),
  // Legacy compatibility mappings retain historical Video Studio access only.
  // They do not acquire AI Story or Creative Studio capabilities.
  enterprise: VIDEO_STUDIO_FULL,
  paid: VIDEO_STUDIO_FULL,
  starter: VIDEO_STUDIO_FULL,
});

function buildMappingHash(
  plans: Readonly<Record<PlanCapabilityPlanKey, readonly CapabilityKey[]>>
): string {
  return sha256CanonicalIntegrityHash({
    contractVersion: PLAN_CAPABILITY_MAPPING_CONTRACT_VERSION,
    mappingVersion: PLAN_CAPABILITY_MAPPING_VERSION,
    plans,
  });
}

export const PLAN_CAPABILITY_MAPPING: PlanCapabilityMapping = Object.freeze({
  contractVersion: PLAN_CAPABILITY_MAPPING_CONTRACT_VERSION,
  mappingVersion: PLAN_CAPABILITY_MAPPING_VERSION,
  plans: PLAN_CAPABILITY_TABLE,
  mappingHash: buildMappingHash(PLAN_CAPABILITY_TABLE),
});

export function getPlanCapabilityMapping(): PlanCapabilityMapping {
  return PLAN_CAPABILITY_MAPPING;
}

export function listCapabilitiesForPlan(
  planKey: string
): readonly CapabilityKey[] {
  const key = planKey.trim().toLowerCase() as PlanCapabilityPlanKey;
  if (!(key in PLAN_CAPABILITY_TABLE)) {
    return Object.freeze([]);
  }
  return PLAN_CAPABILITY_TABLE[key];
}

export function planMappingIncludesCapability(
  planKey: string,
  capability: CapabilityKey
): boolean {
  return listCapabilitiesForPlan(planKey).includes(capability);
}

export function assertPlanCapabilityMappingIntegrity(
  mapping: PlanCapabilityMapping = PLAN_CAPABILITY_MAPPING
): void {
  const expected = buildMappingHash(mapping.plans);
  if (mapping.mappingHash !== expected) {
    throw new Error("PlanCapabilityMapping hash mismatch");
  }
  for (const capability of mapping.plans.agency) {
    if (!CAPABILITY_KEYS.includes(capability)) {
      throw new Error(`Unknown capability in agency mapping: ${capability}`);
    }
  }
  if (planMappingIncludesCapability("free", AI_STORY_ACCESS)) {
    throw new Error("FREE must not automatically include ai_story.access");
  }
  if (planMappingIncludesCapability("free", AI_STORY_EXECUTE)) {
    throw new Error("FREE must not automatically include ai_story.execute");
  }
  if (planMappingIncludesCapability("pro", AI_STORY_ACCESS)) {
    throw new Error("PRO must not automatically include ai_story.access");
  }
  if (planMappingIncludesCapability("pro", AI_STORY_EXECUTE)) {
    throw new Error("PRO must not automatically include ai_story.execute");
  }
  if (!planMappingIncludesCapability("agency", AI_STORY_ACCESS)) {
    throw new Error("AGENCY must include ai_story.access");
  }
  if (!planMappingIncludesCapability("agency", AI_STORY_EXECUTE)) {
    throw new Error("AGENCY must include ai_story.execute");
  }
}
