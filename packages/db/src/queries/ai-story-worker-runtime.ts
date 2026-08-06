/**
 * Sprint 3 PR 3.3 — Worker runtime persistence + validated Dispatch bundle loading.
 * Validates ownership/correlation/envelope/routing before Adapter invocation.
 * Does not finalize, write usage/cost, or unlock execution.
 */
import { eq } from "drizzle-orm";
import {
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
} from "@ceo-agent/shared";
import { getDb } from "../client";
import * as schema from "../schema/index";

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
      throw new WorkerRuntimePersistenceError(
        "WORKER_DISPATCH_INVALID",
        "Scene scheduling correlation for Outbox Job does not exist"
      );
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

  async acceptOrReturnWorkerExecutionResult(
    result: WorkerExecutionResult
  ): Promise<{ result: WorkerExecutionResult; converged: boolean }> {
    const parsed = WorkerExecutionResultSchema.parse(result);

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
    if (accepted.deterministicIntegrityHash !== parsed.deterministicIntegrityHash) {
      throw new WorkerRuntimePersistenceError(
        "WORKER_ATTEMPT_CONFLICT",
        "Conflicting Worker Execution Result for the same Dispatch"
      );
    }
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
