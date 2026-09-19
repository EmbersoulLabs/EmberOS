/**
 * STAGING-only pre-dispatch convergence for the retained scene-001 authority.
 *
 * This uses the canonical immutable Dispatch materializer, but never claims the
 * Dispatch, creates commercial reservations/Attempts, or invokes a Provider.
 */
import { and, count, eq, isNotNull } from "drizzle-orm";
import {
  AiStoryProviderRuntimeRepository,
  ExecutionDispatchRepository,
  ExecutionEnvelopeRepository,
  RuntimeAuthorizationPersistenceRepository,
  SceneSchedulingRepository,
  getDb,
  schema,
} from "@ceo-agent/db";
import {
  createCanonicalExecuteProviderRouter,
  releaseNextEligibleScene,
  resolveCanonicalExecuteRoutingPolicy,
} from "@ceo-agent/agents";
import { readProviderExecutorAuthority } from "@ceo-agent/queue";
import { ProviderExecutionDispatcher } from "../src/provider-execution-dispatcher";

const TARGET = {
  executionPlanId: "0578168f-003f-542c-be3b-28d4b7a37873",
  sceneExecutionId: "e2c4b414-2bec-5f44-8f3e-95e88f8ae31a",
  providerId: "seedance",
  modelId: "dreamina-seedance-2-0-260128",
} as const;

function requireSafeRuntime(): void {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "staging") {
    throw new Error("STAGING_ENVIRONMENT_REQUIRED");
  }
  if (process.env.AI_STORY_PROVIDER_DISPATCH_MODE !== "certification_no_dispatch") {
    throw new Error("CERTIFICATION_NO_DISPATCH_HOLD_REQUIRED");
  }
}

async function commercialCounts(db: ReturnType<typeof getDb>) {
  const [reservations] = await db
    .select({ value: count() })
    .from(schema.certificationCommercialReservations);
  const [submissions] = await db
    .select({ value: count() })
    .from(schema.certificationCommercialReservations)
    .where(isNotNull(schema.certificationCommercialReservations.submittedAt));
  const [attempts] = await db
    .select({ value: count() })
    .from(schema.aiStoryProviderAttemptCompiledBindings)
    .where(eq(
      schema.aiStoryProviderAttemptCompiledBindings.sceneExecutionId,
      TARGET.sceneExecutionId
    ));
  const [tasks] = await db
    .select({ value: count() })
    .from(schema.aiStoryProviderAttemptCompiledBindings)
    .where(and(
      eq(
        schema.aiStoryProviderAttemptCompiledBindings.sceneExecutionId,
        TARGET.sceneExecutionId
      ),
      isNotNull(schema.aiStoryProviderAttemptCompiledBindings.providerTaskId)
    ));
  return {
    reservations: reservations?.value ?? 0,
    submissions: submissions?.value ?? 0,
    attempts: attempts?.value ?? 0,
    tasks: tasks?.value ?? 0,
  };
}

