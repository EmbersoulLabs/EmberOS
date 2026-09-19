import { and, eq, gt, sql } from "drizzle-orm";
import {
  AI_STORY_PROVIDER_RUNTIME_VERSION,
  AiStoryProviderAttemptBindingSchema,
  CanonicalProviderResultSchema,
  ProviderCostSchema,
  ProviderUsageSchema,
  WorkerExecutionResultSchema,
  isAiStoryProviderAttemptTransitionAllowed,
  type CanonicalProviderResult,
  type ProviderCost,
  type ProviderUsage,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type TerminalAuthorityReader = Pick<Transaction, "select">;

export interface SuccessfulProviderAttemptTerminalAuthority {
  readonly contractVersion: "1" | typeof AI_STORY_PROVIDER_RUNTIME_VERSION;
  readonly providerAttemptId: string;
  readonly providerExecutionId: string;
  readonly sceneExecutionId: string;
  readonly outboxJobId: string;
}

export class ProviderExecutionFinalizationError extends Error {
  readonly code = "PROVIDER_EXECUTION_FINALIZATION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "ProviderExecutionFinalizationError";
  }
}

export interface ProviderExecutionFinalizationInput {
  readonly jobId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly workerId: string;
  readonly providerId: string;
  readonly adapterVersion: string;
  readonly result: CanonicalProviderResult;
  readonly dispatchTimestamp: string;
  readonly executionDurationMs: number;
  readonly completionMetadata?: Readonly<Record<string, unknown>>;
  readonly now?: Date;
}

export interface ProviderExecutionFinalizationRecord {
  readonly executionId: string;
  readonly attemptId: string;
  readonly jobId: string;
  readonly workerId: string;
  readonly result: CanonicalProviderResult;
  readonly completedAt: string;
  readonly completionMetadata: Readonly<Record<string, unknown>>;
  readonly terminalKind?: "SUCCEEDED";
}

export interface ProviderExecutionTerminalFailureInput {
  readonly jobId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly workerId: string;
  readonly providerId: string;
  readonly adapterVersion: string;
  readonly failureCode: string;
  readonly failureReason: string;
  readonly resultReference: string;
  readonly requestHash: string;
  readonly responseHash: string;
  readonly dispatchTimestamp: string;
  readonly executionDurationMs: number;
  readonly usage?: ProviderUsage;
  readonly cost?: ProviderCost;
  readonly completionMetadata?: Readonly<Record<string, unknown>>;
  readonly now?: Date;
}

