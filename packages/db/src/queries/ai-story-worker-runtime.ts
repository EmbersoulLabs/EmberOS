/**
 * Sprint 3 PR 3.3 — Worker runtime persistence + validated Dispatch bundle loading.
 * Validates ownership/correlation/envelope/routing before Adapter invocation.
 * Does not finalize, write usage/cost, or unlock execution.
 *
 * PR 3.7 Phase C remediation (MODEL A):
 * - Non-terminal Adapter outcomes → append-only Worker Attempt Observations
 * - Terminal normalized evidence → immutable insert-only WorkerExecutionResult
 * - Never DELETE / UPDATE / replace accepted WorkerExecutionResult rows
 */
import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
  AI_STORY_PROVIDER_RUNTIME_VERSION,
  AiStoryCompiledProviderRequestSchema,
  AiStoryProviderAttemptBindingSchema,
  PersistedSceneRoutingDecisionSchema,
  RuntimeAuthorizedFactSchema,
  SCENE_ROUTER_VERSION,
  SceneProviderSchedulingCorrelationSchema,
  WorkerExecutionResultSchema,
  validateExecutionDispatch,
  validateExecutionEnvelope,
  type ExecutionDispatch,
  type ExecutionEnvelope,
  type PersistedSceneRoutingDecision,
  type RuntimeAuthorizedFact,
  type SceneProviderSchedulingCorrelation,
  type WorkerExecutionResult,
  type CanonicalProviderState,
  type ProviderAcceptanceClassification,
} from "@ceo-agent/shared";
import { getDb } from "../client";
import * as schema from "../schema/index";
import {
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
} from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;

export class WorkerRuntimePersistenceError extends Error {
  readonly code:
    | "WORKER_DISPATCH_INVALID"
    | "WORKER_ENVELOPE_INVALID"
    | "WORKER_ROUTING_BINDING_INVALID"
    | "WORKER_ATTEMPT_CONFLICT"
    | "OWNERSHIP_INTEGRITY_VIOLATION"
    | "IDENTITY_CONFLICT";

  constructor(code: WorkerRuntimePersistenceError["code"], message: string) {
    super(message);
    this.name = "WorkerRuntimePersistenceError";
    this.code = code;
  }
}

export type WorkerValidatedBundleRow = {
  readonly dispatch: ExecutionDispatch;
  readonly outboxJobId: string;
  readonly providerExecutionId: string;
  readonly envelope: ExecutionEnvelope;
  readonly correlation: SceneProviderSchedulingCorrelation;
  readonly routingDecision: PersistedSceneRoutingDecision;
  readonly runtimeAuthorization: RuntimeAuthorizedFact;
  readonly registrySnapshotHash: string;
};

export class SceneProviderWorkerRuntimeRepository {
  constructor(private readonly db: Db = getDb()) {}

