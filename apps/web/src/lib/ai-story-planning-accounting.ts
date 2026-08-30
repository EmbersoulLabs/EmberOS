import { and, eq, inArray } from "drizzle-orm";
import {
  ProviderLedgerRepository,
  createProviderExecution,
  getDb,
  schema,
} from "@ceo-agent/db";
import {
  ProviderAttemptSchema,
  ProviderCostSchema,
  ProviderExecutionSchema,
  ProviderUsageSchema,
  createProviderError,
  type ProviderExecution,
} from "@ceo-agent/shared";
import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "@ceo-agent/shared/server";
import type {
  AiStoryPlanningAccounting,
  AiStoryPlanningTimings,
  AiStoryPlanningValidationIssueCode,
} from "@ceo-agent/agents";

type Db = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

const CONTRACT_VERSION = "1" as const;
const CAPABILITY_VERSION = "1.0.0";
const OUTPUT_SCHEMA_VERSION = "1.0.0";
const PROVIDER_VERSION = "openai-api-v1";

export type AiStoryPlanningLedgerIdentity = {
  execution: ProviderExecution;
  executionId: string;
  attemptId: string;
  requestHash: string;
};

export function buildAiStoryPlanningLedgerIdentity(input: {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  runSeed: string;
  requestMaterial: unknown;
  startedAt: string;
}): AiStoryPlanningLedgerIdentity {
  const requestHash = sha256CanonicalIntegrityHash(input.requestMaterial);
  const deterministicFingerprint = sha256CanonicalIntegrityHash({
    purpose: "AI_STORY_STORY_POLISH",
    storyId: input.storyId,
    runSeed: input.runSeed,
    requestHash,
  });
  const executionId = deterministicUuidFromFingerprint(
    "ai-story-story-polish-execution",
    deterministicFingerprint
  );
  const attemptId = deterministicUuidFromFingerprint(
    "ai-story-story-polish-attempt",
    executionId
  );
  const execution = ProviderExecutionSchema.parse({
    contractVersion: CONTRACT_VERSION,
    identity: {
      executionId,
      tenantId: input.orgId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      pipelineRunId: `ai-story-story-polish:${input.storyId}`,
      capabilityId: "ai-story.story-polish",
      capabilityVersion: CAPABILITY_VERSION,
      idempotencyKey: `ai-story-story-polish:${executionId}`,
      deterministicFingerprint,
    },
    metadata: {
      skillId: "ai-story-story-polish",
      skillVersion: CAPABILITY_VERSION,
      promptId: "ai-story-story-polish",
      promptVersion: "1.0.0",
      contextVersions: { aiStoryStructuredDraft: OUTPUT_SCHEMA_VERSION },
      outputSchemaId: "ai-story-structured-draft",
      outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
      correlationId: executionId,
      createdAt: input.startedAt,
    },
    status: "PENDING",
    createdAt: input.startedAt,
  });
  return { execution, executionId, attemptId, requestHash };
}

export async function beginAiStoryPlanningAccounting(
  db: Db,
  identity: AiStoryPlanningLedgerIdentity
): Promise<void> {
  await createProviderExecution(db, identity.execution, identity.requestHash);
}

type PlanningOutcome = {
  db: Db;
  storyId: string;
  identity: AiStoryPlanningLedgerIdentity;
  status: "SUCCEEDED" | "TERMINAL_FAILURE";
  failureCode?:
    | "AI_STORY_PLANNING_OUTPUT_CONTRACT_INVALID"
    | "AI_STORY_PLANNING_PROVIDER_TRANSPORT_FAILURE";
  errorStage?: "provider" | "decode" | "validation";
  validationIssueCodes?: readonly AiStoryPlanningValidationIssueCode[];
  accounting?: AiStoryPlanningAccounting;
  timings: AiStoryPlanningTimings;
  completedAt: string;
};

async function assertExecutionCanComplete(
  tx: Transaction,
  executionId: string,
  targetStatus: "SUCCEEDED" | "TERMINAL_FAILURE"
): Promise<void> {
  const [row] = await tx
    .select({ status: schema.providerExecutions.status })
    .from(schema.providerExecutions)
    .where(eq(schema.providerExecutions.executionId, executionId))
    .limit(1);
  if (!row) throw new Error("AI Story planning execution ledger is missing");
  if (row.status !== "PENDING" && row.status !== targetStatus) {
    throw new Error("AI Story planning execution outcome conflicts");
  }
}