export interface ProviderExecutionTerminalFailureRecord {
  readonly executionId: string;
  readonly attemptId: string;
  readonly jobId: string;
  readonly workerId: string;
  readonly terminalKind: "TERMINAL_FAILURE";
  readonly failureCode: string;
  readonly resultReference: string;
  readonly responseHash: string;
  readonly completedAt: string;
  readonly completionMetadata: Readonly<Record<string, unknown>>;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function providerAttemptUsesCurrentAiStoryTerminalEvidence(input: {
  readonly contractVersion: string;
  readonly status: string;
}): boolean {
  if (input.contractVersion === "1") {
    if (input.status !== "SUCCEEDED") {
      throw new ProviderExecutionFinalizationError(
        "Only a successful legacy Provider attempt may be finalized"
      );
    }
    return false;
  }
  if (input.contractVersion === AI_STORY_PROVIDER_RUNTIME_VERSION) {
    if (input.status !== "PENDING") {
      throw new ProviderExecutionFinalizationError(
        "Current AI Story Provider attempt has an unsupported persisted status"
      );
    }
    return true;
  }
  throw new ProviderExecutionFinalizationError(
    `Unsupported Provider Attempt contract version: ${input.contractVersion}`
  );
}

/**
 * Read-only, version-aware authority for releasing a Scene after a successful
 * Provider result. Current AI Story attempts deliberately remain PENDING: the
 * accepted execution, immutable Worker evidence, and completed Outbox are the
 * terminal authority. Historical v1 attempts retain their SUCCEEDED contract.
 */
export async function resolveSuccessfulProviderAttemptTerminalAuthority(input: {
  readonly reader: TerminalAuthorityReader;
  readonly providerAttemptId: string;
  readonly providerExecutionId: string;
  readonly sceneExecutionId: string;
}): Promise<SuccessfulProviderAttemptTerminalAuthority | null> {
  const { reader } = input;
  const [attempt] = await reader
    .select()
    .from(schema.providerAttempts)
    .where(
      and(
        eq(schema.providerAttempts.attemptId, input.providerAttemptId),
        eq(schema.providerAttempts.executionId, input.providerExecutionId)
      )
    )
    .limit(1);
  if (!attempt) return null;

  const [execution] = await reader
    .select()
    .from(schema.providerExecutions)
    .where(eq(schema.providerExecutions.executionId, input.providerExecutionId))
    .limit(1);
  const acceptedResult = CanonicalProviderResultSchema.safeParse(
    execution?.acceptedResult
  );
  if (
    !execution ||
    execution.status !== "SUCCEEDED" ||
    execution.acceptedAttemptId !== input.providerAttemptId ||
    !acceptedResult.success ||
    acceptedResult.data.executionId !== input.providerExecutionId ||
    acceptedResult.data.providerAttemptId !== input.providerAttemptId ||
    acceptedResult.data.requestHash !== attempt.requestHash
  ) {
    return null;
  }

  if (attempt.contractVersion === "1") {
    if (attempt.status !== "SUCCEEDED") return null;
    const jobs = await reader
      .select()
      .from(schema.providerOutboxJobs)
      .where(eq(schema.providerOutboxJobs.executionId, input.providerExecutionId));
    const completed = jobs.filter((job) => job.status === "COMPLETED");
    if (jobs.length !== 1 || completed.length !== 1) return null;
    return {
      contractVersion: "1",
      providerAttemptId: attempt.attemptId,
      providerExecutionId: attempt.executionId,
      sceneExecutionId: input.sceneExecutionId,
      outboxJobId: completed[0]!.jobId,
    };
  }

  if (
    attempt.contractVersion !== AI_STORY_PROVIDER_RUNTIME_VERSION ||
    attempt.status !== "PENDING"
  ) {
    return null;
  }

  const bindingRows = await reader
    .select()
    .from(schema.aiStoryProviderAttemptCompiledBindings)
    .where(
      eq(
        schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId,
        input.providerAttemptId
      )
    );
  const parsedBinding = bindingRows.length === 1
    ? AiStoryProviderAttemptBindingSchema.safeParse(bindingRows[0]!.binding)
    : null;
  if (!parsedBinding?.success) return null;
  const binding = parsedBinding.data;
  if (
    binding.providerAttemptId !== input.providerAttemptId ||
    binding.providerExecutionId !== input.providerExecutionId ||
    binding.sceneExecutionId !== input.sceneExecutionId ||
    binding.contractVersion !== AI_STORY_PROVIDER_RUNTIME_VERSION ||
    !binding.providerTaskId ||
    binding.providerTaskId !== attempt.providerRequestId ||
    !["POST_GENERATION_QC_PENDING", "SUCCEEDED"].includes(binding.status) ||
    bindingRows[0]!.requestFingerprint !== binding.requestFingerprint ||
    bindingRows[0]!.status !== binding.status
  ) {
    return null;
  }

  const [compiled] = await reader
    .select()
    .from(schema.aiStoryCompiledProviderRequests)
    .where(
      eq(
        schema.aiStoryCompiledProviderRequests.compiledRequestId,
        binding.compiledRequestId
      )
    )
    .limit(1);
  if (
    !compiled ||
    compiled.sceneExecutionId !== input.sceneExecutionId ||
    compiled.requestFingerprint !== binding.requestFingerprint
  ) {
    return null;
  }

  const workerRows = await reader
    .select()
    .from(schema.aiStoryWorkerExecutionResults)
    .where(
      eq(
        schema.aiStoryWorkerExecutionResults.providerAttemptId,
        input.providerAttemptId
      )
    );
  const parsedWorker = workerRows.length === 1
    ? WorkerExecutionResultSchema.safeParse(workerRows[0]!.result)
    : null;
  if (!parsedWorker?.success) return null;
  const worker = parsedWorker.data;
  if (
    worker.providerExecutionId !== input.providerExecutionId ||
    worker.providerAttemptId !== input.providerAttemptId ||
    worker.providerRequestId !== binding.providerTaskId ||
    worker.workerState !== "TERMINAL_SUCCESS" ||
    worker.acceptanceClassification !== "ACCEPTED" ||
    worker.canonicalProviderState !== "SUCCEEDED" ||
    worker.reconciliationRequired
  ) {
    return null;
  }

  const observations = await reader
    .select()
    .from(schema.aiStoryWorkerAttemptObservations)
    .where(
      eq(
        schema.aiStoryWorkerAttemptObservations.providerAttemptId,
        input.providerAttemptId
      )
    );
  const accepted = observations.filter(
    (observation) => observation.observationKind === "ACCEPTED"
  );
  if (
    accepted.length !== 1 ||
    accepted[0]!.providerExecutionId !== input.providerExecutionId ||
    accepted[0]!.providerRequestId !== binding.providerTaskId ||
    accepted[0]!.outboxJobId !== worker.outboxJobId ||
    observations.some(
      (observation) =>
        observation.reconciliationRequired ||
        (observation.providerRequestId &&
          observation.providerRequestId !== binding.providerTaskId) ||
        ["NOT_ACCEPTED", "ACCEPTANCE_UNKNOWN"].includes(
          observation.observationKind
        )
    )
  ) {
    return null;
  }

  if (binding.commercialReservationId) {
    const [reservation] = await reader
      .select()
      .from(schema.certificationCommercialReservations)
      .where(
        eq(
          schema.certificationCommercialReservations.certificationReservationId,
          binding.commercialReservationId
        )
      )
      .limit(1);
    if (
      !reservation ||
      reservation.executionIdentity !== input.providerAttemptId ||
      reservation.orgId !== binding.orgId ||
      reservation.workspaceId !== binding.workspaceId ||
      reservation.status !== "SETTLED" ||
      reservation.settledCostUsd === null
    ) {
      return null;
    }
  }

  const [job] = await reader
    .select()
    .from(schema.providerOutboxJobs)
    .where(eq(schema.providerOutboxJobs.jobId, worker.outboxJobId))
    .limit(1);
  if (
    !job ||
    job.executionId !== input.providerExecutionId ||
    job.status !== "COMPLETED"
  ) {
    return null;
  }

  return {
    contractVersion: AI_STORY_PROVIDER_RUNTIME_VERSION,
    providerAttemptId: attempt.attemptId,
    providerExecutionId: attempt.executionId,
    sceneExecutionId: input.sceneExecutionId,
    outboxJobId: job.jobId,
  };
}

async function assertCurrentAiStoryTerminalEvidence(input: {
  readonly tx: Transaction;
  readonly attempt: typeof schema.providerAttempts.$inferSelect;
  readonly finalization: ProviderExecutionFinalizationInput;
  readonly result: CanonicalProviderResult;
}): Promise<void> {
  const { tx, attempt, finalization, result } = input;
  const providerRequestId = result.providerMetadata.providerRequestId;
  if (
    attempt.providerMetadata?.source !== "ai-story-worker-pre-adapter-authority" ||
    !providerRequestId ||
    attempt.providerRequestId !== providerRequestId
  ) {
    throw new ProviderExecutionFinalizationError(
      "Current AI Story Provider Attempt lacks accepted task authority"
    );
  }

  const bindingRows = await tx
    .select()
    .from(schema.aiStoryProviderAttemptCompiledBindings)
    .where(
      eq(
        schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId,
        attempt.attemptId
      )
    );
  const binding = bindingRows.length === 1
    ? AiStoryProviderAttemptBindingSchema.parse(bindingRows[0]!.binding)
    : null;
  if (
    !binding ||
    binding.providerExecutionId !== finalization.executionId ||
    binding.providerTaskId !== providerRequestId ||
    !["SUBMITTED", "RUNNING", "PROVIDER_RESULT_READY", "POST_GENERATION_QC_PENDING", "SUCCEEDED"].includes(
      binding.status
    )
  ) {
    throw new ProviderExecutionFinalizationError(
      "AI Story compiled/Attempt/task binding conflicts with finalization"
    );
  }

  const [compiled] = await tx
    .select()
    .from(schema.aiStoryCompiledProviderRequests)
    .where(
      eq(
        schema.aiStoryCompiledProviderRequests.compiledRequestId,
        binding.compiledRequestId
      )
    )
    .limit(1);
  if (
    !compiled ||
    compiled.sceneExecutionId !== binding.sceneExecutionId ||
    compiled.requestFingerprint !== binding.requestFingerprint ||
    compiled.orgId !== binding.orgId ||
    compiled.workspaceId !== binding.workspaceId ||
    compiled.providerId !== attempt.providerId ||
    compiled.modelId !== attempt.modelVersion
  ) {
    throw new ProviderExecutionFinalizationError(
      "AI Story compiled request authority conflicts with finalization"
    );
  }

  const [reservation] = binding.commercialReservationId
    ? await tx
        .select()
        .from(schema.certificationCommercialReservations)
        .where(
          eq(
            schema.certificationCommercialReservations.certificationReservationId,
            binding.commercialReservationId
          )
        )
        .limit(1)
    : [];
  if (
    !reservation ||
    reservation.executionIdentity !== attempt.attemptId ||
    reservation.orgId !== binding.orgId ||
    reservation.workspaceId !== binding.workspaceId ||
    reservation.status !== "SETTLED" ||
    reservation.settledCostUsd === null
  ) {
    throw new ProviderExecutionFinalizationError(
      "AI Story reservation authority conflicts with finalization"
    );
  }

  const observations = await tx
    .select()
    .from(schema.aiStoryWorkerAttemptObservations)
    .where(
      eq(
        schema.aiStoryWorkerAttemptObservations.providerAttemptId,
        attempt.attemptId
      )
    );
  const accepted = observations.filter(
    (row) => row.observationKind === "ACCEPTED"
  );
  if (
    accepted.length !== 1 ||
    accepted[0]!.providerExecutionId !== finalization.executionId ||
    accepted[0]!.providerRequestId !== providerRequestId ||
    accepted[0]!.outboxJobId !== finalization.jobId ||
    observations.some(
      (row) =>
        row.reconciliationRequired ||
        (row.providerRequestId && row.providerRequestId !== providerRequestId) ||
        ["NOT_ACCEPTED", "ACCEPTANCE_UNKNOWN"].includes(row.observationKind)
    )
  ) {
    throw new ProviderExecutionFinalizationError(
      "AI Story Adapter observations conflict with successful finalization"
    );
  }

  const workerRows = await tx
    .select()
    .from(schema.aiStoryWorkerExecutionResults)
    .where(
      eq(
        schema.aiStoryWorkerExecutionResults.providerAttemptId,
        attempt.attemptId
      )
    );
  const worker = workerRows.length === 1
    ? WorkerExecutionResultSchema.parse(workerRows[0]!.result)
    : null;
  if (
    !worker ||
    worker.providerExecutionId !== finalization.executionId ||
    worker.providerAttemptId !== attempt.attemptId ||
    worker.providerRequestId !== providerRequestId ||
    worker.outboxJobId !== finalization.jobId ||
    worker.providerId !== attempt.providerId ||
    worker.workerState !== "TERMINAL_SUCCESS" ||
    worker.acceptanceClassification !== "ACCEPTED" ||
    worker.canonicalProviderState !== "SUCCEEDED" ||
    worker.reconciliationRequired ||
    worker.normalizedResultReference !== result.resultReference
  ) {
    throw new ProviderExecutionFinalizationError(
      "AI Story Worker Result conflicts with successful finalization"
    );
  }
}

async function advanceCurrentAiStoryBindingToPostQcPending(input: {
  readonly tx: Transaction;
  readonly attemptId: string;
  readonly updatedAt: Date;
}): Promise<void> {
  const [row] = await input.tx
    .select()
    .from(schema.aiStoryProviderAttemptCompiledBindings)
    .where(
      eq(
        schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId,
        input.attemptId
      )
    )
    .limit(1);
  const current = row
    ? AiStoryProviderAttemptBindingSchema.parse(row.binding)
    : null;
  if (!current) {
    throw new ProviderExecutionFinalizationError(
      "AI Story compiled Attempt binding is missing during finalization"
    );
  }
  if (["POST_GENERATION_QC_PENDING", "SUCCEEDED"].includes(current.status)) {
    return;
  }

  const resultReady = AiStoryProviderAttemptBindingSchema.parse({
    ...current,
    status: "PROVIDER_RESULT_READY",
    updatedAt: input.updatedAt.toISOString(),
  });
  if (!isAiStoryProviderAttemptTransitionAllowed(current.status, resultReady.status)) {
    throw new ProviderExecutionFinalizationError(
      `AI Story Attempt cannot enter terminal-media authority from ${current.status}`
    );
  }
  const postQcPending = AiStoryProviderAttemptBindingSchema.parse({
    ...resultReady,
    status: "POST_GENERATION_QC_PENDING",
  });
  if (!isAiStoryProviderAttemptTransitionAllowed(resultReady.status, postQcPending.status)) {
    throw new ProviderExecutionFinalizationError(
      "AI Story Attempt cannot enter Post-Generation QC authority"
    );
  }
  await input.tx
    .update(schema.aiStoryProviderAttemptCompiledBindings)
    .set({
      status: postQcPending.status,
      binding: postQcPending,
      updatedAt: input.updatedAt,
    })
    .where(
      and(
        eq(
          schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId,
          input.attemptId
        ),
        eq(schema.aiStoryProviderAttemptCompiledBindings.status, current.status)
      )
    );
}

export class ProviderExecutionFinalizationRepository {
  constructor(private readonly db: Db = getDb()) {}