  async loadValidatedBundleByDispatchId(
    dispatchId: string
  ): Promise<WorkerValidatedBundleRow | null> {
    const [dispatchRow] = await this.db
      .select()
      .from(schema.providerExecutionDispatches)
      .where(eq(schema.providerExecutionDispatches.dispatchId, dispatchId))
      .limit(1);
    if (!dispatchRow) return null;

    const dispatch = await validateExecutionDispatch(toDispatch(dispatchRow));

    const [outboxRow] = await this.db
      .select()
      .from(schema.providerOutboxJobs)
      .where(eq(schema.providerOutboxJobs.jobId, dispatch.jobId))
      .limit(1);
    if (!outboxRow) {
      throw new WorkerRuntimePersistenceError(
        "WORKER_DISPATCH_INVALID",
        "Outbox Job for Dispatch does not exist"
      );
    }
    if (outboxRow.executionId !== dispatch.executionId) {
      throw new WorkerRuntimePersistenceError(
        "WORKER_DISPATCH_INVALID",
        "Outbox Job does not belong to Dispatch Provider Execution"
      );
    }

    const [envelopeRow] = await this.db
      .select()
      .from(schema.providerExecutionEnvelopes)
      .where(eq(schema.providerExecutionEnvelopes.envelopeId, dispatch.envelopeId))
      .limit(1);
    if (!envelopeRow) {
      throw new WorkerRuntimePersistenceError(
        "WORKER_ENVELOPE_INVALID",
        "Execution Envelope for Dispatch does not exist"
      );
    }
    const envelope = await validateExecutionEnvelope(toEnvelope(envelopeRow));

    const [correlationRow] = await this.db
      .select()
      .from(schema.aiStorySceneSchedulingCorrelations)
      .where(
        eq(schema.aiStorySceneSchedulingCorrelations.outboxJobId, dispatch.jobId)
      )
      .limit(1);
    if (!correlationRow) {
      // Soft miss: Dispatch may belong to generic Provider path (not AI Story Scene).
      return null;
    }
    const correlation = SceneProviderSchedulingCorrelationSchema.parse(
      correlationRow.correlation
    );

    if (
      correlation.providerExecutionId !== dispatch.executionId ||
      correlation.envelopeId !== envelope.envelopeId ||
      correlation.requestHash !== envelope.requestHash ||
      correlation.envelopeHash !== envelope.envelopeHash ||
      correlation.requestHash !== dispatch.requestHash
    ) {
      throw new WorkerRuntimePersistenceError(
        "WORKER_ENVELOPE_INVALID",
        "Envelope/request hash does not match scheduling correlation"
      );
    }

    const [routingRow] = await this.db
      .select()
      .from(schema.aiStorySceneRoutingDecisions)
      .where(
        eq(
          schema.aiStorySceneRoutingDecisions.routingDecisionId,
          correlation.routingDecisionId
        )
      )
      .limit(1);
    if (!routingRow) {
      throw new WorkerRuntimePersistenceError(
        "WORKER_ROUTING_BINDING_INVALID",
        "Routing Decision for correlation does not exist"
      );
    }
    const routingDecision = PersistedSceneRoutingDecisionSchema.parse(
      routingRow.decision
    );
    if (
      routingDecision.sceneExecutionId !== correlation.sceneExecutionId ||
      routingDecision.runtimeAuthorizationId !==
        correlation.runtimeAuthorizationId ||
      routingDecision.deterministicIntegrityHash !==
        correlation.routingDecisionHash ||
      routingDecision.routerVersion !== SCENE_ROUTER_VERSION
    ) {
      throw new WorkerRuntimePersistenceError(
        "WORKER_ROUTING_BINDING_INVALID",
        "Routing Decision does not match Scene correlation"
      );
    }

    const [authRow] = await this.db
      .select()
      .from(schema.aiStoryRuntimeAuthorizedFacts)
      .where(
        eq(
          schema.aiStoryRuntimeAuthorizedFacts.runtimeAuthorizationId,
          correlation.runtimeAuthorizationId
        )
      )
      .limit(1);
    if (!authRow) {
      throw new WorkerRuntimePersistenceError(
        "OWNERSHIP_INTEGRITY_VIOLATION",
        "RuntimeAuthorizedFact for correlation does not exist"
      );
    }
    const runtimeAuthorization = RuntimeAuthorizedFactSchema.parse(authRow.fact);
    if (
      runtimeAuthorization.executionPlanId !== correlation.executionPlanId ||
      runtimeAuthorization.deterministicIntegrityHash !==
        correlation.authorizationHash ||
      !runtimeAuthorization.orderedSceneExecutionIds.includes(
        correlation.sceneExecutionId
      )
    ) {
      throw new WorkerRuntimePersistenceError(
        "OWNERSHIP_INTEGRITY_VIOLATION",
        "RuntimeAuthorizedFact does not cover the Scene correlation"
      );
    }

    assertOwnershipChain(
      dispatch,
      envelope,
      correlation,
      routingDecision,
      runtimeAuthorization
    );

    return {
      dispatch,
      outboxJobId: dispatch.jobId,
      providerExecutionId: dispatch.executionId,
      envelope,
      correlation,
      routingDecision,
      runtimeAuthorization,
      registrySnapshotHash: routingDecision.registrySnapshotHash,
    };
  }

  async getWorkerExecutionResultByDispatchId(
    dispatchId: string
  ): Promise<WorkerExecutionResult | null> {
    const [row] = await this.db
      .select()
      .from(schema.aiStoryWorkerExecutionResults)
      .where(eq(schema.aiStoryWorkerExecutionResults.dispatchId, dispatchId))
      .limit(1);
    return row ? WorkerExecutionResultSchema.parse(row.result) : null;
  }

