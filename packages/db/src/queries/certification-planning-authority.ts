import { and, eq } from "drizzle-orm";
import { CertificationEnvironmentSchema, sha256CanonicalIntegrityHash, type CertificationEnvironment } from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import { deterministicPersistenceUuid } from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;
export const CERTIFICATION_PLANNING_CONTRACT_VERSION = "ai-story-certification-planning.v1" as const;
export const CERTIFICATION_PLANNING_MODEL = "gpt-4o-mini-2024-07-18" as const;
/** Official gpt-4o-mini context window, used as an upper bound, not an estimate. */
export const CERTIFICATION_PLANNING_INPUT_TOKEN_CEILING = 128_000;
export const CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS = {
  story_polish: 4096,
  creative_context: 3072,
  director_thinking: 3072,
  story_beats: 4096,
  scene_plan: 6144,
  shot_plan: 6144,
  character_continuity: 3072,
  world_continuity: 3072,
  script_semantic_writer: 6144,
} as const;
export type CertificationPlanningStage = keyof typeof CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS;

export class CertificationPlanningAuthorityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CertificationPlanningAuthorityError";
  }
}

function cents(value: string | number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new CertificationPlanningAuthorityError("PLANNING_COST_INVALID", "Invalid planning USD amount");
  return Math.round(number * 100);
}
function usd(value: number): string { return (value / 100).toFixed(2); }

/** Ceiling pricing in cents per million tokens: input 15, output 60. */
export function maximumCertificationPlanningCostCents(maxOutputTokens: number): number {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 16_384) {
    throw new CertificationPlanningAuthorityError("PLANNING_OUTPUT_LIMIT_INVALID", "Finite output-token limit is required");
  }
  return Math.ceil((CERTIFICATION_PLANNING_INPUT_TOKEN_CEILING * 15 + maxOutputTokens * 60) / 1_000_000);
}
export function actualCertificationPlanningCostCents(inputTokens: number, outputTokens: number): number {
  if (!Number.isInteger(inputTokens) || !Number.isInteger(outputTokens) || inputTokens < 0 || outputTokens < 0 || inputTokens > CERTIFICATION_PLANNING_INPUT_TOKEN_CEILING || outputTokens > 16_384) {
    throw new CertificationPlanningAuthorityError("PLANNING_USAGE_INVALID", "Provider usage exceeds certified model bounds");
  }
  return Math.ceil((inputTokens * 15 + outputTokens * 60) / 1_000_000);
}

export type CertificationPlanningIdentity = {
  environment: CertificationEnvironment;
  certificationRunId: string;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  actorUserId: string;
};

export class CertificationPlanningAuthorityService {
  constructor(private readonly db: Db = getDb()) {}

  /** Story polish retains the existing Provider ledger as usage evidence. */
  async assertStoryPolishLedgerAlignment(providerAttemptId: string) {
    const [claim] = await this.db.select().from(schema.certificationPlanningClaims).where(eq(schema.certificationPlanningClaims.providerAttemptId, providerAttemptId)).limit(1);
    if (!claim) throw new CertificationPlanningAuthorityError("PLANNING_LEDGER_BINDING_MISSING", "Story polish claim is missing");
    const [usage] = await this.db.select().from(schema.providerAttemptUsage).where(eq(schema.providerAttemptUsage.attemptId, providerAttemptId)).limit(1);
    const [cost] = await this.db.select().from(schema.providerAttemptCosts).where(eq(schema.providerAttemptCosts.attemptId, providerAttemptId)).limit(1);
    if (claim.status === "FAILED" && !usage && !cost) return;
    if (claim.status !== "SETTLED" || !usage || !cost ||
      usage.usage.inputTokens !== claim.actualInputTokens ||
      usage.usage.outputTokens !== claim.actualOutputTokens ||
      Number(cost.cost.amount) > Number(claim.actualCostUsd)) {
      throw new CertificationPlanningAuthorityError("PLANNING_LEDGER_MISMATCH", "Story polish Provider ledger differs from planning claim");
    }
  }