  async finalize(
    input: ProviderExecutionFinalizationInput
  ): Promise<ProviderExecutionFinalizationRecord> {
    if (!input.workerId.trim()) {
      throw new ProviderExecutionFinalizationError("workerId is required");
    }
    if (!Number.isFinite(input.executionDurationMs) || input.executionDurationMs < 0) {
      throw new ProviderExecutionFinalizationError(
        "executionDurationMs must be non-negative"
      );
    }
    const result = CanonicalProviderResultSchema.parse(input.result);
    const usage = ProviderUsageSchema.parse(result.usage);
    const cost = ProviderCostSchema.parse(result.cost);
    const now = input.now ?? new Date();
    const completionMetadata = {
      providerId: input.providerId,
      adapterVersion: input.adapterVersion,
      dispatchTimestamp: input.dispatchTimestamp,
      executionDurationMs: input.executionDurationMs,
      ...(input.completionMetadata ?? {}),
    };

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        select ${schema.providerExecutions.executionId}
        from ${schema.providerExecutions}
        where ${schema.providerExecutions.executionId} = ${input.executionId}
        for update
      `);
      await tx.execute(sql`
        select ${schema.providerOutboxJobs.jobId}
        from ${schema.providerOutboxJobs}
        where ${schema.providerOutboxJobs.jobId} = ${input.jobId}
        for update
      `);

      const [execution] = await tx
        .select()
        .from(schema.providerExecutions)
        .where(eq(schema.providerExecutions.executionId, input.executionId))
        .limit(1);
      if (!execution) {
        throw new ProviderExecutionFinalizationError("Provider execution not found");
      }
      if (
        execution.acceptedResult ||
        execution.status === "SUCCEEDED" ||
        execution.status === "TERMINAL_FAILURE"
      ) {
        throw new ProviderExecutionFinalizationError(
          "Provider execution is already finalized"
        );
      }

      const [attempt] = await tx
        .select()
        .from(schema.providerAttempts)
        .where(
          and(
            eq(schema.providerAttempts.attemptId, input.attemptId),
            eq(schema.providerAttempts.executionId, input.executionId)
          )
        )
        .limit(1);
      if (!attempt) {
        throw new ProviderExecutionFinalizationError(
          "Provider attempt does not belong to execution"
        );
      }
      const usesCurrentAiStoryEvidence =
        providerAttemptUsesCurrentAiStoryTerminalEvidence(attempt);
      if (usesCurrentAiStoryEvidence) {
        await assertCurrentAiStoryTerminalEvidence({
          tx,
          attempt,
          finalization: input,
          result,
        });
        await advanceCurrentAiStoryBindingToPostQcPending({
          tx,
          attemptId: attempt.attemptId,
          updatedAt: now,
        });
      }
      if (
        result.executionId !== input.executionId ||
        result.providerAttemptId !== input.attemptId ||
        execution.requestHash !== result.requestHash ||
        attempt.requestHash !== result.requestHash ||
        (!usesCurrentAiStoryEvidence && attempt.responseHash !== result.responseHash) ||
        attempt.providerId !== input.providerId ||
        attempt.providerId !== result.providerMetadata.providerId ||
        attempt.providerVersion !== result.providerMetadata.providerVersion ||
        attempt.modelVersion !== result.modelVersion
      ) {
        throw new ProviderExecutionFinalizationError(
          "Dispatch result conflicts with Ledger execution or attempt"
        );
      }

      const [job] = await tx
        .select()
        .from(schema.providerOutboxJobs)
        .where(eq(schema.providerOutboxJobs.jobId, input.jobId))
        .limit(1);
      if (
        !job ||
        job.executionId !== input.executionId ||
        job.status !== "CLAIMED" ||
        job.leaseOwner !== input.workerId ||
        !job.leaseExpiresAt ||
        job.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        throw new ProviderExecutionFinalizationError(
          "Active Outbox lease is required for finalization"
        );
      }

      const usageRows = await tx
        .insert(schema.providerAttemptUsage)
        .values({ attemptId: input.attemptId, usage })
        .onConflictDoNothing()
        .returning();
      if (!usageRows[0]) {
        const [existing] = await tx
          .select()
          .from(schema.providerAttemptUsage)
          .where(eq(schema.providerAttemptUsage.attemptId, input.attemptId))
          .limit(1);
        if (!existing || !sameJson(existing.usage, usage)) {
          throw new ProviderExecutionFinalizationError(
            "Provider usage conflicts with persisted facts"
          );
        }
      }

      const costRows = await tx
        .insert(schema.providerAttemptCosts)
        .values({ attemptId: input.attemptId, cost })
        .onConflictDoNothing()
        .returning();
      if (!costRows[0]) {
        const [existing] = await tx
          .select()
          .from(schema.providerAttemptCosts)
          .where(eq(schema.providerAttemptCosts.attemptId, input.attemptId))
          .limit(1);
        if (!existing || !sameJson(existing.cost, cost)) {
          throw new ProviderExecutionFinalizationError(
            "Provider cost conflicts with persisted facts"
          );
        }
      }

      const accepted = await tx
        .update(schema.providerExecutions)
        .set({
          status: "SUCCEEDED",
          acceptedAttemptId: input.attemptId,
          acceptedResult: result,
          acceptedResponseHash: result.responseHash,
          acceptedAt: now,
          completedAt: now,
        })
        .where(
          and(
            eq(schema.providerExecutions.executionId, input.executionId),
            sql`${schema.providerExecutions.acceptedResult} is null`
          )
        )
        .returning({ executionId: schema.providerExecutions.executionId });
      if (!accepted[0]) {
        throw new ProviderExecutionFinalizationError(
          "Concurrent Provider result acceptance conflict"
        );
      }

      const completed = await tx
        .update(schema.providerOutboxJobs)
        .set({
          status: "COMPLETED",
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: now,
          completionWorkerId: input.workerId,
          completionMetadata,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.providerOutboxJobs.jobId, input.jobId),
            eq(schema.providerOutboxJobs.executionId, input.executionId),
            eq(schema.providerOutboxJobs.status, "CLAIMED"),
            eq(schema.providerOutboxJobs.leaseOwner, input.workerId),
            gt(schema.providerOutboxJobs.leaseExpiresAt, now)
          )
        )
        .returning({ jobId: schema.providerOutboxJobs.jobId });
      if (!completed[0]) {
        throw new ProviderExecutionFinalizationError(
          "Concurrent Outbox completion conflict"
        );
      }

      return {
        executionId: input.executionId,
        attemptId: input.attemptId,
        jobId: input.jobId,
        workerId: input.workerId,
        result,
        completedAt: now.toISOString(),
        completionMetadata,
        terminalKind: "SUCCEEDED" as const,
      };
    });
  }

  /**
   * Tx A terminal failure path — sole Production Finalizer authority.
   * Writes attempt-bound TERMINAL_FAILURE, DEAD_LETTER, and truthful usage/cost.
   * Does NOT invent cost amount 0 when cost is unknown.
   */
  async finalizeTerminalFailure(
    input: ProviderExecutionTerminalFailureInput
  ): Promise<ProviderExecutionTerminalFailureRecord> {
    if (!input.workerId.trim()) {
      throw new ProviderExecutionFinalizationError("workerId is required");
    }
    if (!input.failureCode.trim() || !input.failureReason.trim()) {
      throw new ProviderExecutionFinalizationError(
        "failureCode and failureReason are required"
      );
    }
    if (!input.resultReference.trim()) {
      throw new ProviderExecutionFinalizationError("resultReference is required");
    }
    if (!Number.isFinite(input.executionDurationMs) || input.executionDurationMs < 0) {
      throw new ProviderExecutionFinalizationError(
        "executionDurationMs must be non-negative"
      );
    }
    const now = input.now ?? new Date();
    const completionMetadata = {
      providerId: input.providerId,
      adapterVersion: input.adapterVersion,
      dispatchTimestamp: input.dispatchTimestamp,
      executionDurationMs: input.executionDurationMs,
      terminalKind: "TERMINAL_FAILURE",
      failureCode: input.failureCode,
      failureReason: input.failureReason,
      resultReference: input.resultReference,
      responseHash: input.responseHash,
      requestHash: input.requestHash,
      ...(input.completionMetadata ?? {}),
    };

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        select ${schema.providerExecutions.executionId}
        from ${schema.providerExecutions}
        where ${schema.providerExecutions.executionId} = ${input.executionId}
        for update
      `);
      await tx.execute(sql`
        select ${schema.providerOutboxJobs.jobId}
        from ${schema.providerOutboxJobs}
        where ${schema.providerOutboxJobs.jobId} = ${input.jobId}
        for update
      `);

