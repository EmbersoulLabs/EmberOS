/**
 * Sprint 3 PR 3.5 — Scene projection persistence (Transaction B only).
 * Never updates provider_executions, provider_outbox_jobs, or provider_attempt_*.
 */
import { eq } from "drizzle-orm";
import {
  PersistedSceneRoutingDecisionSchema,
  ProjectedSceneResultSchema,
  RuntimeAuthorizedFactSchema,
  SceneProjectionCorrelationSchema,
  SceneProviderSchedulingCorrelationSchema,
  WorkerExecutionResultSchema,
  validateExecutionDispatch,
  validateExecutionEnvelope,
  type AcceptedProviderFinalization,
  type SceneProjectionValidatedBundle,
  type WorkerExecutionResult,
  buildProviderFinalizationReference,
} from "@ceo-agent/shared";
import { getDb } from "../client";
import * as schema from "../schema/index";
import { insertPendingGeneratedSceneReviewInTransaction } from "./ai-story-generated-scene-review";

type Db = ReturnType<typeof getDb>;

export class SceneProjectionPersistenceError extends Error {
  constructor(
    readonly code:
      | "SCENE_PROJECTION_CHAIN_INVALID"
      | "SCENE_PROJECTION_CONFLICT"
      | "SCENE_PROJECTION_TRANSACTION_FAILED",
    message: string
  ) {
    super(message);
    this.name = "SceneProjectionPersistenceError";
  }
}

function toDispatch(row: typeof schema.providerExecutionDispatches.$inferSelect) {
  return {
    version: row.version,
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
    workerHandoff: row.workerHandoff,
    dispatchHash: row.dispatchHash,
    status: row.status as never,
    createdAt: row.createdAt.toISOString(),
  };
}

function toEnvelope(row: typeof schema.providerExecutionEnvelopes.$inferSelect) {
  return {
    version: row.version,
    envelopeId: row.envelopeId,
    payloadReference: row.payloadReference,
    tenantId: row.orgId,
    workspaceId: row.workspaceId,
    executionContext: row.executionContext,
    capabilityId: row.capabilityId,
    capabilityVersion: row.capabilityVersion,
    providerPolicySnapshot: row.providerPolicySnapshot,
    canonicalRequest: row.canonicalRequest,
    requestHash: row.requestHash,
    envelopeHash: row.envelopeHash,
    createdAt: row.createdAt.toISOString(),
  };
}

export class SceneProjectionRepositoryImpl {
  constructor(private readonly db: Db = getDb()) {}