  /**
   * Classify Dispatch ownership for the shared poll loop.
   * AI_STORY_SCENE when scheduling correlation exists; otherwise GENERIC_PROVIDER.
   */
  async classifyDispatchOwnership(
    dispatchId: string
  ): Promise<"AI_STORY_SCENE" | "GENERIC_PROVIDER" | "MISSING_DISPATCH"> {
    const [dispatchRow] = await this.db
      .select({
        dispatchId: schema.providerExecutionDispatches.dispatchId,
        jobId: schema.providerExecutionDispatches.jobId,
      })
      .from(schema.providerExecutionDispatches)
      .where(eq(schema.providerExecutionDispatches.dispatchId, dispatchId))
      .limit(1);
    if (!dispatchRow) return "MISSING_DISPATCH";

    const [correlationRow] = await this.db
      .select({
        outboxJobId: schema.aiStorySceneSchedulingCorrelations.outboxJobId,
      })
      .from(schema.aiStorySceneSchedulingCorrelations)
      .where(
        eq(
          schema.aiStorySceneSchedulingCorrelations.outboxJobId,
          dispatchRow.jobId
        )
      )
      .limit(1);
    return correlationRow ? "AI_STORY_SCENE" : "GENERIC_PROVIDER";
  }

  async getLatestWorkerAttemptObservationByDispatchId(
    dispatchId: string
  ): Promise<WorkerExecutionResult | null> {
    const [row] = await this.db
      .select()
      .from(schema.aiStoryWorkerAttemptObservations)
      .where(
        and(
          eq(schema.aiStoryWorkerAttemptObservations.dispatchId, dispatchId),
          ne(
            schema.aiStoryWorkerAttemptObservations.observationKind,
            "PRE_DISPATCH_BLOCKED"
          )
        )
      )
      .orderBy(desc(schema.aiStoryWorkerAttemptObservations.producedAt))
      .limit(1);
    return row ? WorkerExecutionResultSchema.parse(row.observation) : null;
  }

  async getProviderAttemptAdapterState(providerAttemptId: string): Promise<{
    status: string;
    providerTaskId?: string;
  } | null> {
    const [row] = await this.db.select({
      status: schema.aiStoryProviderAttemptCompiledBindings.status,
      providerTaskId: schema.aiStoryProviderAttemptCompiledBindings.providerTaskId,
    }).from(schema.aiStoryProviderAttemptCompiledBindings).where(eq(
      schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId,
      providerAttemptId
    )).limit(1);
    return row
      ? {
          status: row.status,
          ...(row.providerTaskId ? { providerTaskId: row.providerTaskId } : {}),
        }
      : null;
  }

