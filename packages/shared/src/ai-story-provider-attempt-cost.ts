/**
 * EXEC-05 — AI Story provider-attempt usage/cost contracts.
 *
 * Persistence authority: existing provider_attempts + provider_attempt_usage
 * + provider_attempt_costs JSON. Not a commercial ledger. Not customer charge.
 * settlementMode=none does NOT mean providerCost=0.
 */
import { z } from "zod";
import {
  ProviderCostSchema,
  ProviderCostSourceSchema,
  ProviderUsageSchema,
  type ProviderCost,
  type ProviderCostSource,
  type ProviderUsage,
} from "./provider-reliability-contracts";

export const AI_STORY_PROVIDER_COST_POLICY_VERSION =
  "ai-story-exec-05.v1" as const;

export const PROVIDER_COST_AUTHORITY_KIND = "PROVIDER_COST" as const;
export const CUSTOMER_CREDIT_CHARGE_AUTHORITY_KIND =
  "CUSTOMER_CREDIT_CHARGE" as const;

const KNOWN_COST_SOURCES: ReadonlySet<ProviderCostSource> = new Set([
  "PROVIDER_REPORTED",
  "MODEL_PRICING_TABLE",
  "CONFIGURED_ESTIMATE",
]);

export const AI_STORY_CONFIGURED_PROVIDER_ESTIMATES = Object.freeze({
  seedance: Object.freeze({
    providerKey: "seedance",
    amount: 0.35,
    currency: "USD",
    costSource: "CONFIGURED_ESTIMATE" as const,
    pricingBasis: "per_attempt_video",
    durationDependent: false,
    resolutionDependent: false,
    providerReportsCost: false,
  }),
  minimax: Object.freeze({
    providerKey: "minimax",
    amount: 0.4,
    currency: "USD",
    costSource: "CONFIGURED_ESTIMATE" as const,
    pricingBasis: "per_attempt_video",
    durationDependent: false,
    resolutionDependent: false,
    providerReportsCost: false,
  }),
});

export type AiStoryConfiguredProviderEstimateKey =
  keyof typeof AI_STORY_CONFIGURED_PROVIDER_ESTIMATES;

export function configuredEstimateForProvider(
  providerKey: string
): {
  readonly amount: number;
  readonly currency: "USD";
  readonly estimated: true;
  readonly costSource: "CONFIGURED_ESTIMATE";
} | null {
  const key = providerKey.trim().toLowerCase();
  if (key === "seedance" || key === "minimax") {
    const row = AI_STORY_CONFIGURED_PROVIDER_ESTIMATES[key];
    return {
      amount: row.amount,
      currency: row.currency,
      estimated: true,
      costSource: "CONFIGURED_ESTIMATE",
    };
  }
  return null;
}

export const AiStoryProviderAttemptOutcomeSchema = z.enum([
  "success",
  "failure",
]);
export type AiStoryProviderAttemptOutcome = z.infer<
  typeof AiStoryProviderAttemptOutcomeSchema
>;

export const AiStoryProviderAttemptCostEvidenceSchema = z
  .object({
    policyVersion: z.literal(AI_STORY_PROVIDER_COST_POLICY_VERSION),
    authorityKind: z.literal(PROVIDER_COST_AUTHORITY_KIND),
    storyId: z.string().min(1),
    sceneExecutionId: z.string().min(1),
    executionPlanId: z.string().min(1),
    providerExecutionId: z.string().min(1),
    attemptId: z.string().min(1),
    attemptNumber: z.number().int().positive(),
    providerKey: z.string().min(1),
    modelKey: z.string().min(1),
    requestedDurationSeconds: z.number().nonnegative().nullable(),
    requestedResolution: z.string().min(1).nullable(),
    providerRequestId: z.string().min(1).nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    createdAt: z.string().min(1),
    outcome: AiStoryProviderAttemptOutcomeSchema,
    failureClass: z.string().min(1).nullable(),
    amount: z.number().nonnegative().nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    estimated: z.boolean(),
    costSource: ProviderCostSourceSchema,
  })
  .strict();

export type AiStoryProviderAttemptCostEvidence = z.infer<
  typeof AiStoryProviderAttemptCostEvidenceSchema
>;

export const AiStorySceneProviderSpendSchema = z
  .object({
    sceneExecutionId: z.string().min(1),
    knownAmount: z.number().nonnegative().nullable(),
    unknownAttemptCount: z.number().int().nonnegative(),
    attemptCount: z.number().int().nonnegative(),
    currency: z.literal("USD"),
  })
  .strict();

export type AiStorySceneProviderSpend = z.infer<
  typeof AiStorySceneProviderSpendSchema
>;

export const AiStoryProviderSpendProjectionSchema = z
  .object({
    currency: z.literal("USD"),
    storyKnownAmount: z.number().nonnegative().nullable(),
    knownAttemptCount: z.number().int().nonnegative(),
    unknownAttemptCount: z.number().int().nonnegative(),
    attemptCount: z.number().int().nonnegative(),
    scenes: z.array(AiStorySceneProviderSpendSchema),
  })
  .strict();