      const [execution] = await tx
        .select()
        .from(schema.providerExecutions)
        .where(eq(schema.providerExecutions.executionId, input.executionId))
        .limit(1);
      if (!execution) {
        throw new ProviderExecutionFinalizationError("Provider execution not found");
      }
      if (execution.status === "SUCCEEDED" || execution.acceptedResult) {
        throw new ProviderExecutionFinalizationError(
          "Provider execution is already successfully finalized"
        );
      }
      if (execution.status === "TERMINAL_FAILURE") {
        throw new ProviderExecutionFinalizationError(
          "Provider execution is already finalized"
        );
      }

      const [attempt] = await tx
        .select()
        .from(schema.providerAttempts)
        .where(
          and(
            eq(schema.providerAttempts.attemptId, input.attemptId),
            eq(schema.providerAttempts.executionId, input.executionId)
          )
        )
        .limit(1);
      if (!attempt) {
        throw new ProviderExecutionFinalizationError(
          "Provider attempt does not belong to execution"
        );
      }
      if (attempt.status !== "TERMINAL_FAILURE") {
        throw new ProviderExecutionFinalizationError(
          "Only a TERMINAL_FAILURE Provider attempt may be failure-finalized"
        );
      }
      if (
        attempt.providerId !== input.providerId ||
        attempt.requestHash !== input.requestHash ||
        (attempt.responseHash && attempt.responseHash !== input.responseHash)
      ) {
        throw new ProviderExecutionFinalizationError(
          "Failure finalization conflicts with Ledger attempt facts"
        );
      }