  /** Administrative operation; no production scope or budget is provisioned automatically. */
  async provision(input: Omit<CertificationPlanningIdentity, "storyId" | "actorUserId"> & {
    storyId?: string | null;
    authorizedBy: string;
    authorizationReason: string;
    authorizedAt: string;
    maxPlanningCostUsd: string;
    maxLogicalCalls: number;
    maxTransportAttempts: number;
    model: typeof CERTIFICATION_PLANNING_MODEL;
  }) {
    CertificationEnvironmentSchema.parse(input.environment);
    if (input.model !== CERTIFICATION_PLANNING_MODEL || !Number.isInteger(input.maxLogicalCalls) || input.maxLogicalCalls < 1 || input.maxTransportAttempts !== 1 || !input.authorizationReason.trim() || cents(input.maxPlanningCostUsd) < 1) {
      throw new CertificationPlanningAuthorityError("PLANNING_AUTHORIZATION_INVALID", "Finite planning authorization is required");
    }
    return this.db.transaction(async (tx) => {
      const [campaign] = await tx.select({ id: schema.campaigns.id }).from(schema.campaigns).where(and(
        eq(schema.campaigns.id, input.campaignId), eq(schema.campaigns.orgId, input.orgId), eq(schema.campaigns.workspaceId, input.workspaceId),
      )).limit(1);
      if (!campaign) throw new CertificationPlanningAuthorityError("PLANNING_SCOPE_INVALID", "Campaign scope mismatch");
      if (input.storyId) {
        const [story] = await tx.select({ id: schema.aiStories.id }).from(schema.aiStories).where(and(eq(schema.aiStories.id, input.storyId), eq(schema.aiStories.campaignId, input.campaignId))).limit(1);
        if (!story) throw new CertificationPlanningAuthorityError("PLANNING_SCOPE_INVALID", "Story scope mismatch");
      }
      const immutable = {
        contractVersion: CERTIFICATION_PLANNING_CONTRACT_VERSION,
        environment: input.environment, certificationRunId: input.certificationRunId,
        orgId: input.orgId, workspaceId: input.workspaceId, campaignId: input.campaignId,
        storyId: input.storyId ?? null, model: input.model,
        maxPlanningCostUsd: input.maxPlanningCostUsd, maxLogicalCalls: input.maxLogicalCalls,
        maxTransportAttempts: input.maxTransportAttempts, authorizedBy: input.authorizedBy,
        authorizationReason: input.authorizationReason, authorizedAt: input.authorizedAt,
      };
      const integrityHash = sha256CanonicalIntegrityHash(immutable);
      const planningAuthorityId = deterministicPersistenceUuid("certification-planning-authority", { environment: input.environment, run: input.certificationRunId });
      const [existing] = await tx.select().from(schema.certificationPlanningAuthorities).where(eq(schema.certificationPlanningAuthorities.planningAuthorityId, planningAuthorityId)).limit(1).for("update");
      if (existing) {
        if (existing.integrityHash !== integrityHash) throw new CertificationPlanningAuthorityError("PLANNING_AUTHORIZATION_CONFLICT", "Conflicting planning authorization replay");
        return { authority: existing, replayed: true };
      }
      const [authority] = await tx.insert(schema.certificationPlanningAuthorities).values({
        planningAuthorityId, ...immutable, authorizedAt: new Date(input.authorizedAt),
        spentPlanningCostUsd: "0.00", reservedPlanningCostUsd: "0.00",
        consumedLogicalCalls: 0, reservedLogicalCalls: 0, status: "ACTIVE", integrityHash,
      }).returning();
      if (!authority) throw new CertificationPlanningAuthorityError("PLANNING_AUTHORIZATION_INVALID", "Planning authority not persisted");
      return { authority, replayed: false };
    });
  }