  /**
   * The transaction that returns adapterEligible=true is the only authority
   * allowed to cross the paid adapter boundary. A persisted DISPATCHING row is
   * deliberately treated as an unknown outcome on replay.
   */
  async prepareProviderAttemptBeforeAdapter(input: {
    readonly bundle: WorkerValidatedBundleRow;
    readonly providerAttemptId: string;
    readonly commercialReservationId: string;
    readonly workerId: string;
    readonly preparedAt: string;
  }): Promise<{ replayed: boolean }> {
    return this.db.transaction(async (tx) => {
      const compiledRequestId =
        input.bundle.envelope.executionContext.trace?.compiledRequestId?.trim();
      const compiledFingerprint =
        input.bundle.envelope.executionContext.trace?.compiledRequestFingerprint?.trim();
      if (!compiledRequestId || !compiledFingerprint) {
        throw new WorkerRuntimePersistenceError(
          "OWNERSHIP_INTEGRITY_VIOLATION",
          "Compiled Provider request identity is required before Provider Attempt persistence"
        );
      }
      const [compiledRow] = await tx
        .select({ request: schema.aiStoryCompiledProviderRequests.compiledRequest })
        .from(schema.aiStoryCompiledProviderRequests)
        .where(eq(schema.aiStoryCompiledProviderRequests.compiledRequestId, compiledRequestId))
        .limit(1);
      const request = compiledRow
        ? AiStoryCompiledProviderRequestSchema.parse(compiledRow.request)
        : null;
      if (
        !request ||
        request.requestFingerprint !== compiledFingerprint ||
        request.sceneExecutionId !== input.bundle.correlation.sceneExecutionId ||
        request.orgId !== input.bundle.correlation.ownership.orgId ||
        request.workspaceId !== input.bundle.envelope.workspaceId ||
        request.providerId !== input.bundle.routingDecision.selectedProviderId ||
        request.adapterVersion !== input.bundle.routingDecision.selectedAdapterVersion
      ) {
        throw new WorkerRuntimePersistenceError(
          "OWNERSHIP_INTEGRITY_VIOLATION",
          "Compiled Provider request does not match the claimed Dispatch"
        );
      }
      const [reservation] = await tx
        .select()
        .from(schema.certificationCommercialReservations)
        .where(
          and(
            eq(
              schema.certificationCommercialReservations.certificationReservationId,
              input.commercialReservationId
            ),
            eq(
              schema.certificationCommercialReservations.executionIdentity,
              input.providerAttemptId
            ),
            eq(schema.certificationCommercialReservations.orgId, request.orgId),
            eq(
              schema.certificationCommercialReservations.workspaceId,
              request.workspaceId
            )
          )
        )
        .limit(1);
      if (!reservation || !["RESERVED", "SUBMITTED"].includes(reservation.status)) {
        throw new WorkerRuntimePersistenceError(
          "OWNERSHIP_INTEGRITY_VIOLATION",
          "Submitted commercial reservation must be durably bound before Provider Attempt"
        );
      }

      const attemptInputFingerprint = canonicalPersistenceHash({
        kind: "ai-story-worker-provider-attempt-input.v1",
        providerAttemptId: input.providerAttemptId,
        providerExecutionId: input.bundle.providerExecutionId,
        dispatchId: input.bundle.dispatch.dispatchId,
        compiledRequestId,
        requestFingerprint: request.requestFingerprint,
        commercialReservationId: input.commercialReservationId,
      });
      const binding = AiStoryProviderAttemptBindingSchema.parse({
        providerAttemptId: input.providerAttemptId,
        providerExecutionId: input.bundle.providerExecutionId,
        contractVersion: AI_STORY_PROVIDER_RUNTIME_VERSION,
        compiledRequestId,
        requestFingerprint: request.requestFingerprint,
        attemptInputFingerprint,
        idempotencyKey: `ai-story-worker-provider-attempt:${input.bundle.dispatch.dispatchId}`,
        attemptNumber: 1,
        orgId: request.orgId,
        workspaceId: request.workspaceId,
        campaignId: request.campaignId,
        storyId: request.storyId,
        storyVersionId: request.storyVersionId,
        sceneExecutionId: request.sceneExecutionId,
        generationMode: request.generationMode,
        ...(request.generationAuthority
          ? { generationAuthority: request.generationAuthority }
          : {}),
        providerId: request.providerId,
        modelId: request.modelId,
        adapterVersion: request.adapterVersion,
        mappingVersion: request.mappingVersion,
        capabilityVersion: request.capabilityVersion,
        qcEvaluationId: request.qcEvaluationId,
        qcFingerprint: request.qcFingerprint,
        sceneFingerprint: request.sceneFingerprint,
        directorFingerprint: request.directorFingerprint,
        motionFingerprint: request.motionFingerprint,
        castSnapshotFingerprint: request.castSnapshotFingerprint,
        locationSnapshotFingerprint: request.locationSnapshotFingerprint,
        productSnapshotFingerprint: request.productSnapshotFingerprint,
        estimatedCost: request.estimatedCost,
        commercialReservationId: input.commercialReservationId,
        status: "READY",
        pollCount: 0,
        createdAt: input.preparedAt,
        updatedAt: input.preparedAt,
        automaticPaidRetry: false,
        providerFallback: false,
      });

      await tx.insert(schema.providerAttempts).values({
        attemptId: binding.providerAttemptId,
        executionId: binding.providerExecutionId,
        contractVersion: binding.contractVersion,
        attemptNumber: binding.attemptNumber,
        providerId: binding.providerId,
        providerVersion: binding.adapterVersion,
        modelVersion: binding.modelId,
        requestHash: input.bundle.envelope.requestHash,
        status: "PENDING",
        startedAt: new Date(input.preparedAt),
        warnings: [],
        providerMetadata: {
          source: "ai-story-worker-pre-adapter-authority",
          compiledRequestId,
          attemptInputFingerprint,
          commercialReservationId: input.commercialReservationId,
          dispatchId: input.bundle.dispatch.dispatchId,
        },
      }).onConflictDoNothing();
      const [attemptRow] = await tx.select().from(schema.providerAttempts).where(eq(
        schema.providerAttempts.attemptId,
        binding.providerAttemptId
      )).limit(1);
      if (
        !attemptRow ||
        attemptRow.executionId !== binding.providerExecutionId ||
        attemptRow.attemptNumber !== binding.attemptNumber ||
        attemptRow.providerId !== binding.providerId ||
        attemptRow.providerVersion !== binding.adapterVersion ||
        attemptRow.modelVersion !== binding.modelId ||
        attemptRow.requestHash !== input.bundle.envelope.requestHash
      ) {
        throw new WorkerRuntimePersistenceError(
          "IDENTITY_CONFLICT",
          "Provider Attempt ledger identity conflicts with pre-adapter authority"
        );
      }
      await tx.insert(schema.aiStoryProviderAttemptCompiledBindings).values({
        providerAttemptId: binding.providerAttemptId,
        compiledRequestId: binding.compiledRequestId,
        orgId: binding.orgId,
        workspaceId: binding.workspaceId,
        sceneExecutionId: binding.sceneExecutionId,
        idempotencyKey: binding.idempotencyKey,
        requestFingerprint: binding.requestFingerprint,
        attemptInputFingerprint: binding.attemptInputFingerprint,
        status: binding.status,
        pollCount: 0,
        binding,
        createdAt: new Date(binding.createdAt),
        updatedAt: new Date(binding.updatedAt),
      }).onConflictDoNothing();

      const rows = (await tx.execute(sql`
        select binding from ai_story_provider_attempt_compiled_bindings
        where provider_attempt_id = ${input.providerAttemptId}
        for update
      `)) as unknown as Array<{ binding: unknown }>;
      const current = rows[0]?.binding
        ? AiStoryProviderAttemptBindingSchema.parse(rows[0].binding)
        : null;
      if (
        !current ||
        current.attemptInputFingerprint !== attemptInputFingerprint ||
        current.commercialReservationId !== input.commercialReservationId
      ) {
        throw new WorkerRuntimePersistenceError(
          "IDENTITY_CONFLICT",
          "Provider Attempt identity conflicts with durable pre-adapter authority"
        );
      }
      return { replayed: current.createdAt !== input.preparedAt };
    });
  }