export type AiStoryProviderSpendProjection = z.infer<
  typeof AiStoryProviderSpendProjectionSchema
>;

export function emptyAiStoryProviderSpendProjection(): AiStoryProviderSpendProjection {
  return {
    currency: "USD",
    storyKnownAmount: null,
    knownAttemptCount: 0,
    unknownAttemptCount: 0,
    attemptCount: 0,
    scenes: [],
  };
}

export type WorkerCostMetadataInput = {
  readonly amount?: number | null;
  readonly currency?: string;
  readonly estimated?: boolean;
  readonly costSource?: ProviderCostSource;
};

/**
 * Map worker/adapter cost metadata to ledger ProviderCost.
 * Missing amount → UNKNOWN with amount null. Never invent 0.
 */
export function mapWorkerCostMetadataToProviderCost(
  metadata: WorkerCostMetadataInput | null | undefined
): ProviderCost {
  if (!metadata || metadata.amount == null) {
    if (metadata?.costSource && KNOWN_COST_SOURCES.has(metadata.costSource)) {
      return ProviderCostSchema.parse({
        amount: null,
        currency: normalizeCurrency(metadata.currency),
        estimated: metadata.estimated ?? true,
        costSource: "UNKNOWN",
      });
    }
    return ProviderCostSchema.parse({
      amount: null,
      currency: normalizeCurrency(metadata?.currency),
      estimated: true,
      costSource: metadata?.costSource ?? "UNKNOWN",
    });
  }
  return ProviderCostSchema.parse({
    amount: metadata.amount,
    currency: normalizeCurrency(metadata.currency),
    estimated: metadata.estimated ?? true,
    costSource: metadata.costSource ?? "CONFIGURED_ESTIMATE",
  });
}

export type WorkerUsageFactsInput = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly durationMs?: number;
  readonly units?: number;
  readonly unitKind?: string;
  readonly requestedDurationSeconds?: number;
  readonly requestedResolution?: string;
};

export function mapWorkerUsageFactsToProviderUsage(
  facts: WorkerUsageFactsInput | null | undefined,
  extras?: {
    readonly durationMs?: number;
    readonly requestedDurationSeconds?: number;
    readonly requestedResolution?: string;
  }
): ProviderUsage {
  return ProviderUsageSchema.parse({
    ...(facts?.inputTokens !== undefined ? { inputTokens: facts.inputTokens } : {}),
    ...(facts?.outputTokens !== undefined ? { outputTokens: facts.outputTokens } : {}),
    ...(typeof (extras?.durationMs ?? facts?.durationMs) === "number"
      ? { durationMs: extras?.durationMs ?? facts?.durationMs }
      : {}),
    ...(typeof (extras?.requestedDurationSeconds ?? facts?.requestedDurationSeconds) ===
    "number"
      ? {
          requestedDurationSeconds:
            extras?.requestedDurationSeconds ?? facts?.requestedDurationSeconds,
        }
      : {}),
    ...(extras?.requestedResolution ?? facts?.requestedResolution
      ? {
          requestedResolution:
            extras?.requestedResolution ?? facts?.requestedResolution,
        }
      : {}),
    ...(facts?.units !== undefined ? { units: facts.units } : {}),
    ...(facts?.unitKind ? { unitKind: facts.unitKind } : {}),
  });
}

export function nextProviderAttemptNumber(
  existing: ReadonlyArray<{ readonly attemptId: string; readonly attemptNumber: number }>,
  attemptId: string
): number {
  const same = existing.find((row) => row.attemptId === attemptId);
  if (same) return same.attemptNumber;
  const max = existing.reduce(
    (highest, row) => Math.max(highest, row.attemptNumber),
    0
  );
  return max + 1;
}

export function safeProviderRequestId(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 256) return null;
  if (/^https?:/i.test(trimmed)) return null;
  if (/[?&](key|token|sig|signature|api[_-]?key)=/i.test(trimmed)) return null;
  if (/(authorization|bearer\s|api[_-]?key|secret)/i.test(trimmed)) return null;
  return trimmed;
}

const FORBIDDEN_EVIDENCE_KEY =
  /authorization|api[_-]?key|secret|signed|bearer|rawpayload|rawprompt|credentials|cookie/i;

export function redactProviderCostEvidenceRecord(
  value: Record<string, unknown>
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_EVIDENCE_KEY.test(key)) continue;
    if (typeof entry === "string" && /^https?:/i.test(entry) && /[?&]/.test(entry)) {
      continue;
    }
    redacted[key] = entry;
  }
  return redacted;
}