  async claim(input: CertificationPlanningIdentity & {
    logicalCallIdentity: string;
    stage: CertificationPlanningStage;
    model: typeof CERTIFICATION_PLANNING_MODEL;
    maxOutputTokens: number;
    maxRetries: number;
    providerAttemptId?: string | null;
    claimedAt: string;
  }) {
    CertificationEnvironmentSchema.parse(input.environment);
    const requiredLimit = CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS[input.stage];
    if (!requiredLimit || input.maxOutputTokens !== requiredLimit || input.model !== CERTIFICATION_PLANNING_MODEL || input.maxRetries !== 0 || !input.logicalCallIdentity.trim()) {
      throw new CertificationPlanningAuthorityError("PLANNING_CALL_CONTRACT_INVALID", "Stage, model, output limit or retry policy is not authorized");
    }
    const projectedCents = maximumCertificationPlanningCostCents(input.maxOutputTokens);
    return this.db.transaction(async (tx) => {
      const [authority] = await tx.select().from(schema.certificationPlanningAuthorities).where(and(
        eq(schema.certificationPlanningAuthorities.environment, input.environment),
        eq(schema.certificationPlanningAuthorities.certificationRunId, input.certificationRunId),
      )).limit(1).for("update");
      if (!authority || authority.status !== "ACTIVE") throw new CertificationPlanningAuthorityError("PLANNING_AUTHORITY_MISSING", "Active certification planning authority required");
      if (authority.orgId !== input.orgId || authority.workspaceId !== input.workspaceId || authority.campaignId !== input.campaignId || authority.storyId !== input.storyId || authority.authorizedBy !== input.actorUserId || authority.model !== input.model || authority.maxTransportAttempts !== 1) {
        throw new CertificationPlanningAuthorityError("PLANNING_SCOPE_INVALID", "Certification planning authority does not match call scope");
      }
      const [existing] = await tx.select().from(schema.certificationPlanningClaims).where(and(
        eq(schema.certificationPlanningClaims.planningAuthorityId, authority.planningAuthorityId),
        eq(schema.certificationPlanningClaims.logicalCallIdentity, input.logicalCallIdentity),
      )).limit(1);
      if (existing) throw new CertificationPlanningAuthorityError("PLANNING_LOGICAL_CALL_ALREADY_CLAIMED", "Logical call already claimed; regeneration requires new authorization identity");
      if (authority.consumedLogicalCalls + authority.reservedLogicalCalls >= authority.maxLogicalCalls) {
        throw new CertificationPlanningAuthorityError("PLANNING_CALL_LIMIT_EXHAUSTED", "Planning logical-call allowance exhausted");
      }
      if (cents(authority.spentPlanningCostUsd) + cents(authority.reservedPlanningCostUsd) + projectedCents > cents(authority.maxPlanningCostUsd)) {
        throw new CertificationPlanningAuthorityError("PLANNING_BUDGET_EXCEEDED", "Projected planning cost exceeds remaining authority");
      }
      const planningClaimId = deterministicPersistenceUuid("certification-planning-claim", { authority: authority.planningAuthorityId, logicalCallIdentity: input.logicalCallIdentity });
      const immutable = { contractVersion: CERTIFICATION_PLANNING_CONTRACT_VERSION, planningClaimId, planningAuthorityId: authority.planningAuthorityId, logicalCallIdentity: input.logicalCallIdentity, requestedBy: input.actorUserId, providerAttemptId: input.providerAttemptId ?? null, stage: input.stage, model: input.model, maxOutputTokens: input.maxOutputTokens, projectedInputTokens: CERTIFICATION_PLANNING_INPUT_TOKEN_CEILING, reservedMaximumUsd: usd(projectedCents), createdAt: input.claimedAt };
      const [claim] = await tx.insert(schema.certificationPlanningClaims).values({
        ...immutable, createdAt: new Date(input.claimedAt), status: "RESERVED", integrityHash: sha256CanonicalIntegrityHash(immutable),
      }).returning();
      await tx.update(schema.certificationPlanningAuthorities).set({
        reservedPlanningCostUsd: usd(cents(authority.reservedPlanningCostUsd) + projectedCents),
        reservedLogicalCalls: authority.reservedLogicalCalls + 1,
      }).where(eq(schema.certificationPlanningAuthorities.planningAuthorityId, authority.planningAuthorityId));
      if (!claim) throw new CertificationPlanningAuthorityError("PLANNING_CLAIM_INVALID", "Planning call claim not persisted");
      return claim;
    });
  }