async function main(): Promise<void> {
  requireSafeRuntime();
  const apply = process.argv.includes("--apply");
  const db = getDb();
  const scheduling = new SceneSchedulingRepository(db);
  const runtime = new AiStoryProviderRuntimeRepository(db);
  const dispatches = new ExecutionDispatchRepository(db);
  const before = await commercialCounts(db);
  if (before.attempts !== 0 || before.tasks !== 0) {
    throw new Error("I2V_PAID_EXECUTION_ALREADY_EXISTS");
  }

  if (apply) {
    const runtimeAuthorization = await new RuntimeAuthorizationPersistenceRepository(
      db
    ).getByExecutionPlanId(TARGET.executionPlanId);
    if (!runtimeAuthorization?.executionAuthorization) {
      throw new Error("CANONICAL_RUNTIME_EXECUTION_AUTHORITY_REQUIRED");
    }
    const workerAuthority = await readProviderExecutorAuthority();
    if (!workerAuthority) {
      throw new Error("CANONICAL_WORKER_PROVIDER_AUTHORITY_REQUIRED");
    }
    const providerOptions = {
      executorAuthorities: workerAuthority.capabilities,
    };
    await releaseNextEligibleScene({
      executionPlanId: TARGET.executionPlanId,
      workspaceId: runtimeAuthorization.ownership.workspaceId,
      actorUserId: runtimeAuthorization.authorizedBy,
      executionAuthorization: {
        ...runtimeAuthorization.executionAuthorization,
        allowed: true,
      },
      router: createCanonicalExecuteProviderRouter(providerOptions),
      routingPolicy: resolveCanonicalExecuteRoutingPolicy(providerOptions),
    });
  }

  const bundle = await scheduling.getAcceptedBundleBySceneExecutionId(
    TARGET.sceneExecutionId
  );
  if (
    !bundle ||
    bundle.correlation.executionPlanId !== TARGET.executionPlanId ||
    bundle.routingDecision.selectedProviderId !== TARGET.providerId ||
    !bundle.correlation.commercialAuthorizationId
  ) {
    throw new Error("CANONICAL_I2V_SCHEDULING_AUTHORITY_REQUIRED");
  }
  const compiled = await runtime.getCompiledRequestBySceneExecutionId(
    TARGET.sceneExecutionId
  );
  if (
    !compiled ||
    compiled.providerId !== TARGET.providerId ||
    compiled.modelId !== TARGET.modelId ||
    compiled.sceneExecutionId !== TARGET.sceneExecutionId
  ) {
    throw new Error("CANONICAL_I2V_COMPILED_REQUEST_REQUIRED");
  }

  let dispatch = await dispatches.getDispatchByJobId(bundle.outboxJobId);
  if (apply && !dispatch) {
    const selected = await dispatches.selectEligibleJob(new Date(), {
      ownership: "AI_STORY_SCENE",
    });
    if (!selected || selected.jobId !== bundle.outboxJobId) {
      throw new Error("TARGET_I2V_OUTBOX_IS_NOT_NEXT_CANONICAL_DISPATCH");
    }
    const dispatcher = new ProviderExecutionDispatcher(
      {
        selectEligibleJob: async () => selected,
        createDispatch: (input) => dispatches.createDispatch(input),
        getDispatchByJobId: (jobId) => dispatches.getDispatchByJobId(jobId),
      },
      new ExecutionEnvelopeRepository(db),
      { now: () => new Date() }
    );
    const outcome = await dispatcher.dispatchNext({ ownership: "AI_STORY_SCENE" });
    if (outcome.status !== "DISPATCHED") {
      throw new Error("I2V_DISPATCH_MATERIALIZATION_FAILED");
    }
    dispatch = outcome.dispatch;
  }

  const after = await commercialCounts(db);
  if (
    after.reservations !== before.reservations ||
    after.submissions !== before.submissions ||
    after.attempts !== 0 ||
    after.tasks !== 0
  ) {
    throw new Error("COMMERCIAL_NON_CONSUMPTION_VIOLATION");
  }

  console.info(JSON.stringify({
    mode: apply ? "APPLY" : "INSPECT",
    contract: "staged-release-pre-dispatch-convergence.v1",
    hold: "certification_no_dispatch",
    executionPlanId: TARGET.executionPlanId,
    sceneExecutionId: TARGET.sceneExecutionId,
    commercialAuthorizationId: bundle.correlation.commercialAuthorizationId,
    compiledRequestId: compiled.compiledRequestId,
    fingerprint: compiled.requestFingerprint,
    correlationId: bundle.correlation.correlationId,
    outboxJobId: bundle.outboxJobId,
    dispatchId: dispatch?.dispatchId ?? null,
    providerId: compiled.providerId,
    modelId: compiled.modelId,
    commercialReservationsBefore: before.reservations,
    commercialReservationsAfter: after.reservations,
    providerSubmissionsBefore: before.submissions,
    providerSubmissionsAfter: after.submissions,
    i2vProviderAttempts: after.attempts,
    i2vProviderTasks: after.tasks,
    providerClaimed: false,
    providerInvoked: false,
  }));
}

await main();