      const [job] = await tx
        .select()
        .from(schema.providerOutboxJobs)
        .where(eq(schema.providerOutboxJobs.jobId, input.jobId))
        .limit(1);
      if (
        !job ||
        job.executionId !== input.executionId ||
        job.status !== "CLAIMED" ||
        job.leaseOwner !== input.workerId ||
        !job.leaseExpiresAt ||
        job.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        throw new ProviderExecutionFinalizationError(
          "Active Outbox lease is required for finalization"
        );
      }

      const usage = ProviderUsageSchema.parse(input.usage ?? {});
      const cost = ProviderCostSchema.parse(
        input.cost ?? {
          amount: null,
          currency: "USD",
          estimated: true,
          costSource: "UNKNOWN",
        }
      );
      const usageRows = await tx
        .insert(schema.providerAttemptUsage)
        .values({ attemptId: input.attemptId, usage })
        .onConflictDoNothing()
        .returning();
      if (!usageRows[0]) {
        const [existing] = await tx
          .select()
          .from(schema.providerAttemptUsage)
          .where(eq(schema.providerAttemptUsage.attemptId, input.attemptId))
          .limit(1);
        if (!existing || !sameJson(existing.usage, usage)) {
          throw new ProviderExecutionFinalizationError(
            "Provider usage conflicts with persisted facts"
          );
        }
      }