  async claimProviderAttemptForAdapter(input: {
    readonly providerAttemptId: string;
    readonly workerId: string;
    readonly claimedAt: string;
  }): Promise<{ adapterEligible: boolean }> {
    return this.db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        select binding from ai_story_provider_attempt_compiled_bindings
        where provider_attempt_id = ${input.providerAttemptId}
        for update
      `)) as unknown as Array<{ binding: unknown }>;
      const current = rows[0]?.binding
        ? AiStoryProviderAttemptBindingSchema.parse(rows[0].binding)
        : null;
      if (!current || current.status !== "READY") {
        return { adapterEligible: false };
      }
      const claimed = AiStoryProviderAttemptBindingSchema.parse({
        ...current,
        status: "DISPATCHING",
        submissionClaimOwner: input.workerId,
        submissionClaimedAt: input.claimedAt,
        submitStartedAt: input.claimedAt,
        updatedAt: input.claimedAt,
      });
      await tx.update(schema.aiStoryProviderAttemptCompiledBindings).set({
        status: claimed.status,
        submissionClaimOwner: claimed.submissionClaimOwner,
        submissionClaimedAt: new Date(input.claimedAt),
        binding: claimed,
        updatedAt: new Date(input.claimedAt),
      }).where(eq(
        schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId,
        input.providerAttemptId
      ));
      return { adapterEligible: true };
    });
  }

  async recordProviderAdapterOutcome(input: {
    readonly providerAttemptId: string;
    readonly acceptanceClassification: ProviderAcceptanceClassification;
    readonly canonicalProviderState: CanonicalProviderState;
    readonly providerRequestId?: string;
    readonly occurredAt: string;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        select binding from ai_story_provider_attempt_compiled_bindings
        where provider_attempt_id = ${input.providerAttemptId}
        for update
      `)) as unknown as Array<{ binding: unknown }>;
      const current = rows[0]?.binding
        ? AiStoryProviderAttemptBindingSchema.parse(rows[0].binding)
        : null;
      if (!current) {
        throw new WorkerRuntimePersistenceError(
          "WORKER_ATTEMPT_CONFLICT",
          "Durable Provider Attempt is missing after adapter invocation"
        );
      }
      if (current.status !== "DISPATCHING") {
        // Identical outcome replay converges without reopening submission.
        if (
          (current.status === "SUBMITTED" && input.acceptanceClassification === "ACCEPTED") ||
          (current.status === "RECONCILIATION_REQUIRED" && input.acceptanceClassification === "ACCEPTANCE_UNKNOWN") ||
          (current.status === "FAILED" && !["ACCEPTED", "ACCEPTANCE_UNKNOWN"].includes(input.acceptanceClassification))
        ) return;
        throw new WorkerRuntimePersistenceError(
          "WORKER_ATTEMPT_CONFLICT",
          "Adapter outcome conflicts with durable Provider Attempt state"
        );
      }
      if (input.acceptanceClassification === "ACCEPTED" && !input.providerRequestId) {
        throw new WorkerRuntimePersistenceError(
          "WORKER_ATTEMPT_CONFLICT",
          "Accepted Provider submission requires a durable Provider task identity"
        );
      }
      const status = input.acceptanceClassification === "ACCEPTED"
        ? "SUBMITTED"
        : input.acceptanceClassification === "ACCEPTANCE_UNKNOWN"
          ? "RECONCILIATION_REQUIRED"
          : "FAILED";
      const next = AiStoryProviderAttemptBindingSchema.parse({
        ...current,
        status,
        ...(input.providerRequestId ? { providerTaskId: input.providerRequestId } : {}),
        ...(status === "SUBMITTED" ? { submittedAt: input.occurredAt } : {}),
        updatedAt: input.occurredAt,
      });
      await tx.update(schema.aiStoryProviderAttemptCompiledBindings).set({
        status: next.status,
        providerTaskId: next.providerTaskId,
        binding: next,
        updatedAt: new Date(input.occurredAt),
      }).where(eq(
        schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId,
        input.providerAttemptId
      ));
      if (input.providerRequestId) {
        await tx.update(schema.providerAttempts).set({
          providerRequestId: input.providerRequestId,
        }).where(eq(schema.providerAttempts.attemptId, input.providerAttemptId));
      }
    });
  }

  /**
   * Append-only operational observation for non-terminal Adapter outcomes.
   * Never deletes or mutates prior observations / WorkerExecutionResults.
   */
  async appendWorkerAttemptObservation(
    result: WorkerExecutionResult
  ): Promise<{ result: WorkerExecutionResult; converged: boolean }> {
    const parsed = WorkerExecutionResultSchema.parse(result);
    if (isTerminalWorkerResultState(parsed)) {
      throw new WorkerRuntimePersistenceError(
        "WORKER_ATTEMPT_CONFLICT",
        "Terminal Worker evidence must use acceptOrReturnWorkerExecutionResult"
      );
    }

    const [correlationRow] = await this.db
      .select()
      .from(schema.aiStorySceneSchedulingCorrelations)
      .where(
        eq(
          schema.aiStorySceneSchedulingCorrelations.outboxJobId,
          parsed.outboxJobId
        )
      )
      .limit(1);
    if (!correlationRow) {
      throw new WorkerRuntimePersistenceError(
        "OWNERSHIP_INTEGRITY_VIOLATION",
        "Cannot persist Worker observation without Scene scheduling correlation"
      );
    }

    const observationId = deterministicPersistenceUuid(
      "ai-story-worker-attempt-observation",
      {
        providerAttemptId: parsed.providerAttemptId,
        dispatchId: parsed.dispatchId,
        deterministicIntegrityHash: parsed.deterministicIntegrityHash,
      }
    );

    const inserted = await this.db
      .insert(schema.aiStoryWorkerAttemptObservations)
      .values({
        observationId,
        orgId: correlationRow.orgId,
        workspaceId: correlationRow.workspaceId,
        providerExecutionId: parsed.providerExecutionId,
        providerAttemptId: parsed.providerAttemptId,
        dispatchId: parsed.dispatchId,
        outboxJobId: parsed.outboxJobId,
        providerRequestId: parsed.providerRequestId ?? null,
        observationKind: parsed.workerState,
        reconciliationRequired: parsed.reconciliationRequired,
        deterministicIntegrityHash: parsed.deterministicIntegrityHash,
        observation: parsed,
        producedAt: new Date(parsed.producedAt),
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) {
      return {
        result: WorkerExecutionResultSchema.parse(inserted[0].observation),
        converged: false,
      };
    }

    const [existing] = await this.db
      .select()
      .from(schema.aiStoryWorkerAttemptObservations)
      .where(
        eq(
          schema.aiStoryWorkerAttemptObservations.deterministicIntegrityHash,
          parsed.deterministicIntegrityHash
        )
      )
      .limit(1);
    if (!existing) {
      throw new WorkerRuntimePersistenceError(
        "WORKER_ATTEMPT_CONFLICT",
        "Worker Attempt Observation identity conflict"
      );
    }
    return {
      result: WorkerExecutionResultSchema.parse(existing.observation),
      converged: true,
    };
  }

  /**
   * Insert-only immutable terminal WorkerExecutionResult authority.
   * Non-terminal results must use appendWorkerAttemptObservation (MODEL A).
   * Never DELETE/UPDATE/replace accepted terminal evidence.
   */
  async acceptOrReturnWorkerExecutionResult(
    result: WorkerExecutionResult
  ): Promise<{ result: WorkerExecutionResult; converged: boolean }> {
    const parsed = WorkerExecutionResultSchema.parse(result);

    if (!isTerminalWorkerResultState(parsed)) {
      throw new WorkerRuntimePersistenceError(
        "WORKER_ATTEMPT_CONFLICT",
        "Non-terminal Worker outcomes are observations, not immutable WorkerExecutionResult"
      );
    }

    const [correlationRow] = await this.db
      .select()
      .from(schema.aiStorySceneSchedulingCorrelations)
      .where(
        eq(
          schema.aiStorySceneSchedulingCorrelations.outboxJobId,
          parsed.outboxJobId
        )
      )
      .limit(1);
    if (!correlationRow) {
      throw new WorkerRuntimePersistenceError(
        "OWNERSHIP_INTEGRITY_VIOLATION",
        "Cannot persist Worker result without Scene scheduling correlation"
      );
    }

    const inserted = await this.db
      .insert(schema.aiStoryWorkerExecutionResults)
      .values({
        workerExecutionResultId: parsed.workerExecutionResultId,
        orgId: correlationRow.orgId,
        workspaceId: correlationRow.workspaceId,
        providerExecutionId: parsed.providerExecutionId,
        providerAttemptId: parsed.providerAttemptId,
        dispatchId: parsed.dispatchId,
        outboxJobId: parsed.outboxJobId,
        routingDecisionId: parsed.routingDecisionId,
        providerId: parsed.providerId,
        adapterVersion: parsed.adapterVersion,
        routerVersion: parsed.routerVersion,
        providerRequestId: parsed.providerRequestId,
        workerState: parsed.workerState,
        acceptanceClassification: parsed.acceptanceClassification,
        canonicalProviderState: parsed.canonicalProviderState,
        reconciliationRequired: parsed.reconciliationRequired,
        deterministicIntegrityHash: parsed.deterministicIntegrityHash,
        workerContractVersion: parsed.workerContractVersion,
        result: parsed,
        producedAt: new Date(parsed.producedAt),
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) {
      return {
        result: WorkerExecutionResultSchema.parse(inserted[0].result),
        converged: false,
      };
    }

    const [existing] = await this.db
      .select()
      .from(schema.aiStoryWorkerExecutionResults)
      .where(eq(schema.aiStoryWorkerExecutionResults.dispatchId, parsed.dispatchId))
      .limit(1);
    if (!existing) {
      throw new WorkerRuntimePersistenceError(
        "WORKER_ATTEMPT_CONFLICT",
        "Worker Execution Result identity conflict"
      );
    }
    const accepted = WorkerExecutionResultSchema.parse(existing.result);
    if (accepted.deterministicIntegrityHash === parsed.deterministicIntegrityHash) {
      if (
        accepted.providerAttemptId !== parsed.providerAttemptId ||
        accepted.providerId !== parsed.providerId ||
        accepted.adapterVersion !== parsed.adapterVersion
      ) {
        throw new WorkerRuntimePersistenceError(
          "WORKER_ATTEMPT_CONFLICT",
          "Worker attempt identity conflicts with persisted result"
        );
      }
      return { result: accepted, converged: true };
    }

    throw new WorkerRuntimePersistenceError(
      "WORKER_ATTEMPT_CONFLICT",
      "Conflicting Worker Execution Result for the same Dispatch"
    );
  }
}

function isTerminalWorkerResultState(result: WorkerExecutionResult): boolean {
  return (
    result.workerState === "TERMINAL_SUCCESS" ||
    result.workerState === "TERMINAL_FAILURE" ||
    result.workerState === "NOT_ACCEPTED" ||
    result.canonicalProviderState === "SUCCEEDED" ||
    result.canonicalProviderState === "FAILED" ||
    result.canonicalProviderState === "REJECTED" ||
    result.canonicalProviderState === "TIMED_OUT" ||
    result.acceptanceClassification === "NOT_ACCEPTED"
  );
}

function assertOwnershipChain(
  dispatch: ExecutionDispatch,
  envelope: ExecutionEnvelope,
  correlation: SceneProviderSchedulingCorrelation,
  routingDecision: PersistedSceneRoutingDecision,
  runtimeAuthorization: RuntimeAuthorizedFact
): void {
  const workspaceId = correlation.ownership.workspaceId;
  const orgId = correlation.ownership.orgId;
  if (
    dispatch.workspaceId !== workspaceId ||
    dispatch.tenantId !== orgId ||
    envelope.workspaceId !== workspaceId ||
    envelope.tenantId !== orgId ||
    routingDecision.ownership.workspaceId !== workspaceId ||
    routingDecision.ownership.orgId !== orgId ||
    runtimeAuthorization.ownership.workspaceId !== workspaceId ||
    runtimeAuthorization.ownership.orgId !== orgId
  ) {
    throw new WorkerRuntimePersistenceError(
      "OWNERSHIP_INTEGRITY_VIOLATION",
      "Cross-workspace or ownership mismatch in Worker bundle"
    );
  }
}

function toDispatch(
  row: typeof schema.providerExecutionDispatches.$inferSelect
): ExecutionDispatch {
  return {
    version: row.version as ExecutionDispatch["version"],
    dispatchId: row.dispatchId,
    jobId: row.jobId,
    executionId: row.executionId,
    envelopeId: row.envelopeId,
    payloadReference: row.payloadReference,
    correlationId: row.correlationId,
    tenantId: row.orgId,
    workspaceId: row.workspaceId,
    capabilityId: row.capabilityId,
    capabilityVersion: row.capabilityVersion,
    requestHash: row.requestHash,
    envelopeHash: row.envelopeHash,
    workerHandoff: row.workerHandoff as ExecutionDispatch["workerHandoff"],
    dispatchHash: row.dispatchHash,
    status: row.status as ExecutionDispatch["status"],
    createdAt: row.createdAt.toISOString(),
  };
}

function toEnvelope(
  row: typeof schema.providerExecutionEnvelopes.$inferSelect
): ExecutionEnvelope {
  return {
    version: row.version as ExecutionEnvelope["version"],
    envelopeId: row.envelopeId,
    payloadReference: row.payloadReference,
    tenantId: row.orgId,
    workspaceId: row.workspaceId,
    executionContext: row.executionContext as ExecutionEnvelope["executionContext"],
    capabilityId: row.capabilityId,
    capabilityVersion: row.capabilityVersion,
    providerPolicySnapshot: row.providerPolicySnapshot,
    canonicalRequest: row.canonicalRequest as ExecutionEnvelope["canonicalRequest"],
    requestHash: row.requestHash,
    envelopeHash: row.envelopeHash,
    createdAt: row.createdAt.toISOString(),
  };
}
