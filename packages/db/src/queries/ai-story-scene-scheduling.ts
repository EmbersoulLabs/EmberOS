import { and, eq, inArray, or, asc } from "drizzle-orm";
import {
  PHASE1_EXECUTION_LOCKED,
  PersistedSceneRoutingDecisionSchema,
  RuntimeAuthorizedFactSchema,
  SCENE_SCHEDULING_CONTRACT_VERSION,
  SCENE_SCHEDULING_ERROR_CODES,
  SceneProviderSchedulingCorrelationSchema,
  SceneSchedulingBundleSchema,
  AiStoryCompiledProviderRequestSchema,
  isSceneSchedulingBundleComplete,
  validateExecutionEnvelope,
  type ExecutionEnvelope,
  type PersistedSceneRoutingDecision,
  type ProviderExecution,
  type RuntimeAuthorizedFact,
  type SceneProviderSchedulingCorrelation,
  type SceneSchedulingBundle,
  type SceneSchedulingErrorCode,
  type AiStoryCompiledProviderRequest,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import {
  assertExecutionPlanOwnershipChainInSingleQuery,
  assertPlanOwnershipColumnsMatch,
  planOwnershipFromRow,
  type PlanOwnedRow,
  type QueryDb,
} from "./ai-story-ownership";
import {
  canonicalPersistenceHash,
} from "./ai-story-scene-execution-persistence";
import { RuntimeAuthorizationPersistenceError } from "./ai-story-runtime-authorization";
import {
  ProviderLedgerConflictError,
  createProviderExecution,
} from "./provider-ledger";
import type { CreateOutboxJobInput } from "./provider-outbox";
import { acceptAiStoryCompiledRequest } from "./ai-story-provider-runtime";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const SCENE_SCHEDULING_ERROR_CODE_SET = new Set<string>(
  SCENE_SCHEDULING_ERROR_CODES
);

export class SceneSchedulingError extends Error {
  readonly status: number;

  constructor(readonly code: SceneSchedulingErrorCode, message: string) {
    super(message);
    this.name = "SceneSchedulingError";
    this.status =
      code === "SCENE_NOT_AUTHORIZED" ||
      code === "RUNTIME_AUTHORIZATION_REQUIRED" ||
      code === "OWNERSHIP_INTEGRITY_VIOLATION"
        ? 403
        : 409;
  }
}

export type ScheduleAcceptedBundleInput = {
  readonly runtimeAuthorizedFact: RuntimeAuthorizedFact;
  readonly routingDecision: PersistedSceneRoutingDecision;
  readonly providerExecution: ProviderExecution;
  readonly compiledProviderRequest: AiStoryCompiledProviderRequest;
  readonly requestHash: string;
  readonly envelope: ExecutionEnvelope;
  readonly outboxJob: CreateOutboxJobInput;
  readonly correlation: SceneProviderSchedulingCorrelation;
  readonly scheduledBy: string;
  readonly productionVerification?: ProductionVerificationAuthority;
  readonly observeTiming?: (observation: SceneSchedulingStepTiming) => void;
  readonly observeBoundary?: (boundary: SceneSchedulingPersistenceBoundary) => void;
  readonly testFailureAfter?:
    | "runtime_authorization"
    | "routing_decision"
    | "compiled_request"
    | "provider_execution"
    | "outbox"
    | "envelope"
    | "correlation";
};

export type SceneSchedulingTimingKey =
  | "release_state_load"
  | "released_scene_projection"
  | "provider_eligibility"
  | "routing_request_build"
  | "routing_decision_lookup"
  | "routing_decision_write"
  | "compiled_request_write"
  | "verification_identity_lookup"
  | "verification_identity_write"
  | "scheduling_correlation_lookup"
  | "scheduling_correlation_write"
  | "provider_execution_lookup_or_create"
  | "verification_outbox_lookup"
  | "verification_outbox_write"
  | "transaction_commit";

export type SceneSchedulingStepTiming = {
  readonly step: SceneSchedulingTimingKey;
  readonly durationMs: number;
  readonly transactionAuthority: "none" | "canonical_post_release_tx";
  readonly connectionAuthority: "pre_transaction" | "scene_scheduling_pool";
  readonly outcome: "PASS" | "MISS" | "CONVERGED" | "NOT_REQUIRED" | "FAIL";
};

export type SceneSchedulingPersistenceBoundary = {
  readonly connectionAcquireCount: number;
  readonly transactionCount: number;
  readonly secondCheckoutAttempts: number;
  readonly serialDbRoundTripCount: number;
  readonly poolWaitMs: number;
  readonly commitMs: number;
};

async function observeStep<T>(
  input: ScheduleAcceptedBundleInput,
  step: SceneSchedulingTimingKey,
  operation: () => Promise<T>,
  outcome: (value: T) => SceneSchedulingStepTiming["outcome"] = () => "PASS"
): Promise<T> {
  const startedAt = performance.now();
  try {
    const value = await operation();
    input.observeTiming?.({
      step,
      durationMs: performance.now() - startedAt,
      transactionAuthority: "canonical_post_release_tx",
      connectionAuthority: "scene_scheduling_pool",
      outcome: outcome(value),
    });
    return value;
  } catch (error) {
    input.observeTiming?.({
      step,
      durationMs: performance.now() - startedAt,
      transactionAuthority: "canonical_post_release_tx",
      connectionAuthority: "scene_scheduling_pool",
      outcome: "FAIL",
    });
    throw error;
  }
}

export const AI_STORY_PRODUCTION_VERIFICATION_POLICY_VERSION =
  "ai-story-prod-verify.v1" as const;

export type ProductionVerificationAuthority = {
  readonly verificationMode: true;
  readonly verificationPolicyVersion: typeof AI_STORY_PRODUCTION_VERIFICATION_POLICY_VERSION;
  readonly authorizedBy: "ACTIVE_PLATFORM_ADMIN";
  readonly createdBy: string;
};

function failAfterTestStage(
  input: ScheduleAcceptedBundleInput,
  stage: NonNullable<ScheduleAcceptedBundleInput["testFailureAfter"]>
): void {
  if (input.testFailureAfter === stage) {
    throw new SceneSchedulingError(
      "IDENTITY_CONFLICT",
      `test failure after ${stage}`
    );
  }
}

function toSceneSchedulingError(error: unknown): never {
  if (error instanceof SceneSchedulingError) throw error;
  if (error instanceof RuntimeAuthorizationPersistenceError) {
    const code = SCENE_SCHEDULING_ERROR_CODE_SET.has(error.code)
      ? (error.code as SceneSchedulingErrorCode)
      : "IDENTITY_CONFLICT";
    throw new SceneSchedulingError(code, error.message);
  }
  if (error instanceof ProviderLedgerConflictError) {
    throw new SceneSchedulingError("PROVIDER_EXECUTION_CONFLICT", error.message);
  }
  throw error;
}

function toRoutingDecision(
  row: typeof schema.aiStorySceneRoutingDecisions.$inferSelect
): PersistedSceneRoutingDecision {
  return PersistedSceneRoutingDecisionSchema.parse(row.decision);
}

function toCorrelation(
  row: typeof schema.aiStorySceneSchedulingCorrelations.$inferSelect
): SceneProviderSchedulingCorrelation {
  return SceneProviderSchedulingCorrelationSchema.parse(row.correlation);
}

async function lockExecutionPlan(executionPlanId: string, db: QueryDb) {
  const [plan] = await db
    .select()
    .from(schema.aiStoryExecutionPlans)
    .where(eq(schema.aiStoryExecutionPlans.id, executionPlanId))
    .limit(1)
    .for("update");
  if (!plan) {
    throw new SceneSchedulingError(
      "OWNERSHIP_INTEGRITY_VIOLATION",
      "Execution Plan not found for Scene scheduling"
    );
  }
  return plan;
}

function assertPlanOwned(
  expected: PlanOwnedRow,
  actual: PlanOwnedRow,
  label: string
): void {
  try {
    assertPlanOwnershipColumnsMatch(expected, actual, label);
  } catch (error) {
    if (error instanceof Error) {
      throw new SceneSchedulingError("OWNERSHIP_INTEGRITY_VIOLATION", error.message);
    }
    throw error;
  }
}

function assertSameRoutingDecision(
  existing: PersistedSceneRoutingDecision,
  requested: PersistedSceneRoutingDecision
): void {
  // decidedAt is observational; identity is the deterministic integrity hash.
  if (
    existing.deterministicIntegrityHash !== requested.deterministicIntegrityHash ||
    existing.routingDecisionId !== requested.routingDecisionId ||
    existing.selectedProviderId !== requested.selectedProviderId ||
    existing.selectedAdapterVersion !== requested.selectedAdapterVersion ||
    existing.routerVersion !== requested.routerVersion ||
    existing.registrySnapshotHash !== requested.registrySnapshotHash
  ) {
    throw new SceneSchedulingError(
      "ROUTING_DECISION_CONFLICT",
      "Persisted routing decision conflicts with requested Scene schedule"
    );
  }
}

function assertSameEnvelope(existing: ExecutionEnvelope, requested: ExecutionEnvelope): void {
  if (
    existing.envelopeId !== requested.envelopeId ||
    existing.payloadReference !== requested.payloadReference ||
    existing.requestHash !== requested.requestHash ||
    existing.envelopeHash !== requested.envelopeHash
  ) {
    throw new SceneSchedulingError(
      "EXECUTION_ENVELOPE_CONFLICT",
      "Execution Envelope conflicts with requested Scene schedule"
    );
  }
}

function assertSameCorrelation(
  existing: SceneProviderSchedulingCorrelation,
  requested: SceneProviderSchedulingCorrelation
): void {
  if (existing.schedulingIdentityHash !== requested.schedulingIdentityHash) {
    throw new SceneSchedulingError(
      "OUTBOX_SCHEDULING_CONFLICT",
      "Scene scheduling correlation conflicts with an accepted scheduling identity"
    );
  }
  // scheduledAt is observational; identity is the scheduling identity hash + ids.
  if (
    existing.correlationId !== requested.correlationId ||
    existing.providerExecutionId !== requested.providerExecutionId ||
    existing.envelopeId !== requested.envelopeId ||
    existing.outboxJobId !== requested.outboxJobId ||
    existing.requestHash !== requested.requestHash ||
    existing.envelopeHash !== requested.envelopeHash
  ) {
    throw new SceneSchedulingError(
      "IDENTITY_CONFLICT",
      "Equivalent scheduling identity hash conflicts with persisted correlation"
    );
  }
}

function assertSameOutboxJob(
  existing: typeof schema.providerOutboxJobs.$inferSelect,
  input: CreateOutboxJobInput
): void {
  // nextVisibleAt is operational visibility timing, not schedule identity.
  // Concurrent equivalent writers keep the first persisted visibility time.
  if (
    existing.executionId !== input.executionId ||
    existing.payloadReference !== input.payloadReference ||
    existing.correlationId !== input.correlationId ||
    existing.priority !== (input.priority ?? 0)
  ) {
    throw new SceneSchedulingError(
      "OUTBOX_SCHEDULING_CONFLICT",
      "Outbox job conflicts with requested Scene schedule"
    );
  }
}

export class SceneSchedulingRepository {
  constructor(private readonly db: Db = getDb()) {}

  async scheduleAcceptedBundle(
    input: ScheduleAcceptedBundleInput
  ): Promise<SceneSchedulingBundle> {
    const transactionRequestedAt = performance.now();
    let transactionBodyCompletedAt = transactionRequestedAt;
    let poolWaitMs = 0;
    let serialDbRoundTripCount = 0;
    try {
      const bundle = await this.db.transaction(async (tx) => {
        poolWaitMs = performance.now() - transactionRequestedAt;
        const authFact = RuntimeAuthorizedFactSchema.parse(input.runtimeAuthorizedFact);
        const routingDecision = PersistedSceneRoutingDecisionSchema.parse(
          input.routingDecision
        );
        const correlation = SceneProviderSchedulingCorrelationSchema.parse(
          input.correlation
        );
        const envelope = await validateExecutionEnvelope(input.envelope);
        const compiledProviderRequest = AiStoryCompiledProviderRequestSchema.parse(
          input.compiledProviderRequest
        );

        serialDbRoundTripCount += 1;
        const plan = await lockExecutionPlan(authFact.executionPlanId, tx);
        serialDbRoundTripCount += 1;
        await assertExecutionPlanOwnershipChainInSingleQuery(plan, tx);
        const expected = planOwnershipFromRow(plan);

        const [releaseAuthority] = await observeStep(input, "release_state_load", async () => {
          serialDbRoundTripCount += 1;
          return tx
          .select({
            sceneExecutionId: schema.aiStorySceneExecutions.id,
            sceneExecutionPlanId: schema.aiStorySceneExecutions.executionPlanId,
            sceneOrgId: schema.aiStorySceneExecutions.orgId,
            sceneWorkspaceId: schema.aiStorySceneExecutions.workspaceId,
            sceneCampaignId: schema.aiStorySceneExecutions.campaignId,
            sceneStoryId: schema.aiStorySceneExecutions.storyId,
            sceneStoryVersionId: schema.aiStorySceneExecutions.storyVersionId,
            sceneAnimationPackageId:
              schema.aiStorySceneExecutions.animationPackageId,
            releaseState: schema.aiStorySceneReleaseStates.releaseState,
            persistedRuntimeFact: schema.aiStoryRuntimeAuthorizedFacts.fact,
          })
          .from(schema.aiStorySceneExecutions)
          .innerJoin(
            schema.aiStorySceneReleaseStates,
            and(
              eq(
                schema.aiStorySceneReleaseStates.sceneExecutionId,
                schema.aiStorySceneExecutions.id
              ),
              eq(
                schema.aiStorySceneReleaseStates.executionPlanId,
                schema.aiStorySceneExecutions.executionPlanId
              )
            )
          )
          .innerJoin(
            schema.aiStoryRuntimeAuthorizedFacts,
            eq(
              schema.aiStoryRuntimeAuthorizedFacts.runtimeAuthorizationId,
              schema.aiStorySceneReleaseStates.runtimeAuthorizationId
            )
          )
          .where(
            and(
              eq(schema.aiStorySceneExecutions.id, routingDecision.sceneExecutionId),
              eq(schema.aiStorySceneExecutions.executionPlanId, plan.id),
              eq(
                schema.aiStorySceneReleaseStates.workspaceId,
                expected.workspaceId
              ),
              eq(
                schema.aiStorySceneReleaseStates.runtimeAuthorizationId,
                authFact.runtimeAuthorizationId
              ),
              eq(schema.aiStorySceneReleaseStates.releaseState, "RELEASED")
            )
          )
          .limit(1);
        }, (value) => value[0] ? "PASS" : "MISS");
        if (
          !releaseAuthority ||
          !authFact.orderedSceneExecutionIds.includes(releaseAuthority.sceneExecutionId)
        ) {
          throw new SceneSchedulingError(
            "SCENE_SCHEDULING_NOT_ELIGIBLE",
            "Durable RELEASED Scene authority is required before provider scheduling"
          );
        }
        if (
          compiledProviderRequest.orgId !== expected.orgId ||
          compiledProviderRequest.workspaceId !== expected.workspaceId ||
          compiledProviderRequest.campaignId !== expected.campaignId ||
          compiledProviderRequest.storyId !== expected.storyId ||
          compiledProviderRequest.storyVersionId !== expected.storyVersionId ||
          compiledProviderRequest.sceneExecutionId !== releaseAuthority.sceneExecutionId ||
          compiledProviderRequest.providerId !== routingDecision.selectedProviderId ||
          compiledProviderRequest.adapterVersion !== routingDecision.selectedAdapterVersion ||
          envelope.executionContext.trace?.compiledRequestId !==
            compiledProviderRequest.compiledRequestId ||
          envelope.executionContext.trace?.compiledRequestFingerprint !==
            compiledProviderRequest.requestFingerprint
        ) {
          throw new SceneSchedulingError(
            "IDENTITY_CONFLICT",
            "Compiled Provider request does not match the accepted scheduling authority"
          );
        }
        const persistedAuth = await observeStep(
          input,
          "released_scene_projection",
          async () => RuntimeAuthorizedFactSchema.parse(releaseAuthority.persistedRuntimeFact)
        );
        assertPlanOwned(
          expected,
          {
            orgId: releaseAuthority.sceneOrgId,
            workspaceId: releaseAuthority.sceneWorkspaceId,
            campaignId: releaseAuthority.sceneCampaignId,
            storyId: releaseAuthority.sceneStoryId,
            storyVersionId: releaseAuthority.sceneStoryVersionId,
            animationPackageId: releaseAuthority.sceneAnimationPackageId,
            executionPlanId: releaseAuthority.sceneExecutionPlanId,
          },
          "Scene Execution"
        );
        if (
          persistedAuth.runtimeAuthorizationId !== authFact.runtimeAuthorizationId ||
          persistedAuth.executionPlanId !== authFact.executionPlanId ||
          persistedAuth.deterministicIntegrityHash !==
            authFact.deterministicIntegrityHash
        ) {
          throw new SceneSchedulingError(
            "IDENTITY_CONFLICT",
            "Persisted RuntimeAuthorizedFact conflicts with scheduling authority"
          );
        }

        for (const [label, ownership] of [
          ["RuntimeAuthorizedFact", authFact.ownership],
          ["Routing Decision", routingDecision.ownership],
          ["Scheduling Correlation", correlation.ownership],
        ] as const) {
          assertPlanOwned(
            expected,
            {
              orgId: ownership.orgId,
              workspaceId: ownership.workspaceId,
              campaignId: ownership.campaignId,
              storyId: ownership.storyId,
              storyVersionId: ownership.storyVersionId,
              animationPackageId: ownership.animationPackageId,
              executionPlanId: ownership.executionPlanId,
            },
            label
          );
        }

        if (
          routingDecision.executionPlanId !== plan.id ||
          routingDecision.sceneExecutionId !== releaseAuthority.sceneExecutionId ||
          routingDecision.runtimeAuthorizationId !== authFact.runtimeAuthorizationId ||
          routingDecision.automaticFallbackEnabled !== false
        ) {
          throw new SceneSchedulingError(
            "IDENTITY_CONFLICT",
            "Routing decision identity does not match RuntimeAuthorizedFact and Scene"
          );
        }
        if (
          correlation.executionPlanId !== plan.id ||
          correlation.sceneExecutionId !== releaseAuthority.sceneExecutionId ||
          correlation.runtimeAuthorizationId !== authFact.runtimeAuthorizationId ||
          correlation.routingDecisionId !== routingDecision.routingDecisionId ||
          correlation.providerExecutionId !== input.providerExecution.identity.executionId ||
          correlation.envelopeId !== envelope.envelopeId ||
          correlation.outboxJobId !== input.outboxJob.jobId ||
          correlation.requestHash !== input.requestHash ||
          correlation.requestHash !== envelope.requestHash ||
          correlation.envelopeHash !== envelope.envelopeHash ||
          correlation.routingDecisionHash !== routingDecision.deterministicIntegrityHash ||
          correlation.authorizationHash !== authFact.deterministicIntegrityHash ||
          correlation.scheduledBy !== input.scheduledBy
        ) {
          throw new SceneSchedulingError(
            "IDENTITY_CONFLICT",
            "Scheduling correlation identity does not match bundle inputs"
          );
        }
        if (
          input.outboxJob.executionId !== input.providerExecution.identity.executionId ||
          input.outboxJob.payloadReference !== envelope.payloadReference ||
          input.outboxJob.correlationId !== correlation.correlationId
        ) {
          throw new SceneSchedulingError(
            "OUTBOX_SCHEDULING_CONFLICT",
            "Outbox job identity does not match provider execution and envelope"
          );
        }

        failAfterTestStage(input, "runtime_authorization");

        const acceptedRoutingDecision = await observeStep(
          input,
          "routing_decision_write",
          async () => {
            serialDbRoundTripCount += 1;
            return this.insertRoutingDecision(tx, routingDecision, expected);
          }
        );
        failAfterTestStage(input, "routing_decision");
        await observeStep(input, "compiled_request_write", async () => {
          serialDbRoundTripCount += 1;
          return acceptAiStoryCompiledRequest(tx, compiledProviderRequest);
        });
        failAfterTestStage(input, "compiled_request");
        const providerExecution = await observeStep(
          input,
          "provider_execution_lookup_or_create",
          async () => {
            serialDbRoundTripCount += 1;
            return createProviderExecution(tx, input.providerExecution, input.requestHash);
          }
        );
        failAfterTestStage(input, "provider_execution");
        const outboxInserted = await observeStep(
          input,
          "verification_outbox_write",
          async () => {
            serialDbRoundTripCount += 1;
            return this.createOutboxJobInTransaction(
              tx,
              input.outboxJob,
              input.productionVerification
            );
          },
          (inserted) => inserted ? "PASS" : "CONVERGED"
        );
        input.observeTiming?.({
          step: "verification_outbox_lookup",
          durationMs: 0,
          transactionAuthority: "canonical_post_release_tx",
          connectionAuthority: "scene_scheduling_pool",
          outcome: outboxInserted ? "NOT_REQUIRED" : "CONVERGED",
        });
        if (input.productionVerification) {
          const verification = input.productionVerification;
          const insertedVerification = await observeStep(
            input,
            "verification_identity_write",
            async () => {
              serialDbRoundTripCount += 1;
              return tx
                .insert(schema.aiStoryExecuteVerifications)
                .values({
                  executionPlanId: plan.id,
                  runtimeAuthorizationId: authFact.runtimeAuthorizationId,
                  sceneExecutionId: releaseAuthority.sceneExecutionId,
                  workspaceId: expected.workspaceId,
                  outboxJobId: input.outboxJob.jobId,
                  verificationMode: true,
                  verificationPolicyVersion: verification.verificationPolicyVersion,
                  authorizedBy: verification.authorizedBy,
                  createdBy: verification.createdBy,
                })
                .onConflictDoNothing()
                .returning();
            },
            (rows) => rows[0] ? "PASS" : "CONVERGED"
          );
          if (!insertedVerification[0]) {
            const existingVerification = await observeStep(
              input,
              "verification_identity_lookup",
              async () => {
                serialDbRoundTripCount += 1;
                return this.getProductionVerificationInTransaction(tx, plan.id);
              },
              (value) => value ? "CONVERGED" : "MISS"
            );
            if (
              !existingVerification ||
              existingVerification.runtimeAuthorizationId !==
                authFact.runtimeAuthorizationId ||
              existingVerification.sceneExecutionId !== releaseAuthority.sceneExecutionId ||
              existingVerification.workspaceId !== expected.workspaceId ||
              existingVerification.outboxJobId !== input.outboxJob.jobId ||
              existingVerification.verificationMode !== true ||
              existingVerification.verificationPolicyVersion !==
                verification.verificationPolicyVersion ||
              existingVerification.authorizedBy !==
                verification.authorizedBy ||
              existingVerification.createdBy !== verification.createdBy
            ) {
              throw new SceneSchedulingError(
                "IDENTITY_CONFLICT",
                "Production verification identity conflicts with persisted authority"
              );
            }
          } else {
            input.observeTiming?.({
              step: "verification_identity_lookup",
              durationMs: 0,
              transactionAuthority: "canonical_post_release_tx",
              connectionAuthority: "scene_scheduling_pool",
              outcome: "NOT_REQUIRED",
            });
          }
        }
        failAfterTestStage(input, "outbox");
        serialDbRoundTripCount += 1;
        const acceptedEnvelope = await this.insertEnvelope(tx, envelope);
        failAfterTestStage(input, "envelope");
        const acceptedCorrelation = await observeStep(
          input,
          "scheduling_correlation_write",
          async () => {
            serialDbRoundTripCount += 1;
            return this.insertCorrelation(tx, correlation, expected);
          },
          (value) => value.replayed ? "CONVERGED" : "PASS"
        );
        input.observeTiming?.({
          step: "scheduling_correlation_lookup",
          durationMs: 0,
          transactionAuthority: "canonical_post_release_tx",
          connectionAuthority: "scene_scheduling_pool",
          outcome: acceptedCorrelation.replayed ? "CONVERGED" : "NOT_REQUIRED",
        });
        failAfterTestStage(input, "correlation");

        const acceptedBundle = SceneSchedulingBundleSchema.parse({
          correlation: acceptedCorrelation.correlation,
          routingDecision: acceptedRoutingDecision,
          runtimeAuthorization: persistedAuth,
          providerExecutionId: providerExecution.identity.executionId,
          envelopeId: acceptedEnvelope.envelopeId,
          outboxJobId: input.outboxJob.jobId,
          payloadReference: acceptedEnvelope.payloadReference,
          requestHash: acceptedEnvelope.requestHash,
          envelopeHash: acceptedEnvelope.envelopeHash,
          replayed: acceptedCorrelation.replayed,
          executionAllowed: false,
          executionLockCode: PHASE1_EXECUTION_LOCKED,
          automaticFallbackEnabled: false,
          authorizationContractVersion:
            persistedAuth.authorizationContractVersion,
          schedulingContractVersion: SCENE_SCHEDULING_CONTRACT_VERSION,
        });
        transactionBodyCompletedAt = performance.now();
        return acceptedBundle;
      });
      const commitMs = performance.now() - transactionBodyCompletedAt;
      input.observeTiming?.({
        step: "transaction_commit",
        durationMs: commitMs,
        transactionAuthority: "canonical_post_release_tx",
        connectionAuthority: "scene_scheduling_pool",
        outcome: "PASS",
      });
      input.observeBoundary?.({
        connectionAcquireCount: 1,
        transactionCount: 1,
        secondCheckoutAttempts: 0,
        serialDbRoundTripCount,
        poolWaitMs,
        commitMs,
      });
      return bundle;
    } catch (error) {
      return toSceneSchedulingError(error);
    }
  }

  async getCorrelationBySceneExecutionId(
    sceneExecutionId: string
  ): Promise<SceneProviderSchedulingCorrelation | null> {
    const [row] = await this.db
      .select()
      .from(schema.aiStorySceneSchedulingCorrelations)
      .where(eq(schema.aiStorySceneSchedulingCorrelations.sceneExecutionId, sceneExecutionId))
      .orderBy(asc(schema.aiStorySceneSchedulingCorrelations.acceptedAt))
      .limit(1);
    return row ? toCorrelation(row) : null;
  }

  async getRoutingDecisionBySceneExecutionId(
    sceneExecutionId: string
  ): Promise<PersistedSceneRoutingDecision | null> {
    const [row] = await this.db
      .select()
      .from(schema.aiStorySceneRoutingDecisions)
      .where(eq(schema.aiStorySceneRoutingDecisions.sceneExecutionId, sceneExecutionId))
      .limit(1);
    return row ? toRoutingDecision(row) : null;
  }

  async getAcceptedBundleBySceneExecutionId(
    sceneExecutionId: string
  ): Promise<SceneSchedulingBundle | null> {
    const [correlationRow] = await this.db
      .select()
      .from(schema.aiStorySceneSchedulingCorrelations)
      .where(eq(schema.aiStorySceneSchedulingCorrelations.sceneExecutionId, sceneExecutionId))
      .orderBy(asc(schema.aiStorySceneSchedulingCorrelations.acceptedAt))
      .limit(1);
    if (!correlationRow) return null;

    const correlation = toCorrelation(correlationRow);
    const [routingRow] = await this.db
      .select()
      .from(schema.aiStorySceneRoutingDecisions)
      .where(
        and(
          eq(
            schema.aiStorySceneRoutingDecisions.routingDecisionId,
            correlation.routingDecisionId
          ),
          eq(
            schema.aiStorySceneRoutingDecisions.sceneExecutionId,
            correlation.sceneExecutionId
          )
        )
      )
      .limit(1);
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
    const [providerExecutionRow] = await this.db
      .select()
      .from(schema.providerExecutions)
      .where(eq(schema.providerExecutions.executionId, correlation.providerExecutionId))
      .limit(1);
    const [envelopeRow] = await this.db
      .select()
      .from(schema.providerExecutionEnvelopes)
      .where(eq(schema.providerExecutionEnvelopes.envelopeId, correlation.envelopeId))
      .limit(1);
    const [outboxRow] = await this.db
      .select()
      .from(schema.providerOutboxJobs)
      .where(eq(schema.providerOutboxJobs.jobId, correlation.outboxJobId))
      .limit(1);

    if (
      !routingRow ||
      !authRow ||
      !providerExecutionRow ||
      !envelopeRow ||
      !outboxRow
    ) {
      throw new SceneSchedulingError(
        "IDENTITY_CONFLICT",
        "Accepted Scene scheduling correlation is missing dependent rows"
      );
    }

    const routingDecision = toRoutingDecision(routingRow);
    const runtimeAuthorization = RuntimeAuthorizedFactSchema.parse(authRow.fact);
    const envelope = await validateExecutionEnvelope(toEnvelope(envelopeRow));

    if (
      routingDecision.executionPlanId !== correlation.executionPlanId ||
      routingDecision.sceneExecutionId !== correlation.sceneExecutionId ||
      routingDecision.runtimeAuthorizationId !== correlation.runtimeAuthorizationId ||
      routingDecision.routingDecisionId !== correlation.routingDecisionId ||
      routingDecision.deterministicIntegrityHash !== correlation.routingDecisionHash ||
      runtimeAuthorization.executionPlanId !== correlation.executionPlanId ||
      runtimeAuthorization.runtimeAuthorizationId !== correlation.runtimeAuthorizationId ||
      runtimeAuthorization.deterministicIntegrityHash !== correlation.authorizationHash ||
      providerExecutionRow.executionId !== correlation.providerExecutionId ||
      providerExecutionRow.requestHash !== correlation.requestHash ||
      envelope.envelopeId !== correlation.envelopeId ||
      envelope.requestHash !== correlation.requestHash ||
      envelope.envelopeHash !== correlation.envelopeHash ||
      outboxRow.jobId !== correlation.outboxJobId ||
      outboxRow.executionId !== correlation.providerExecutionId ||
      outboxRow.payloadReference !== envelope.payloadReference ||
      outboxRow.correlationId !== correlation.correlationId
    ) {
      throw new SceneSchedulingError(
        "IDENTITY_CONFLICT",
        "Accepted Scene scheduling bundle has inconsistent dependent identity"
      );
    }

    return SceneSchedulingBundleSchema.parse({
      correlation,
      routingDecision,
      runtimeAuthorization,
      providerExecutionId: providerExecutionRow.executionId,
      envelopeId: envelope.envelopeId,
      outboxJobId: outboxRow.jobId,
      payloadReference: envelope.payloadReference,
      requestHash: envelope.requestHash,
      envelopeHash: envelope.envelopeHash,
      replayed: true,
      executionAllowed: false,
      executionLockCode: PHASE1_EXECUTION_LOCKED,
      automaticFallbackEnabled: false,
      authorizationContractVersion: runtimeAuthorization.authorizationContractVersion,
      schedulingContractVersion: SCENE_SCHEDULING_CONTRACT_VERSION,
    });
  }

  async getProductionVerification(executionPlanId: string) {
    return this.getProductionVerificationInTransaction(this.db, executionPlanId);
  }

  async listSchedulingCompletenessForPlan(
    executionPlanId: string
  ): Promise<ReadonlyMap<string, boolean>> {
    const scenes = await this.db
      .select({
        sceneId: schema.aiStorySceneExecutions.sceneId,
        sceneExecutionId: schema.aiStorySceneExecutions.id,
      })
      .from(schema.aiStorySceneExecutions)
      .where(eq(schema.aiStorySceneExecutions.executionPlanId, executionPlanId));

    if (scenes.length === 0) return new Map();

    const [authorization] = await this.db
      .select({
        runtimeAuthorizationId:
          schema.aiStoryRuntimeAuthorizedFacts.runtimeAuthorizationId,
      })
      .from(schema.aiStoryRuntimeAuthorizedFacts)
      .where(eq(schema.aiStoryRuntimeAuthorizedFacts.executionPlanId, executionPlanId))
      .limit(1);

    const sceneExecutionIds = scenes.map((scene) => scene.sceneExecutionId);
    const routingRows = await this.db
      .select({ sceneExecutionId: schema.aiStorySceneRoutingDecisions.sceneExecutionId })
      .from(schema.aiStorySceneRoutingDecisions)
      .where(inArray(schema.aiStorySceneRoutingDecisions.sceneExecutionId, sceneExecutionIds));
    const correlationRows = await this.db
      .select({
        sceneExecutionId: schema.aiStorySceneSchedulingCorrelations.sceneExecutionId,
        providerExecutionId:
          schema.aiStorySceneSchedulingCorrelations.providerExecutionId,
        envelopeId: schema.aiStorySceneSchedulingCorrelations.envelopeId,
        outboxJobId: schema.aiStorySceneSchedulingCorrelations.outboxJobId,
      })
      .from(schema.aiStorySceneSchedulingCorrelations)
      .where(
        inArray(
          schema.aiStorySceneSchedulingCorrelations.sceneExecutionId,
          sceneExecutionIds
        )
      );

    const providerExecutionIds = correlationRows.map((row) => row.providerExecutionId);
    const envelopeIds = correlationRows.map((row) => row.envelopeId);
    const outboxJobIds = correlationRows.map((row) => row.outboxJobId);
    const providerRows = providerExecutionIds.length
      ? await this.db
          .select({ executionId: schema.providerExecutions.executionId })
          .from(schema.providerExecutions)
          .where(inArray(schema.providerExecutions.executionId, providerExecutionIds))
      : [];
    const envelopeRows = envelopeIds.length
      ? await this.db
          .select({ envelopeId: schema.providerExecutionEnvelopes.envelopeId })
          .from(schema.providerExecutionEnvelopes)
          .where(inArray(schema.providerExecutionEnvelopes.envelopeId, envelopeIds))
      : [];
    const outboxRows = outboxJobIds.length
      ? await this.db
          .select({ jobId: schema.providerOutboxJobs.jobId })
          .from(schema.providerOutboxJobs)
          .where(inArray(schema.providerOutboxJobs.jobId, outboxJobIds))
      : [];

    const routingByScene = new Set(routingRows.map((row) => row.sceneExecutionId));
    const correlationByScene = new Map(
      correlationRows.map((row) => [row.sceneExecutionId, row])
    );
    const providerIds = new Set(providerRows.map((row) => row.executionId));
    const persistedEnvelopeIds = new Set(envelopeRows.map((row) => row.envelopeId));
    const persistedOutboxIds = new Set(outboxRows.map((row) => row.jobId));

    return new Map(
      scenes.map((scene) => {
        const correlation = correlationByScene.get(scene.sceneExecutionId);
        return [
          scene.sceneId,
          isSceneSchedulingBundleComplete({
            hasRuntimeAuthorization: Boolean(authorization),
            hasRoutingDecision: routingByScene.has(scene.sceneExecutionId),
            hasProviderExecution: correlation
              ? providerIds.has(correlation.providerExecutionId)
              : false,
            hasEnvelope: correlation
              ? persistedEnvelopeIds.has(correlation.envelopeId)
              : false,
            hasOutboxJob: correlation
              ? persistedOutboxIds.has(correlation.outboxJobId)
              : false,
            hasCorrelation: Boolean(correlation),
          }),
        ];
      })
    );
  }

  private async insertRoutingDecision(
    tx: Tx,
    decision: PersistedSceneRoutingDecision,
    expected: PlanOwnedRow
  ): Promise<PersistedSceneRoutingDecision> {
    assertPlanOwned(
      expected,
      { ...decision.ownership, executionPlanId: decision.executionPlanId },
      "Routing Decision"
    );
    const inserted = await tx
      .insert(schema.aiStorySceneRoutingDecisions)
      .values({
        routingDecisionId: decision.routingDecisionId,
        orgId: decision.ownership.orgId,
        workspaceId: decision.ownership.workspaceId,
        campaignId: decision.ownership.campaignId,
        storyId: decision.ownership.storyId,
        storyVersionId: decision.ownership.storyVersionId,
        animationPackageId: decision.ownership.animationPackageId,
        executionPlanId: decision.executionPlanId,
        sceneExecutionId: decision.sceneExecutionId,
        runtimeAuthorizationId: decision.runtimeAuthorizationId,
        capabilityId: decision.capabilityId,
        capabilityVersion: decision.capabilityVersion,
        selectedProviderId: decision.selectedProviderId,
        selectedAdapterVersion: decision.selectedAdapterVersion,
        routerVersion: decision.routerVersion,
        registrySnapshotHash: decision.registrySnapshotHash,
        capabilitySnapshot: decision.capabilitySnapshot,
        policySnapshot: decision.policySnapshot,
        candidateSummary: decision.candidateSummary.map((candidate) => ({
          ...candidate,
          exclusionCodes: [...candidate.exclusionCodes],
        })),
        decidedAt: new Date(decision.decidedAt),
        deterministicIntegrityHash: decision.deterministicIntegrityHash,
        automaticFallbackEnabled: decision.automaticFallbackEnabled,
        contractVersion: decision.contractVersion,
        decision,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) return toRoutingDecision(inserted[0]);

    const [existing] = await tx
      .select()
      .from(schema.aiStorySceneRoutingDecisions)
      .where(eq(schema.aiStorySceneRoutingDecisions.sceneExecutionId, decision.sceneExecutionId))
      .limit(1);
    if (!existing) {
      throw new SceneSchedulingError(
        "ROUTING_DECISION_CONFLICT",
        "Routing decision identity is already owned by another Scene schedule"
      );
    }
    const accepted = toRoutingDecision(existing);
    assertSameRoutingDecision(accepted, decision);
    return accepted;
  }

  private async createOutboxJobInTransaction(
    tx: Tx,
    input: CreateOutboxJobInput,
    productionVerification?: ProductionVerificationAuthority
  ): Promise<boolean> {
    const rows = await tx
      .insert(schema.providerOutboxJobs)
      .values({
        jobId: input.jobId,
        contractVersion: "1",
        executionId: input.executionId,
        payloadReference: input.payloadReference,
        correlationId: input.correlationId,
        status: productionVerification ? "CANCELLED" : "PENDING",
        priority: input.priority ?? 0,
        nextVisibleAt: input.nextVisibleAt ?? new Date(),
      })
      .onConflictDoNothing()
      .returning({ jobId: schema.providerOutboxJobs.jobId });
    if (rows[0]) return true;

    const [existing] = await tx
      .select()
      .from(schema.providerOutboxJobs)
      .where(eq(schema.providerOutboxJobs.jobId, input.jobId))
      .limit(1);
    if (!existing) {
      throw new SceneSchedulingError(
        "OUTBOX_SCHEDULING_CONFLICT",
        "Provider execution already owns a different outbox intent"
      );
    }
    const expectedStatus = productionVerification ? "CANCELLED" : "PENDING";
    if (existing.status !== expectedStatus) {
      throw new SceneSchedulingError(
        "OUTBOX_SCHEDULING_CONFLICT",
        "Outbox dispatch disposition conflicts with persisted intent"
      );
    }
    assertSameOutboxJob(existing, input);
    return false;
  }

  private async getProductionVerificationInTransaction(
    db: Pick<Tx, "select">,
    executionPlanId: string
  ) {
    const [row] = await db
      .select()
      .from(schema.aiStoryExecuteVerifications)
      .where(eq(schema.aiStoryExecuteVerifications.executionPlanId, executionPlanId))
      .limit(1);
    return row ?? null;
  }

  private async insertEnvelope(tx: Tx, input: ExecutionEnvelope): Promise<ExecutionEnvelope> {
    const envelope = await validateExecutionEnvelope(input);
    const rows = await tx
      .insert(schema.providerExecutionEnvelopes)
      .values({
        envelopeId: envelope.envelopeId,
        version: envelope.version,
        payloadReference: envelope.payloadReference,
        orgId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
        executionContext: envelope.executionContext,
        capabilityId: envelope.capabilityId,
        capabilityVersion: envelope.capabilityVersion,
        providerPolicySnapshot: envelope.providerPolicySnapshot,
        canonicalRequest: envelope.canonicalRequest,
        requestHash: envelope.requestHash,
        envelopeHash: envelope.envelopeHash,
        createdAt: new Date(envelope.createdAt),
      })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) return validateExecutionEnvelope(toEnvelope(rows[0]));

    const [existing] = await tx
      .select()
      .from(schema.providerExecutionEnvelopes)
      .where(
        or(
          eq(schema.providerExecutionEnvelopes.envelopeId, envelope.envelopeId),
          eq(
            schema.providerExecutionEnvelopes.payloadReference,
            envelope.payloadReference
          )
        )
      )
      .limit(1);
    if (!existing) {
      throw new SceneSchedulingError(
        "EXECUTION_ENVELOPE_CONFLICT",
        "Envelope ID or payload reference is already owned by another schedule"
      );
    }
    const accepted = await validateExecutionEnvelope(toEnvelope(existing));
    assertSameEnvelope(accepted, envelope);
    return accepted;
  }

  private async insertCorrelation(
    tx: Tx,
    correlation: SceneProviderSchedulingCorrelation,
    expected: PlanOwnedRow
  ): Promise<{
    readonly correlation: SceneProviderSchedulingCorrelation;
    readonly replayed: boolean;
  }> {
    assertPlanOwned(
      expected,
      { ...correlation.ownership, executionPlanId: correlation.executionPlanId },
      "Scheduling Correlation"
    );
    const inserted = await tx
      .insert(schema.aiStorySceneSchedulingCorrelations)
      .values({
        correlationId: correlation.correlationId,
        orgId: correlation.ownership.orgId,
        workspaceId: correlation.ownership.workspaceId,
        campaignId: correlation.ownership.campaignId,
        storyId: correlation.ownership.storyId,
        storyVersionId: correlation.ownership.storyVersionId,
        animationPackageId: correlation.ownership.animationPackageId,
        executionPlanId: correlation.executionPlanId,
        sceneExecutionId: correlation.sceneExecutionId,
        runtimeAuthorizationId: correlation.runtimeAuthorizationId,
        routingDecisionId: correlation.routingDecisionId,
        providerExecutionId: correlation.providerExecutionId,
        envelopeId: correlation.envelopeId,
        outboxJobId: correlation.outboxJobId,
        requestHash: correlation.requestHash,
        envelopeHash: correlation.envelopeHash,
        routingDecisionHash: correlation.routingDecisionHash,
        authorizationHash: correlation.authorizationHash,
        schedulingIdentityHash: correlation.schedulingIdentityHash,
        retryInputRevisionId: correlation.retryInputRevisionId ?? null,
        contractVersion: correlation.contractVersion,
        scheduledBy: correlation.scheduledBy,
        scheduledAt: new Date(correlation.scheduledAt),
        correlation,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) {
      return { correlation: toCorrelation(inserted[0]), replayed: false };
    }

    const [existing] = await tx
      .select()
      .from(schema.aiStorySceneSchedulingCorrelations)
      .where(
        eq(
          schema.aiStorySceneSchedulingCorrelations.schedulingIdentityHash,
          correlation.schedulingIdentityHash
        )
      )
      .limit(1);
    if (!existing) {
      throw new SceneSchedulingError(
        "OUTBOX_SCHEDULING_CONFLICT",
        "Scheduling correlation identity is already owned by another Scene schedule"
      );
    }
    const accepted = toCorrelation(existing);
    assertSameCorrelation(accepted, correlation);
    return { correlation: accepted, replayed: true };
  }
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