export async function persistAiStoryPlanningOutcome(
  input: PlanningOutcome
): Promise<{ usagePersistMs: number; costPersistMs: number; failurePersistMs: number }> {
  const issueCodes = [...new Set(input.validationIssueCodes ?? [])].sort();
  const attempt = ProviderAttemptSchema.parse({
    contractVersion: CONTRACT_VERSION,
    attemptId: input.identity.attemptId,
    executionId: input.identity.executionId,
    attemptNumber: 0,
    providerId: "openai",
    providerVersion: PROVIDER_VERSION,
    modelVersion: input.accounting?.model ?? "gpt-4o-mini",
    providerRequestId: input.accounting?.providerRequestId,
    requestHash: input.identity.requestHash,
    responseHash: sha256CanonicalIntegrityHash({
      providerRequestId: input.accounting?.providerRequestId ?? null,
      status: input.status,
      failureCode: input.failureCode ?? null,
      validationIssueCodes: issueCodes,
    }),
    status: input.status,
    startedAt: input.identity.execution.createdAt,
    completedAt: input.completedAt,
  });
  const usage = input.accounting
    ? ProviderUsageSchema.parse({
        inputTokens: input.accounting.usage.input,
        outputTokens: input.accounting.usage.output,
        totalTokens: input.accounting.usage.total,
        durationMs: Math.max(0, Math.round(input.timings.planningProviderMs)),
      })
    : null;
  const cost = input.accounting
    ? ProviderCostSchema.parse({
        amount: input.accounting.cost.amount,
        currency: input.accounting.cost.currency,
        estimated: true,
        costSource: input.accounting.cost.costSource,
      })
    : null;
  const failure = input.failureCode
    ? createProviderError(
        input.failureCode === "AI_STORY_PLANNING_OUTPUT_CONTRACT_INVALID"
          ? "VALIDATION_FAILURE"
          : "TERMINAL_FAILURE",
        {
          code: input.failureCode,
          message:
            input.failureCode === "AI_STORY_PLANNING_OUTPUT_CONTRACT_INVALID"
              ? "AI Story planning output did not satisfy the canonical contract"
              : "AI Story planning provider request failed",
          safeDetails: {
            errorStage: input.errorStage ?? "provider",
            validationIssueCodes: issueCodes,
          },
        }
      )
    : undefined;

  let usagePersistMs = 0;
  let costPersistMs = 0;
  let failurePersistMs = 0;
  await input.db.transaction(async (tx) => {
    await assertExecutionCanComplete(tx, input.identity.executionId, input.status);
    const ledger = new ProviderLedgerRepository(tx as unknown as Db);
    const warnings = issueCodes.map((code) => ({
      code,
      message: "Canonical structured-output validation issue",
      retryable: false,
    }));
    const providerMetadata = {
      purpose: "AI_STORY_STORY_POLISH",
      storyId: input.storyId,
      failureCode: input.failureCode ?? null,
      errorStage: input.errorStage ?? null,
      validationIssueCodes: issueCodes,
      planningProviderMs: input.timings.planningProviderMs,
      planningDecodeMs: input.timings.planningDecodeMs,
      planningValidationMs: input.timings.planningValidationMs,
    };
    const [existingAttempt] = await tx
      .select()
      .from(schema.providerAttempts)
      .where(eq(schema.providerAttempts.attemptId, input.identity.attemptId))
      .limit(1);
    if (existingAttempt) {
      const existingAttemptIdentity = ProviderAttemptSchema.parse({
        contractVersion: existingAttempt.contractVersion,
        attemptId: existingAttempt.attemptId,
        executionId: existingAttempt.executionId,
        attemptNumber: existingAttempt.attemptNumber,
        providerId: existingAttempt.providerId,
        providerVersion: existingAttempt.providerVersion,
        modelVersion: existingAttempt.modelVersion,
        providerRequestId: existingAttempt.providerRequestId ?? undefined,
        requestHash: existingAttempt.requestHash,
        responseHash: existingAttempt.responseHash ?? undefined,
        status: existingAttempt.status,
        startedAt: existingAttempt.startedAt?.toISOString(),
        completedAt: existingAttempt.completedAt?.toISOString(),
      });
      const factsMatch =
        sha256CanonicalIntegrityHash(existingAttemptIdentity) ===
          sha256CanonicalIntegrityHash(attempt) &&
        sha256CanonicalIntegrityHash(existingAttempt.failure ?? null) ===
          sha256CanonicalIntegrityHash(failure ?? null) &&
        sha256CanonicalIntegrityHash(existingAttempt.warnings) ===
          sha256CanonicalIntegrityHash(warnings) &&
        sha256CanonicalIntegrityHash(existingAttempt.providerMetadata) ===
          sha256CanonicalIntegrityHash(providerMetadata);
      if (!factsMatch) throw new Error("AI Story planning attempt outcome conflicts");
    } else {
      await ledger.appendAttempt({ attempt, failure, warnings, providerMetadata });
    }
    if (usage) {
      const startedAt = performance.now();
      const [existingUsage] = await tx
        .select({ usage: schema.providerAttemptUsage.usage })
        .from(schema.providerAttemptUsage)
        .where(eq(schema.providerAttemptUsage.attemptId, input.identity.attemptId))
        .limit(1);
      if (existingUsage) {
        if (
          sha256CanonicalIntegrityHash(existingUsage.usage) !==
          sha256CanonicalIntegrityHash(usage)
        ) {
          throw new Error("AI Story planning usage conflicts");
        }
      } else {
        await ledger.recordUsage(input.identity.attemptId, usage);
      }
      usagePersistMs = performance.now() - startedAt;
    }
    if (cost) {
      const startedAt = performance.now();
      const [existingCost] = await tx
        .select({ cost: schema.providerAttemptCosts.cost })
        .from(schema.providerAttemptCosts)
        .where(eq(schema.providerAttemptCosts.attemptId, input.identity.attemptId))
        .limit(1);
      if (existingCost) {
        if (
          sha256CanonicalIntegrityHash(existingCost.cost) !==
          sha256CanonicalIntegrityHash(cost)
        ) {
          throw new Error("AI Story planning cost conflicts");
        }
      } else {
        await ledger.recordCost(input.identity.attemptId, cost);
      }
      costPersistMs = performance.now() - startedAt;
    }
    await tx
      .update(schema.providerExecutions)
      .set({ status: input.status, completedAt: new Date(input.completedAt) })
      .where(
        and(
          eq(schema.providerExecutions.executionId, input.identity.executionId),
          inArray(schema.providerExecutions.status, ["PENDING", input.status])
        )
      );
    if (input.status === "TERMINAL_FAILURE") {
      const startedAt = performance.now();
      await tx
        .update(schema.aiStories)
        .set({ status: "failed", updatedAt: new Date(input.completedAt) })
        .where(
          and(
            eq(schema.aiStories.id, input.storyId),
            inArray(schema.aiStories.status, ["generating", "failed"])
          )
        );
      failurePersistMs = performance.now() - startedAt;
    }
  });
  return { usagePersistMs, costPersistMs, failurePersistMs };
}