      const costRows = await tx
        .insert(schema.providerAttemptCosts)
        .values({ attemptId: input.attemptId, cost })
        .onConflictDoNothing()
        .returning();
      if (!costRows[0]) {
        const [existing] = await tx
          .select()
          .from(schema.providerAttemptCosts)
          .where(eq(schema.providerAttemptCosts.attemptId, input.attemptId))
          .limit(1);
        if (!existing || !sameJson(existing.cost, cost)) {
          throw new ProviderExecutionFinalizationError(
            "Provider cost conflicts with persisted facts"
          );
        }
      }

      const terminalized = await tx
        .update(schema.providerExecutions)
        .set({
          status: "TERMINAL_FAILURE",
          acceptedAttemptId: input.attemptId,
          acceptedResult: null,
          acceptedResponseHash: input.responseHash,
          acceptedAt: now,
          completedAt: now,
        })
        .where(
          and(
            eq(schema.providerExecutions.executionId, input.executionId),
            sql`${schema.providerExecutions.status} <> 'SUCCEEDED'`,
            sql`${schema.providerExecutions.status} <> 'TERMINAL_FAILURE'`,
            sql`${schema.providerExecutions.acceptedResult} is null`
          )
        )
        .returning({ executionId: schema.providerExecutions.executionId });
      if (!terminalized[0]) {
        throw new ProviderExecutionFinalizationError(
          "Concurrent Provider terminal failure conflict"
        );
      }

