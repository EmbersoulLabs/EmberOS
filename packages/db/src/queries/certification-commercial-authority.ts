import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import {
  AiStoryCompiledProviderRequestSchema,
  CERTIFICATION_COMMERCIAL_CONTRACT_VERSION,
  CERTIFICATION_COMMERCIAL_REASON,
  CertificationCommercialReservationSchema,
  CertificationCommercialScopeSchema,
  ProviderUsdPricingRuleSchema,
  estimateProviderCostUsd,
  withIntegrity,
  type CertificationCommercialReservation,
  type CertificationCommercialScope,
  type ProviderUsdPricingRule,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import {
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
} from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const providerPricingAuthorityFields = [
  "contractVersion", "providerUsdPricingRuleId", "providerKey", "modelId", "generationMode",
  "durationSeconds", "aspectRatio", "resolution", "inputVideoIncluded", "outputWidthPixels",
  "outputHeightPixels", "outputFrameRate", "currency", "usdPerMillionTokens", "costBasis",
  "sourceUrl", "version", "effectiveFrom", "effectiveTo",
] as const;

function assertSameProviderPricingAuthority(
  current: ProviderUsdPricingRule,
  requested: ProviderUsdPricingRule
): void {
  if (!providerPricingAuthorityFields.every((field) => current[field] === requested[field])) {
    throw new CertificationCommercialError(
      "PROVIDER_USD_PRICE_DIVERGENT",
      "Existing Provider USD pricing identity has divergent authority fields"
    );
  }
}

export type CertificationCommercialErrorCode =
  | "CERTIFICATION_BILLING_MISSING"
  | "CERTIFICATION_SCOPE_MISSING"
  | "CERTIFICATION_SCOPE_INACTIVE"
  | "PROVIDER_USD_PRICE_MISSING"
  | "PROVIDER_USD_PRICE_DIVERGENT"
  | "CERTIFICATION_BUDGET_EXCEEDED"
  | "CERTIFICATION_SUBMISSION_QUOTA_EXCEEDED"
  | "CERTIFICATION_SCOPE_MISMATCH"
  | "CERTIFICATION_RESERVATION_INVALID";

export class CertificationCommercialError extends Error {
  constructor(readonly code: CertificationCommercialErrorCode, message: string) {
    super(message);
    this.name = "CertificationCommercialError";
  }
}

const cents = (value: string) => Math.round(Number(value) * 100);
const usd = (value: number) => (value / 100).toFixed(2);

function scopeFromRow(row: typeof schema.certificationCommercialScopes.$inferSelect): CertificationCommercialScope {
  return CertificationCommercialScopeSchema.parse({
    contractVersion: row.contractVersion,
    certificationScopeId: row.certificationScopeId,
    environment: row.environment,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    capabilityKey: row.capabilityKey,
    status: row.status,
    maxProviderCostUsd: row.maxProviderCostUsd,
    maxProviderSubmissions: row.maxProviderSubmissions,
    spentProviderCostUsd: row.spentProviderCostUsd,
    reservedProviderCostUsd: row.reservedProviderCostUsd,
    consumedProviderSubmissions: row.consumedProviderSubmissions,
    reservedProviderSubmissions: row.reservedProviderSubmissions,
    createdBy: row.createdBy,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    integrityHash: row.integrityHash,
  });
}

function advanceScope(
  row: typeof schema.certificationCommercialScopes.$inferSelect,
  changes: Partial<Omit<CertificationCommercialScope, "integrityHash">>
): CertificationCommercialScope {
  const { integrityHash: _oldHash, ...current } = scopeFromRow(row);
  return CertificationCommercialScopeSchema.parse(withIntegrity({ ...current, ...changes }));
}

function reservationFromRow(row: typeof schema.certificationCommercialReservations.$inferSelect): CertificationCommercialReservation {
  return CertificationCommercialReservationSchema.parse({
    contractVersion: row.contractVersion,
    certificationReservationId: row.certificationReservationId,
    certificationScopeId: row.certificationScopeId,
    providerUsdPricingRuleId: row.providerUsdPricingRuleId,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    executionIdentity: row.executionIdentity,
    reservedCostUsd: row.reservedCostUsd,
    settledCostUsd: row.settledCostUsd,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    settledAt: row.settledAt?.toISOString() ?? null,
    releasedAt: row.releasedAt?.toISOString() ?? null,
    integrityHash: row.integrityHash,
  });
}

async function recordEvent(tx: Tx, input: {
  scopeId: string; reservationId?: string | null; type: string; costUsd?: string | null;
  actorUserId?: string | null; reason: string; occurredAt: string;
}) {
  const body = withIntegrity({
    contractVersion: CERTIFICATION_COMMERCIAL_CONTRACT_VERSION,
    certificationScopeId: input.scopeId,
    certificationReservationId: input.reservationId ?? null,
    eventType: input.type,
    costUsd: input.costUsd ?? null,
    actorUserId: input.actorUserId ?? null,
    reason: input.reason,
    occurredAt: input.occurredAt,
  });
  await tx.insert(schema.certificationCommercialEvents).values({
    certificationCommercialEventId: deterministicPersistenceUuid("certification-commercial-event", body),
    certificationScopeId: input.scopeId,
    certificationReservationId: input.reservationId ?? null,
    eventType: input.type,
    costUsd: input.costUsd ?? null,
    actorUserId: input.actorUserId ?? null,
    reason: input.reason,
    occurredAt: new Date(input.occurredAt),
    integrityHash: body.integrityHash,
    eventBody: body,
  }).onConflictDoNothing();
}

export class CertificationCommercialAuthorityService {
  constructor(private readonly db: Db = getDb()) {}

  async getActiveScope(orgId: string, workspaceId: string): Promise<CertificationCommercialScope | null> {
    const rows = await this.db.select().from(schema.certificationCommercialScopes).where(and(
      eq(schema.certificationCommercialScopes.environment, "STAGING"),
      eq(schema.certificationCommercialScopes.orgId, orgId),
      eq(schema.certificationCommercialScopes.workspaceId, workspaceId),
      eq(schema.certificationCommercialScopes.capabilityKey, "ai_story.execute"),
      eq(schema.certificationCommercialScopes.status, "ACTIVE"),
    )).limit(1);
    return rows[0] ? scopeFromRow(rows[0]) : null;
  }

  async getActivePricingEvidence(at: string): Promise<{
    ruleKey: string; ruleVersion: string; integrityHash: string;
  } | null> {
    const rows = await this.db.select({
      version: schema.providerUsdPricingRules.version,
      integrityHash: schema.providerUsdPricingRules.integrityHash,
    }).from(schema.providerUsdPricingRules).where(and(
      eq(schema.providerUsdPricingRules.providerKey, "BYTEPLUS_MODELARK"),
      eq(schema.providerUsdPricingRules.modelId, "dreamina-seedance-2-0-260128"),
      lte(schema.providerUsdPricingRules.effectiveFrom, new Date(at)),
      or(isNull(schema.providerUsdPricingRules.effectiveTo), gt(schema.providerUsdPricingRules.effectiveTo, new Date(at))),
    ));
    if (rows.length === 0) return null;
    const versions = [...new Set(rows.map((row) => row.version))].sort();
    return {
      ruleKey: "provider-usd:byteplus-modelark:dreamina-seedance-2-0-260128",
      ruleVersion: versions.join("+"),
      integrityHash: canonicalPersistenceHash({
        kind: "provider-usd-pricing-catalog",
        hashes: rows.map((row) => row.integrityHash).sort(),
      }),
    };
  }

  async provisionScope(input: {
    orgId: string; workspaceId: string; actorUserId: string; createdAt: string;
    maxProviderCostUsd?: string; maxProviderSubmissions?: number;
  }): Promise<{ scope: CertificationCommercialScope; replayed: boolean }> {
    return this.db.transaction(async (tx) => {
      const ownership = await tx.select({ workspaceId: schema.workspaces.id }).from(schema.workspaces).where(and(
        eq(schema.workspaces.id, input.workspaceId), eq(schema.workspaces.orgId, input.orgId),
      )).limit(1);
      if (!ownership[0]) throw new CertificationCommercialError("CERTIFICATION_SCOPE_MISMATCH", "Workspace does not belong to organization");
      const existing = await tx.select().from(schema.certificationCommercialScopes).where(and(
        eq(schema.certificationCommercialScopes.environment, "STAGING"), eq(schema.certificationCommercialScopes.orgId, input.orgId),
        eq(schema.certificationCommercialScopes.workspaceId, input.workspaceId), eq(schema.certificationCommercialScopes.capabilityKey, "ai_story.execute"),
      )).limit(1);
      if (existing[0]) return { scope: scopeFromRow(existing[0]), replayed: true };
      const value = withIntegrity({
        contractVersion: CERTIFICATION_COMMERCIAL_CONTRACT_VERSION,
        certificationScopeId: deterministicPersistenceUuid("certification-commercial-scope", { environment: "STAGING", orgId: input.orgId, workspaceId: input.workspaceId, capabilityKey: "ai_story.execute" }),
        environment: "STAGING" as const, orgId: input.orgId, workspaceId: input.workspaceId,
        capabilityKey: "ai_story.execute" as const, status: "ACTIVE" as const,
        maxProviderCostUsd: input.maxProviderCostUsd ?? "5.00",
        maxProviderSubmissions: input.maxProviderSubmissions ?? 4,
        spentProviderCostUsd: "0.00", reservedProviderCostUsd: "0.00",
        consumedProviderSubmissions: 0, reservedProviderSubmissions: 0,
        createdBy: input.actorUserId, reason: CERTIFICATION_COMMERCIAL_REASON,
        createdAt: input.createdAt, closedAt: null, revokedAt: null,
      });
      const scope = CertificationCommercialScopeSchema.parse(value);
      await tx.insert(schema.certificationCommercialScopes).values({
        certificationScopeId: scope.certificationScopeId, environment: scope.environment,
        orgId: scope.orgId, workspaceId: scope.workspaceId, capabilityKey: scope.capabilityKey,
        status: scope.status, maxProviderCostUsd: scope.maxProviderCostUsd,
        maxProviderSubmissions: scope.maxProviderSubmissions, spentProviderCostUsd: scope.spentProviderCostUsd,
        reservedProviderCostUsd: scope.reservedProviderCostUsd, consumedProviderSubmissions: 0,
        reservedProviderSubmissions: 0, createdBy: scope.createdBy, reason: scope.reason,
        createdAt: new Date(scope.createdAt), closedAt: null, revokedAt: null,
        integrityHash: scope.integrityHash, contractVersion: scope.contractVersion, scopeBody: scope,
      });
      await recordEvent(tx, { scopeId: scope.certificationScopeId, type: "CREATED", actorUserId: input.actorUserId, reason: scope.reason, occurredAt: input.createdAt });
      return { scope, replayed: false };
    });
  }

  async provisionPrice(rule: ProviderUsdPricingRule): Promise<{ rule: ProviderUsdPricingRule; replayed: boolean }> {
    const parsed = ProviderUsdPricingRuleSchema.parse(rule);
    const existing = await this.db.select().from(schema.providerUsdPricingRules)
      .where(eq(schema.providerUsdPricingRules.providerUsdPricingRuleId, parsed.providerUsdPricingRuleId)).limit(1);
    if (existing[0]) {
      const current = ProviderUsdPricingRuleSchema.parse(existing[0].pricingBody);
      assertSameProviderPricingAuthority(current, parsed);
      return { rule: current, replayed: true };
    }
    await this.db.insert(schema.providerUsdPricingRules).values({
      providerUsdPricingRuleId: parsed.providerUsdPricingRuleId, providerKey: parsed.providerKey,
      modelId: parsed.modelId, generationMode: parsed.generationMode, durationSeconds: parsed.durationSeconds,
      aspectRatio: parsed.aspectRatio,
      resolution: parsed.resolution, inputVideoIncluded: parsed.inputVideoIncluded,
      outputWidthPixels: parsed.outputWidthPixels, outputHeightPixels: parsed.outputHeightPixels,
      outputFrameRate: parsed.outputFrameRate, currency: parsed.currency,
      usdPerMillionTokens: parsed.usdPerMillionTokens, costBasis: parsed.costBasis,
      sourceUrl: parsed.sourceUrl,
      version: parsed.version, effectiveFrom: new Date(parsed.effectiveFrom), effectiveTo: parsed.effectiveTo ? new Date(parsed.effectiveTo) : null,
      createdBy: parsed.createdBy, createdAt: new Date(parsed.createdAt), integrityHash: parsed.integrityHash,
      contractVersion: parsed.contractVersion, pricingBody: parsed,
    }).onConflictDoNothing();
    const accepted = await this.db.select().from(schema.providerUsdPricingRules)
      .where(eq(schema.providerUsdPricingRules.providerUsdPricingRuleId, parsed.providerUsdPricingRuleId)).limit(1);
    if (!accepted[0]) {
      throw new CertificationCommercialError("PROVIDER_USD_PRICE_DIVERGENT", "Provider USD price was not persisted");
    }
    const acceptedRule = ProviderUsdPricingRuleSchema.parse(accepted[0].pricingBody);
    assertSameProviderPricingAuthority(acceptedRule, parsed);
    return { rule: acceptedRule, replayed: acceptedRule.integrityHash !== parsed.integrityHash };
  }

  async revokeScope(input: { scopeId: string; actorUserId: string; reason: string; revokedAt: string }) {
    return this.db.transaction(async (tx) => {
      const rows = await tx.select().from(schema.certificationCommercialScopes).where(eq(schema.certificationCommercialScopes.certificationScopeId, input.scopeId)).limit(1).for("update");
      const row = rows[0];
      if (!row) throw new CertificationCommercialError("CERTIFICATION_SCOPE_MISSING", "Certification scope not found");
      if (row.status === "REVOKED") return { scope: scopeFromRow(row), replayed: true };
      if (row.reservedProviderSubmissions !== 0 || cents(row.reservedProviderCostUsd) !== 0) throw new CertificationCommercialError("CERTIFICATION_RESERVATION_INVALID", "Open reservations must be settled or released before revocation");
      const nextScope = advanceScope(row, { status: "REVOKED", revokedAt: input.revokedAt });
      await tx.update(schema.certificationCommercialScopes).set({
        status: "REVOKED", revokedAt: new Date(input.revokedAt),
        integrityHash: nextScope.integrityHash, scopeBody: nextScope,
      }).where(eq(schema.certificationCommercialScopes.certificationScopeId, input.scopeId));
      await recordEvent(tx, { scopeId: input.scopeId, type: "REVOKED", actorUserId: input.actorUserId, reason: input.reason, occurredAt: input.revokedAt });
      const updated = await tx.select().from(schema.certificationCommercialScopes).where(eq(schema.certificationCommercialScopes.certificationScopeId, input.scopeId)).limit(1);
      return { scope: scopeFromRow(updated[0]!), replayed: false };
    });
  }

  async resolvePrice(input: {
    providerKey: "BYTEPLUS_MODELARK"; modelId: "dreamina-seedance-2-0-260128";
    generationMode: "TEXT_TO_VIDEO" | "FIRST_FRAME_IMAGE_TO_VIDEO";
    durationSeconds: number; aspectRatio: "9:16" | "16:9" | "1:1"; resolution: "480p" | "720p" | "1080p"; at: string;
  }): Promise<ProviderUsdPricingRule | null> {
    const rows = await this.db.select().from(schema.providerUsdPricingRules).where(and(
      eq(schema.providerUsdPricingRules.providerKey, input.providerKey),
      eq(schema.providerUsdPricingRules.modelId, input.modelId),
      eq(schema.providerUsdPricingRules.generationMode, input.generationMode),
      eq(schema.providerUsdPricingRules.durationSeconds, input.durationSeconds),
      eq(schema.providerUsdPricingRules.aspectRatio, input.aspectRatio),
      eq(schema.providerUsdPricingRules.resolution, input.resolution),
      lte(schema.providerUsdPricingRules.effectiveFrom, new Date(input.at)),
      or(isNull(schema.providerUsdPricingRules.effectiveTo), gt(schema.providerUsdPricingRules.effectiveTo, new Date(input.at))),
    )).orderBy(desc(schema.providerUsdPricingRules.effectiveFrom)).limit(1);
    return rows[0] ? ProviderUsdPricingRuleSchema.parse(rows[0].pricingBody) : null;
  }

  async reserve(input: {
    orgId: string; workspaceId: string; executionIdentity: string;
    pricingRule: ProviderUsdPricingRule; createdAt: string; claimSubmission?: boolean;
  }): Promise<{ scope: CertificationCommercialScope; reservation: CertificationCommercialReservation; replayed: boolean }> {
    return this.db.transaction(async (tx) => {
      const scopeRows = await tx.select().from(schema.certificationCommercialScopes).where(and(
        eq(schema.certificationCommercialScopes.environment, "STAGING"),
        eq(schema.certificationCommercialScopes.orgId, input.orgId),
        eq(schema.certificationCommercialScopes.workspaceId, input.workspaceId),
        eq(schema.certificationCommercialScopes.capabilityKey, "ai_story.execute"),
      )).limit(1).for("update");
      const row = scopeRows[0];
      if (!row) throw new CertificationCommercialError("CERTIFICATION_SCOPE_MISSING", "Certification commercial scope is required");
      if (row.status !== "ACTIVE") throw new CertificationCommercialError("CERTIFICATION_SCOPE_INACTIVE", "Certification commercial scope is not active");
      const billing = await tx.select({ id: schema.billingAccounts.billingAccountId }).from(schema.billingAccounts)
        .where(eq(schema.billingAccounts.orgId, input.orgId)).limit(1);
      if (!billing[0]) throw new CertificationCommercialError("CERTIFICATION_BILLING_MISSING", "Billing Account is required");
      const persistedPrice = await tx.select({ id: schema.providerUsdPricingRules.providerUsdPricingRuleId })
        .from(schema.providerUsdPricingRules)
        .where(and(
          eq(schema.providerUsdPricingRules.providerUsdPricingRuleId, input.pricingRule.providerUsdPricingRuleId),
          eq(schema.providerUsdPricingRules.integrityHash, input.pricingRule.integrityHash),
        )).limit(1);
      if (!persistedPrice[0]) throw new CertificationCommercialError("PROVIDER_USD_PRICE_MISSING", "Persisted Provider USD price is required");
      const existing = await tx.select().from(schema.certificationCommercialReservations).where(and(
        eq(schema.certificationCommercialReservations.certificationScopeId, row.certificationScopeId),
        eq(schema.certificationCommercialReservations.executionIdentity, input.executionIdentity),
      )).limit(1);
      if (existing[0]) return { scope: scopeFromRow(row), reservation: reservationFromRow(existing[0]), replayed: true };

      const proposedCostUsd = estimateProviderCostUsd(input.pricingRule);
      const proposed = cents(proposedCostUsd);
      if (cents(row.spentProviderCostUsd) + cents(row.reservedProviderCostUsd) + proposed > cents(row.maxProviderCostUsd)) {
        throw new CertificationCommercialError("CERTIFICATION_BUDGET_EXCEEDED", "Certification USD budget exceeded");
      }
      if (row.consumedProviderSubmissions + row.reservedProviderSubmissions + 1 > row.maxProviderSubmissions) {
        throw new CertificationCommercialError("CERTIFICATION_SUBMISSION_QUOTA_EXCEEDED", "Certification Provider submission quota exceeded");
      }
      const candidate = withIntegrity({
        contractVersion: CERTIFICATION_COMMERCIAL_CONTRACT_VERSION,
        certificationReservationId: deterministicPersistenceUuid("certification-commercial-reservation", { scope: row.certificationScopeId, executionIdentity: input.executionIdentity }),
        certificationScopeId: row.certificationScopeId,
        providerUsdPricingRuleId: input.pricingRule.providerUsdPricingRuleId,
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        executionIdentity: input.executionIdentity,
        reservedCostUsd: proposedCostUsd,
        settledCostUsd: null,
        status: input.claimSubmission ? ("SUBMITTED" as const) : ("RESERVED" as const),
        createdAt: input.createdAt,
        submittedAt: input.claimSubmission ? input.createdAt : null,
        settledAt: null,
        releasedAt: null,
      });
      const reservation = CertificationCommercialReservationSchema.parse(candidate);
      await tx.insert(schema.certificationCommercialReservations).values({
        certificationReservationId: reservation.certificationReservationId,
        certificationScopeId: reservation.certificationScopeId,
        providerUsdPricingRuleId: reservation.providerUsdPricingRuleId,
        orgId: reservation.orgId, workspaceId: reservation.workspaceId,
        executionIdentity: reservation.executionIdentity,
        reservedCostUsd: reservation.reservedCostUsd, settledCostUsd: null,
        status: reservation.status, createdAt: new Date(reservation.createdAt),
        submittedAt: reservation.submittedAt ? new Date(reservation.submittedAt) : null, settledAt: null, releasedAt: null,
        integrityHash: reservation.integrityHash, contractVersion: reservation.contractVersion,
        reservationBody: reservation,
      });
      const nextScope = advanceScope(row, {
        reservedProviderCostUsd: usd(cents(row.reservedProviderCostUsd) + proposed),
        reservedProviderSubmissions: row.reservedProviderSubmissions + (input.claimSubmission ? 0 : 1),
        consumedProviderSubmissions: row.consumedProviderSubmissions + (input.claimSubmission ? 1 : 0),
      });
      await tx.update(schema.certificationCommercialScopes).set({
        reservedProviderCostUsd: nextScope.reservedProviderCostUsd,
        reservedProviderSubmissions: nextScope.reservedProviderSubmissions,
        consumedProviderSubmissions: nextScope.consumedProviderSubmissions,
        integrityHash: nextScope.integrityHash,
        scopeBody: nextScope,
      }).where(eq(schema.certificationCommercialScopes.certificationScopeId, row.certificationScopeId));
      await recordEvent(tx, { scopeId: row.certificationScopeId, reservationId: reservation.certificationReservationId, type: "RESERVED", costUsd: reservation.reservedCostUsd, reason: "pre-dispatch atomic certification reservation", occurredAt: input.createdAt });
      if (input.claimSubmission) {
        await recordEvent(tx, { scopeId: row.certificationScopeId, reservationId: reservation.certificationReservationId, type: "SUBMITTED", costUsd: reservation.reservedCostUsd, reason: "atomic Provider submission slot claim", occurredAt: input.createdAt });
      }
      const updated = await tx.select().from(schema.certificationCommercialScopes).where(eq(schema.certificationCommercialScopes.certificationScopeId, row.certificationScopeId)).limit(1);
      return { scope: scopeFromRow(updated[0]!), reservation, replayed: false };
    });
  }

  async getReservationByExecutionIdentity(input: {
    executionIdentity: string;
  }): Promise<CertificationCommercialReservation | null> {
    const rows = await this.db.select().from(schema.certificationCommercialReservations).where(and(
      eq(schema.certificationCommercialReservations.executionIdentity, input.executionIdentity),
    )).limit(1);
    return rows[0] ? reservationFromRow(rows[0]) : null;
  }

  async reserveForSceneExecution(input: {
    orgId: string; workspaceId: string; sceneExecutionId: string;
    compiledRequestId: string; requestFingerprint?: string;
    executionIdentity: string; reservedAt: string;
  }) {
    const { pricingRule } = await this.previewForSceneExecution(input);
    return this.reserve({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      executionIdentity: input.executionIdentity,
      pricingRule,
      createdAt: input.reservedAt,
      claimSubmission: true,
    });
  }

  /**
   * Resolves the exact immutable request and Provider USD price without
   * reserving budget or quota. This is the non-consuming certification gate
   * used before an operational no-dispatch hold.
   */
  async previewForSceneExecution(input: {
    orgId: string; workspaceId: string; sceneExecutionId: string;
    compiledRequestId: string; requestFingerprint?: string;
    executionIdentity: string; reservedAt: string;
  }) {
    const rows = await this.db.select({ compiledRequest: schema.aiStoryCompiledProviderRequests.compiledRequest })
      .from(schema.aiStoryCompiledProviderRequests)
      .where(and(
        eq(schema.aiStoryCompiledProviderRequests.orgId, input.orgId),
        eq(schema.aiStoryCompiledProviderRequests.workspaceId, input.workspaceId),
        eq(schema.aiStoryCompiledProviderRequests.sceneExecutionId, input.sceneExecutionId),
        eq(schema.aiStoryCompiledProviderRequests.compiledRequestId, input.compiledRequestId),
      )).limit(1);
    const request = rows[0]
      ? AiStoryCompiledProviderRequestSchema.parse(rows[0].compiledRequest)
      : null;
    if (!request) throw new CertificationCommercialError("PROVIDER_USD_PRICE_MISSING", "Compiled Provider request is required for USD pricing");
    if (
      request.compiledRequestId !== input.compiledRequestId ||
      (input.requestFingerprint !== undefined &&
        request.requestFingerprint !== input.requestFingerprint) ||
      request.sceneExecutionId !== input.sceneExecutionId ||
      request.orgId !== input.orgId ||
      request.workspaceId !== input.workspaceId
    ) {
      throw new CertificationCommercialError(
        "PROVIDER_USD_PRICE_MISSING",
        "Compiled Provider request binding conflicts with Worker dispatch authority"
      );
    }
    const pricingRule = await this.resolvePrice({
      providerKey: "BYTEPLUS_MODELARK",
      modelId: request.modelId,
      generationMode: request.generationMode,
      durationSeconds: request.structuredRequest.duration,
      aspectRatio: request.structuredRequest.ratio,
      resolution: request.structuredRequest.resolution,
      at: input.reservedAt,
    });
    if (!pricingRule) throw new CertificationCommercialError("PROVIDER_USD_PRICE_MISSING", "Exact Provider USD pricing rule is required");
    return { compiledRequest: request, pricingRule };
  }

  async settleFromProviderUsage(input: {
    reservationId: string; completionTokens?: number; settledAt: string;
  }) {
    const rows = await this.db.select({
      reservation: schema.certificationCommercialReservations,
      pricing: schema.providerUsdPricingRules,
    }).from(schema.certificationCommercialReservations)
      .innerJoin(schema.providerUsdPricingRules, eq(
        schema.providerUsdPricingRules.providerUsdPricingRuleId,
        schema.certificationCommercialReservations.providerUsdPricingRuleId,
      ))
      .where(eq(schema.certificationCommercialReservations.certificationReservationId, input.reservationId))
      .limit(1);
    if (!rows[0]) throw new CertificationCommercialError("CERTIFICATION_RESERVATION_INVALID", "Reservation pricing authority is missing");
    const actualCostUsd = input.completionTokens === undefined
      ? rows[0].reservation.reservedCostUsd
      : (Math.ceil((input.completionTokens * Number(rows[0].pricing.usdPerMillionTokens) / 1_000_000) * 100) / 100).toFixed(2);
    return this.settle(input.reservationId, actualCostUsd, input.settledAt);
  }

  async markSubmitted(reservationId: string, submittedAt: string) {
    return this.transition(reservationId, "SUBMITTED", submittedAt, null);
  }
  async settle(reservationId: string, actualCostUsd: string, settledAt: string) {
    return this.transition(reservationId, "SETTLED", settledAt, actualCostUsd);
  }
  async release(reservationId: string, releasedAt: string) {
    return this.transition(reservationId, "RELEASED", releasedAt, null);
  }

  private async transition(reservationId: string, target: "SUBMITTED" | "SETTLED" | "RELEASED", at: string, actual: string | null) {
    return this.db.transaction(async (tx) => {
      const reservations = await tx.select().from(schema.certificationCommercialReservations).where(eq(schema.certificationCommercialReservations.certificationReservationId, reservationId)).limit(1).for("update");
      const current = reservations[0];
      if (!current) throw new CertificationCommercialError("CERTIFICATION_RESERVATION_INVALID", "Reservation not found");
      if (current.status === target || ["SETTLED", "RELEASED"].includes(current.status)) return { reservation: reservationFromRow(current), replayed: true };
      const scopes = await tx.select().from(schema.certificationCommercialScopes).where(eq(schema.certificationCommercialScopes.certificationScopeId, current.certificationScopeId)).limit(1).for("update");
      const scope = scopes[0]!;
      let reservedCost = cents(scope.reservedProviderCostUsd);
      let spentCost = cents(scope.spentProviderCostUsd);
      let reservedSlots = scope.reservedProviderSubmissions;
      let consumedSlots = scope.consumedProviderSubmissions;
      if (target === "SUBMITTED" && current.status === "RESERVED") { reservedSlots -= 1; consumedSlots += 1; }
      if (target === "RELEASED") {
        reservedCost -= cents(current.reservedCostUsd);
        if (current.status === "RESERVED") reservedSlots -= 1;
      }
      if (target === "SETTLED") {
        const cost = cents(actual ?? current.reservedCostUsd);
        reservedCost -= cents(current.reservedCostUsd);
        spentCost += cost;
        if (current.status === "RESERVED") { reservedSlots -= 1; consumedSlots += 1; }
        if (spentCost + reservedCost > cents(scope.maxProviderCostUsd)) throw new CertificationCommercialError("CERTIFICATION_BUDGET_EXCEEDED", "Actual settlement exceeds certification budget");
      }
      const nextRaw = withIntegrity({
        contractVersion: current.contractVersion,
        certificationReservationId: current.certificationReservationId,
        certificationScopeId: current.certificationScopeId,
        providerUsdPricingRuleId: current.providerUsdPricingRuleId,
        orgId: current.orgId, workspaceId: current.workspaceId,
        executionIdentity: current.executionIdentity,
        reservedCostUsd: current.reservedCostUsd,
        settledCostUsd: target === "SETTLED" ? (actual ?? current.reservedCostUsd) : null,
        status: target,
        createdAt: current.createdAt.toISOString(),
        submittedAt: target === "SUBMITTED" || target === "SETTLED" ? (current.submittedAt?.toISOString() ?? at) : null,
        settledAt: target === "SETTLED" ? at : null,
        releasedAt: target === "RELEASED" ? at : null,
      });
      const next = CertificationCommercialReservationSchema.parse(nextRaw);
      await tx.update(schema.certificationCommercialReservations).set({
        status: next.status, settledCostUsd: next.settledCostUsd,
        submittedAt: next.submittedAt ? new Date(next.submittedAt) : null,
        settledAt: next.settledAt ? new Date(next.settledAt) : null,
        releasedAt: next.releasedAt ? new Date(next.releasedAt) : null,
        integrityHash: next.integrityHash, reservationBody: next,
      }).where(eq(schema.certificationCommercialReservations.certificationReservationId, reservationId));
      const nextScope = advanceScope(scope, {
        reservedProviderCostUsd: usd(reservedCost), spentProviderCostUsd: usd(spentCost),
        reservedProviderSubmissions: reservedSlots, consumedProviderSubmissions: consumedSlots,
      });
      await tx.update(schema.certificationCommercialScopes).set({
        reservedProviderCostUsd: nextScope.reservedProviderCostUsd,
        spentProviderCostUsd: nextScope.spentProviderCostUsd,
        reservedProviderSubmissions: nextScope.reservedProviderSubmissions,
        consumedProviderSubmissions: nextScope.consumedProviderSubmissions,
        integrityHash: nextScope.integrityHash,
        scopeBody: nextScope,
      }).where(eq(schema.certificationCommercialScopes.certificationScopeId, scope.certificationScopeId));
      await recordEvent(tx, { scopeId: scope.certificationScopeId, reservationId, type: target, costUsd: target === "SETTLED" ? next.settledCostUsd : current.reservedCostUsd, reason: `certification reservation ${target.toLowerCase()}`, occurredAt: at });
      return { reservation: next, replayed: false };
    });
  }
}