  async loadValidatedBundleByDispatchId(
    dispatchId: string
  ): Promise<SceneProjectionValidatedBundle | null> {
    const [dispatchRow] = await this.db
      .select()
      .from(schema.providerExecutionDispatches)
      .where(eq(schema.providerExecutionDispatches.dispatchId, dispatchId))
      .limit(1);
    if (!dispatchRow) return null;

    const dispatch = await validateExecutionDispatch(toDispatch(dispatchRow));

    const [correlationRow] = await this.db
      .select()
      .from(schema.aiStorySceneSchedulingCorrelations)
      .where(
        eq(schema.aiStorySceneSchedulingCorrelations.outboxJobId, dispatch.jobId)
      )
      .limit(1);
    if (!correlationRow) {
      throw new SceneProjectionPersistenceError(
        "SCENE_PROJECTION_CHAIN_INVALID",
        "Scheduling correlation missing"
      );
    }
    const correlation = SceneProviderSchedulingCorrelationSchema.parse(
      correlationRow.correlation
    );

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
      throw new SceneProjectionPersistenceError(
        "SCENE_PROJECTION_CHAIN_INVALID",
        "Routing decision missing"
      );
    }
    const routingDecision = PersistedSceneRoutingDecisionSchema.parse(
      routingRow.decision
    );

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
      throw new SceneProjectionPersistenceError(
        "SCENE_PROJECTION_CHAIN_INVALID",
        "RuntimeAuthorizedFact missing"
      );
    }
    const runtimeAuthorization = RuntimeAuthorizedFactSchema.parse(authRow.fact);

    const [envelopeRow] = await this.db
      .select()
      .from(schema.providerExecutionEnvelopes)
      .where(eq(schema.providerExecutionEnvelopes.envelopeId, dispatch.envelopeId))
      .limit(1);
    if (!envelopeRow) {
      throw new SceneProjectionPersistenceError(
        "SCENE_PROJECTION_CHAIN_INVALID",
        "Envelope missing"
      );
    }
    const envelope = await validateExecutionEnvelope(toEnvelope(envelopeRow));

    const [sceneRow] = await this.db
      .select({
        sceneId: schema.aiStorySceneExecutions.sceneId,
        sceneOrder: schema.aiStorySceneExecutions.sceneOrder,
      })
      .from(schema.aiStorySceneExecutions)
      .where(eq(schema.aiStorySceneExecutions.id, routingDecision.sceneExecutionId))
      .limit(1);
    if (!sceneRow) {
      throw new SceneProjectionPersistenceError(
        "SCENE_PROJECTION_CHAIN_INVALID",
        "Scene execution missing"
      );
    }

    return {
      dispatch,
      outboxJobId: dispatch.jobId,
      providerExecutionId: dispatch.executionId,
      envelope,
      correlation,
      routingDecision,
      runtimeAuthorization,
      registrySnapshotHash: routingDecision.registrySnapshotHash,
      sceneId: sceneRow.sceneId,
      sceneOrder: sceneRow.sceneOrder,
    };
  }

  async loadWorkerExecutionResultByDispatchId(
    dispatchId: string
  ): Promise<WorkerExecutionResult | null> {
    const [row] = await this.db
      .select()
      .from(schema.aiStoryWorkerExecutionResults)
      .where(eq(schema.aiStoryWorkerExecutionResults.dispatchId, dispatchId))
      .limit(1);
    if (!row) return null;
    return WorkerExecutionResultSchema.parse(row.result);
  }

  async loadAcceptedProviderFinalization(
    executionId: string
  ): Promise<AcceptedProviderFinalization | null> {
    const [execution] = await this.db
      .select()
      .from(schema.providerExecutions)
      .where(eq(schema.providerExecutions.executionId, executionId))
      .limit(1);
    if (!execution || !execution.acceptedAttemptId || !execution.completedAt) {
      return null;
    }

    const [job] = await this.db
      .select()
      .from(schema.providerOutboxJobs)
      .where(eq(schema.providerOutboxJobs.executionId, executionId))
      .limit(1);
    if (!job) return null;

    if (
      execution.status === "SUCCEEDED" &&
      execution.acceptedResult &&
      job.status === "COMPLETED"
    ) {
      const result = execution.acceptedResult;
      return {
        executionId,
        attemptId: execution.acceptedAttemptId,
        jobId: job.jobId,
        workerId: job.completionWorkerId ?? "unknown",
        completedAt: execution.completedAt.toISOString(),
        resultReference: result.resultReference,
        responseHash: result.responseHash,
        providerId: result.providerMetadata.providerId,
        adapterVersion:
          result.provenance?.[0]?.adapterVersion ??
          result.providerMetadata.providerVersion,
        completionMetadata: (job.completionMetadata ?? {}) as Record<string, unknown>,
        terminalKind: "SUCCEEDED",
      };
    }

    if (execution.status === "TERMINAL_FAILURE" && job.status === "DEAD_LETTER") {
      const meta = (job.completionMetadata ?? {}) as Record<string, unknown>;
      const resultReference =
        typeof meta.resultReference === "string" && meta.resultReference.length > 0
          ? meta.resultReference
          : `terminal-failure://${execution.acceptedAttemptId}`;
      const responseHash =
        execution.acceptedResponseHash ??
        (typeof meta.responseHash === "string" ? meta.responseHash : "");
      if (!responseHash) return null;
      return {
        executionId,
        attemptId: execution.acceptedAttemptId,
        jobId: job.jobId,
        workerId: job.completionWorkerId ?? "unknown",
        completedAt: execution.completedAt.toISOString(),
        resultReference,
        responseHash,
        providerId:
          typeof meta.providerId === "string" ? meta.providerId : "unknown",
        adapterVersion:
          typeof meta.adapterVersion === "string" ? meta.adapterVersion : "unknown",
        completionMetadata: meta,
        terminalKind: "TERMINAL_FAILURE",
        failureCode:
          typeof meta.failureCode === "string" ? meta.failureCode : undefined,
      };
    }

    return null;
  }

  async acceptOrConvergeProjection(input: {
    readonly correlation: import("@ceo-agent/shared").SceneProjectionCorrelation;
    readonly sceneResult: import("@ceo-agent/shared").ProjectedSceneResult;
  }): Promise<{
    readonly correlation: import("@ceo-agent/shared").SceneProjectionCorrelation;
    readonly sceneResult: import("@ceo-agent/shared").ProjectedSceneResult;
    readonly converged: boolean;
  }> {
    try {
      return await this.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(schema.aiStorySceneProjectionCorrelations)
          .where(
            eq(
              schema.aiStorySceneProjectionCorrelations.providerAttemptId,
              input.correlation.providerAttemptId
            )
          )
          .limit(1);

        if (existing) {
          const accepted = SceneProjectionCorrelationSchema.parse(
            existing.correlation
          );
          if (accepted.integrityHash !== input.correlation.integrityHash) {
            throw new SceneProjectionPersistenceError(
              "SCENE_PROJECTION_CONFLICT",
              "Conflicting Scene projection for the same Scene Execution"
            );
          }
          const [sceneRow] = await tx
            .select()
            .from(schema.aiStorySceneResults)
            .where(
              eq(schema.aiStorySceneResults.sceneResultId, accepted.sceneResultId)
            )
            .limit(1);
          if (!sceneRow) {
            throw new SceneProjectionPersistenceError(
              "SCENE_PROJECTION_TRANSACTION_FAILED",
              "Projection correlation exists without Scene Result"
            );
          }
          return {
            correlation: accepted,
            sceneResult: ProjectedSceneResultSchema.parse(sceneRow.result),
            converged: true,
          };
        }

        const inserted = await tx
          .insert(schema.aiStorySceneProjectionCorrelations)
          .values({
            projectionCorrelationId: input.correlation.projectionCorrelationId,
            orgId: input.correlation.ownershipOrgId,
            workspaceId: input.correlation.ownershipWorkspaceId,
            sceneExecutionId: input.correlation.sceneExecutionId,
            workerExecutionResultId: input.correlation.workerExecutionResultId,
            providerExecutionId: input.correlation.providerExecutionId,
            providerAttemptId: input.correlation.providerAttemptId,
            outboxJobId: input.correlation.outboxJobId,
            dispatchId: input.correlation.dispatchId,
            providerFinalizationReference:
              input.correlation.providerFinalizationReference,
            sceneResultId: input.correlation.sceneResultId,
            integrityHash: input.correlation.integrityHash,
            contractVersion: input.correlation.contractVersion,
            correlation: input.correlation,
            projectedAt: new Date(input.correlation.projectedAt),
          })
          .onConflictDoNothing()
          .returning();

        if (!inserted[0]) {
          const [again] = await tx
            .select()
            .from(schema.aiStorySceneProjectionCorrelations)
            .where(
              eq(
                schema.aiStorySceneProjectionCorrelations.providerAttemptId,
                input.correlation.providerAttemptId
              )
            )
            .limit(1);
          if (!again) {
            throw new SceneProjectionPersistenceError(
              "SCENE_PROJECTION_TRANSACTION_FAILED",
              "Projection conflict unresolved"
            );
          }
          const accepted = SceneProjectionCorrelationSchema.parse(again.correlation);
          if (accepted.integrityHash !== input.correlation.integrityHash) {
            throw new SceneProjectionPersistenceError(
              "SCENE_PROJECTION_CONFLICT",
              "Conflicting Scene projection for the same Scene Execution"
            );
          }
          const [sceneRow] = await tx
            .select()
            .from(schema.aiStorySceneResults)
            .where(
              eq(schema.aiStorySceneResults.sceneResultId, accepted.sceneResultId)
            )
            .limit(1);
          if (!sceneRow) {
            throw new SceneProjectionPersistenceError(
              "SCENE_PROJECTION_TRANSACTION_FAILED",
              "Projection correlation exists without Scene Result"
            );
          }
          return {
            correlation: accepted,
            sceneResult: ProjectedSceneResultSchema.parse(sceneRow.result),
            converged: true,
          };
        }

        await tx.insert(schema.aiStorySceneResults).values({
          sceneResultId: input.sceneResult.sceneResultId,
          orgId: input.correlation.ownershipOrgId,
          workspaceId: input.correlation.ownershipWorkspaceId,
          executionPlanId: input.sceneResult.executionPlanId,
          sceneRuntimeId: input.sceneResult.sceneRuntimeId,
          sceneExecutionId: input.sceneResult.sceneExecutionId,
          workerExecutionResultId: input.correlation.workerExecutionResultId,
          projectionCorrelationId: input.correlation.projectionCorrelationId,
          providerExecutionId: input.sceneResult.providerExecutionId,
          providerAttemptId: input.sceneResult.providerAttemptId,
          providerFinalizationReference:
            input.sceneResult.providerFinalizationReference,
          sceneId: input.sceneResult.sceneId,
          sceneOrder: input.sceneResult.sceneOrder,
          status: input.sceneResult.status,
          integrityHash: input.sceneResult.integrityHash,
          contractVersion: input.sceneResult.contractVersion,
          result: input.sceneResult,
          acceptedAt: new Date(input.sceneResult.acceptedAt),
          projectedAt: new Date(input.sceneResult.projectedAt),
        });

        await insertPendingGeneratedSceneReviewInTransaction(tx, {
          orgId: input.sceneResult.ownership.orgId,
          workspaceId: input.sceneResult.ownership.workspaceId,
          campaignId: input.sceneResult.ownership.campaignId,
          storyId: input.sceneResult.ownership.storyId,
          executionPlanId: input.sceneResult.executionPlanId,
          sceneExecutionId: input.sceneResult.sceneExecutionId,
          sceneId: input.sceneResult.sceneId,
          providerAttemptId: input.sceneResult.providerAttemptId,
          sceneResultId: input.sceneResult.sceneResultId,
        });

        return {
          correlation: input.correlation,
          sceneResult: input.sceneResult,
          converged: false,
        };
      });
    } catch (error) {
      if (error instanceof SceneProjectionPersistenceError) throw error;
      throw new SceneProjectionPersistenceError(
        "SCENE_PROJECTION_TRANSACTION_FAILED",
        error instanceof Error
          ? error.message.slice(0, 300)
          : "Scene projection transaction failed"
      );
    }
  }
}

export function buildAcceptedFinalizationReference(
  finalization: AcceptedProviderFinalization
): string {
  return buildProviderFinalizationReference({
    executionId: finalization.executionId,
    attemptId: finalization.attemptId,
    jobId: finalization.jobId,
    completedAt: finalization.completedAt,
    resultReference: finalization.resultReference,
  });
}