      const deadLettered = await tx
        .update(schema.providerOutboxJobs)
        .set({
          status: "DEAD_LETTER",
          leaseOwner: null,
          leaseExpiresAt: null,
          deadLetterReason: `${input.failureCode}: ${input.failureReason}`,
          deadLetterAt: now,
          completionWorkerId: input.workerId,
          completionMetadata,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.providerOutboxJobs.jobId, input.jobId),
            eq(schema.providerOutboxJobs.executionId, input.executionId),
            eq(schema.providerOutboxJobs.status, "CLAIMED"),
            eq(schema.providerOutboxJobs.leaseOwner, input.workerId),
            gt(schema.providerOutboxJobs.leaseExpiresAt, now)
          )
        )
        .returning({ jobId: schema.providerOutboxJobs.jobId });
      if (!deadLettered[0]) {
        throw new ProviderExecutionFinalizationError(
          "Concurrent Outbox dead-letter conflict"
        );
      }

      return {
        executionId: input.executionId,
        attemptId: input.attemptId,
        jobId: input.jobId,
        workerId: input.workerId,
        terminalKind: "TERMINAL_FAILURE" as const,
        failureCode: input.failureCode,
        resultReference: input.resultReference,
        responseHash: input.responseHash,
        completedAt: now.toISOString(),
        completionMetadata,
      };
    });
  }
}