  async settle(input: { planningClaimId: string; inputTokens: number; outputTokens: number; providerRequestId?: string | null; completedAt: string }) {
    const actualCents = actualCertificationPlanningCostCents(input.inputTokens, input.outputTokens);
    return this.db.transaction(async (tx) => {
      const [binding] = await tx.select({ planningAuthorityId: schema.certificationPlanningClaims.planningAuthorityId }).from(schema.certificationPlanningClaims).where(eq(schema.certificationPlanningClaims.planningClaimId, input.planningClaimId)).limit(1);
      if (!binding) throw new CertificationPlanningAuthorityError("PLANNING_CLAIM_INVALID", "Planning claim missing");
      const [authority] = await tx.select().from(schema.certificationPlanningAuthorities).where(eq(schema.certificationPlanningAuthorities.planningAuthorityId, binding.planningAuthorityId)).limit(1).for("update");
      if (!authority) throw new CertificationPlanningAuthorityError("PLANNING_AUTHORITY_MISSING", "Planning authority missing");
      const [claim] = await tx.select().from(schema.certificationPlanningClaims).where(eq(schema.certificationPlanningClaims.planningClaimId, input.planningClaimId)).limit(1).for("update");
      if (!claim || claim.status !== "RESERVED") throw new CertificationPlanningAuthorityError("PLANNING_CLAIM_INVALID", "Only a reserved claim can settle");
      const reservedCents = cents(claim.reservedMaximumUsd);
      if (actualCents > reservedCents || input.outputTokens > claim.maxOutputTokens || input.inputTokens > claim.projectedInputTokens) throw new CertificationPlanningAuthorityError("PLANNING_USAGE_EXCEEDS_RESERVATION", "Provider usage exceeds pre-call authority");
      await tx.update(schema.certificationPlanningClaims).set({ status: "SETTLED", actualInputTokens: input.inputTokens, actualOutputTokens: input.outputTokens, actualCostUsd: usd(actualCents), providerRequestId: input.providerRequestId ?? null, completedAt: new Date(input.completedAt) }).where(eq(schema.certificationPlanningClaims.planningClaimId, claim.planningClaimId));
      await tx.update(schema.certificationPlanningAuthorities).set({
        reservedPlanningCostUsd: usd(cents(authority.reservedPlanningCostUsd) - reservedCents),
        spentPlanningCostUsd: usd(cents(authority.spentPlanningCostUsd) + actualCents),
        reservedLogicalCalls: authority.reservedLogicalCalls - 1,
        consumedLogicalCalls: authority.consumedLogicalCalls + 1,
      }).where(eq(schema.certificationPlanningAuthorities.planningAuthorityId, authority.planningAuthorityId));
    });
  }

  /** Ambiguous transport failure retains the USD reservation, but not a fictitious settled cost. */
  async failUnknown(input: { planningClaimId: string; completedAt: string }) {
    return this.db.transaction(async (tx) => {
      const [binding] = await tx.select({ planningAuthorityId: schema.certificationPlanningClaims.planningAuthorityId }).from(schema.certificationPlanningClaims).where(eq(schema.certificationPlanningClaims.planningClaimId, input.planningClaimId)).limit(1);
      if (!binding) throw new CertificationPlanningAuthorityError("PLANNING_CLAIM_INVALID", "Planning claim missing");
      const [authority] = await tx.select().from(schema.certificationPlanningAuthorities).where(eq(schema.certificationPlanningAuthorities.planningAuthorityId, binding.planningAuthorityId)).limit(1).for("update");
      if (!authority) throw new CertificationPlanningAuthorityError("PLANNING_AUTHORITY_MISSING", "Planning authority missing");
      const [claim] = await tx.select().from(schema.certificationPlanningClaims).where(eq(schema.certificationPlanningClaims.planningClaimId, input.planningClaimId)).limit(1).for("update");
      if (!claim || claim.status !== "RESERVED") throw new CertificationPlanningAuthorityError("PLANNING_CLAIM_INVALID", "Only a reserved claim can fail");
      await tx.update(schema.certificationPlanningClaims).set({ status: "FAILED", completedAt: new Date(input.completedAt) }).where(eq(schema.certificationPlanningClaims.planningClaimId, claim.planningClaimId));
      await tx.update(schema.certificationPlanningAuthorities).set({ reservedLogicalCalls: authority.reservedLogicalCalls - 1, consumedLogicalCalls: authority.consumedLogicalCalls + 1 }).where(eq(schema.certificationPlanningAuthorities.planningAuthorityId, authority.planningAuthorityId));
    });
  }
}