export function classifyPersistedProviderCost(
  cost: unknown
): {
  readonly amount: number | null;
  readonly currency: string;
  readonly estimated: boolean;
  readonly costSource: ProviderCostSource;
} {
  if (cost == null || typeof cost !== "object" || Array.isArray(cost)) {
    return {
      amount: null,
      currency: "USD",
      estimated: true,
      costSource: "LEGACY_UNKNOWN",
    };
  }
  const parsed = ProviderCostSchema.safeParse(cost);
  if (!parsed.success) {
    return {
      amount: null,
      currency: "USD",
      estimated: true,
      costSource: "LEGACY_UNKNOWN",
    };
  }
  if (!parsed.data.costSource) {
    return {
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      estimated: parsed.data.estimated,
      costSource: "LEGACY_UNKNOWN",
    };
  }
  return {
    amount: parsed.data.amount,
    currency: parsed.data.currency,
    estimated: parsed.data.estimated,
    costSource: parsed.data.costSource,
  };
}

export type AiStoryProviderAttemptCostRecord = {
  readonly storyId: string;
  readonly sceneExecutionId: string;
  readonly executionPlanId: string;
  readonly providerExecutionId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly providerId: string;
  readonly modelVersion: string;
  readonly providerRequestId?: string | null;
  readonly status: string;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
  readonly createdAt: string;
  readonly failureCode?: string | null;
  readonly cost?: unknown | null;
  readonly usage?: unknown | null;
};

function outcomeFromStatus(status: string): AiStoryProviderAttemptOutcome {
  return status === "SUCCEEDED" ? "success" : "failure";
}

export function toAiStoryProviderAttemptCostEvidence(
  record: AiStoryProviderAttemptCostRecord
): AiStoryProviderAttemptCostEvidence {
  const classified = classifyPersistedProviderCost(record.cost);
  const usage = ProviderUsageSchema.safeParse(record.usage ?? {});
  const usageValue = usage.success ? usage.data : {};
  return AiStoryProviderAttemptCostEvidenceSchema.parse({
    policyVersion: AI_STORY_PROVIDER_COST_POLICY_VERSION,
    authorityKind: PROVIDER_COST_AUTHORITY_KIND,
    storyId: record.storyId,
    sceneExecutionId: record.sceneExecutionId,
    executionPlanId: record.executionPlanId,
    providerExecutionId: record.providerExecutionId,
    attemptId: record.attemptId,
    attemptNumber: record.attemptNumber,
    providerKey: record.providerId,
    modelKey: record.modelVersion,
    requestedDurationSeconds: usageValue.requestedDurationSeconds ?? null,
    requestedResolution: usageValue.requestedResolution ?? null,
    providerRequestId: safeProviderRequestId(record.providerRequestId),
    startedAt: record.startedAt ?? null,
    completedAt: record.completedAt ?? null,
    createdAt: record.createdAt,
    outcome: outcomeFromStatus(record.status),
    failureClass: record.failureCode ?? null,
    amount: classified.amount,
    currency: classified.currency,
    estimated: classified.estimated,
    costSource: classified.costSource,
  });
}

function isKnownSpend(evidence: AiStoryProviderAttemptCostEvidence): boolean {
  return (
    evidence.amount != null && KNOWN_COST_SOURCES.has(evidence.costSource)
  );
}

export function reconstructAiStoryProviderSpend(
  records: readonly AiStoryProviderAttemptCostRecord[]
): {
  readonly attempts: readonly AiStoryProviderAttemptCostEvidence[];
  readonly projection: AiStoryProviderSpendProjection;
} {
  const attempts = records.map(toAiStoryProviderAttemptCostEvidence);
  const scenes = new Map<
    string,
    { known: number; unknown: number; count: number }
  >();
  for (const attempt of attempts) {
    const current = scenes.get(attempt.sceneExecutionId) ?? {
      known: 0,
      unknown: 0,
      count: 0,
    };
    current.count += 1;
    if (isKnownSpend(attempt)) {
      current.known += attempt.amount ?? 0;
    } else {
      current.unknown += 1;
    }
    scenes.set(attempt.sceneExecutionId, current);
  }
  const sceneSpend: AiStorySceneProviderSpend[] = [...scenes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sceneExecutionId, row]) => ({
      sceneExecutionId,
      knownAmount: row.count - row.unknown > 0 ? roundUsd(row.known) : null,
      unknownAttemptCount: row.unknown,
      attemptCount: row.count,
      currency: "USD" as const,
    }));
  const knownAttemptCount = attempts.filter(isKnownSpend).length;
  const unknownAttemptCount = attempts.length - knownAttemptCount;
  const storyKnown = attempts.reduce(
    (sum, attempt) => (isKnownSpend(attempt) ? sum + (attempt.amount ?? 0) : sum),
    0
  );
  return {
    attempts,
    projection: AiStoryProviderSpendProjectionSchema.parse({
      currency: "USD",
      storyKnownAmount:
        knownAttemptCount > 0 ? roundUsd(storyKnown) : null,
      knownAttemptCount,
      unknownAttemptCount,
      attemptCount: attempts.length,
      scenes: sceneSpend,
    }),
  };
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeCurrency(value: string | undefined): string {
  const currency = (value ?? "USD").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "USD";
}

export function providerRequestIdIsAttemptIdentity(): false {
  return false;
}
