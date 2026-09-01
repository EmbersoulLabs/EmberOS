import { and, count, eq } from "drizzle-orm";
import {
  compileImmutableSceneProviderRequest,
  compiledProviderRequestIdForSchedule,
} from "@ceo-agent/agents";
import {
  AiStoryProviderRuntimeRepository,
  AiStorySceneExecutionPersistenceRepository,
  CertificationCommercialAuthorityService,
  SceneSchedulingRepository,
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
  getDb,
  schema,
} from "@ceo-agent/db";
import { AiStorySceneCompiledInstructionsSchema } from "@ceo-agent/shared";

const TARGET = {
  executionPlanId: "0578168f-003f-542c-be3b-28d4b7a37873",
  sceneExecutionId: "71925021-9892-560d-8156-55914e669fd5",
  expectedProvider: "seedance",
  expectedModel: "dreamina-seedance-2-0-260128",
} as const;

function requireSafeRuntime(): void {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "staging") {
    throw new Error("STAGING_ENVIRONMENT_REQUIRED");
  }
  if (process.env.AI_STORY_PROVIDER_DISPATCH_MODE !== "certification_no_dispatch") {
    throw new Error("CERTIFICATION_NO_DISPATCH_HOLD_REQUIRED");
  }
}

async function main(): Promise<void> {
  requireSafeRuntime();
  const apply = process.argv.includes("--apply");
  const db = getDb();
  const scheduling = new SceneSchedulingRepository(db);
  const runtime = new AiStoryProviderRuntimeRepository(db);
  const compilationRepo = new AiStorySceneExecutionPersistenceRepository(db);

  const bundle = await scheduling.getAcceptedBundleBySceneExecutionId(
    TARGET.sceneExecutionId
  );
  if (!bundle || bundle.correlation.executionPlanId !== TARGET.executionPlanId) {
    throw new Error("ACCEPTED_T2V_SCHEDULING_BUNDLE_REQUIRED");
  }
  if (bundle.routingDecision.selectedProviderId !== TARGET.expectedProvider) {
    throw new Error("T2V_PROVIDER_BINDING_CONFLICT");
  }

  const [outbox] = await db
    .select({
      completedAt: schema.providerOutboxJobs.completedAt,
      deadLetterAt: schema.providerOutboxJobs.deadLetterAt,
    })
    .from(schema.providerOutboxJobs)
    .where(eq(schema.providerOutboxJobs.jobId, bundle.outboxJobId))
    .limit(1);
  if (!outbox || outbox.completedAt || outbox.deadLetterAt) {
    throw new Error("ACCEPTED_OUTBOX_NOT_SAFE_TO_CONVERGE");
  }

  const compilation = await compilationRepo.getByExecutionPlanId(
    TARGET.executionPlanId
  );
  const intent = compilation?.intents.find(
    (candidate) => candidate.identity.sceneExecutionId === TARGET.sceneExecutionId
  );
  const instructions = compilation
    ? AiStorySceneCompiledInstructionsSchema.parse(
        compilation.instructionsBySceneExecutionId[TARGET.sceneExecutionId]
      )
    : null;
  if (!compilation || !intent || !instructions) {
    throw new Error("PERSISTED_T2V_COMPILATION_AUTHORITY_REQUIRED");
  }
  const persistedAuthority = await runtime.getCompilationAuthorityBySceneExecutionId({
    sceneExecutionId: TARGET.sceneExecutionId,
    orgId: bundle.correlation.ownership.orgId,
    workspaceId: bundle.correlation.ownership.workspaceId,
    storyId: bundle.correlation.ownership.storyId,
    storyVersionId: bundle.correlation.ownership.storyVersionId,
  });
  const validationResults = compilation.validationResults.filter(
    (result) => result.intentId === TARGET.sceneExecutionId
  );
  if (
    validationResults.length === 0 ||
    validationResults.some((result) => result.status === "failed")
  ) {
    throw new Error("FROZEN_T2V_VALIDATION_AUTHORITY_REQUIRED");
  }
  const authority = persistedAuthority ?? {
    qcEvaluationId: deterministicPersistenceUuid(
      "ai-story-scene-intent-validation-authority",
      { sceneExecutionId: TARGET.sceneExecutionId, validationResults }
    ),
    qcFingerprint: canonicalPersistenceHash({
      kind: "ai-story-scene-intent-validation-authority.v1",
      sceneExecutionId: TARGET.sceneExecutionId,
      validationResults,
    }),
    qcCapabilityVersion: "ai-story-scene-intent-validation.v1",
    directorFingerprint: canonicalPersistenceHash({
      kind: "ai-story-director-instruction-snapshot.v1",
      sceneExecutionId: TARGET.sceneExecutionId,
      shots: instructions.shots,
    }),
    motionFingerprint: canonicalPersistenceHash({
      kind: "ai-story-motion-instruction-snapshot.v1",
      sceneExecutionId: TARGET.sceneExecutionId,
      durationMs: instructions.durationMs,
      shots: instructions.shots.map((shot) => ({
        shotId: shot.shotId,
        durationMs: shot.durationMs,
        cameraMovement: shot.cameraMovement,
      })),
    }),
  };

  const expectedRequest = compileImmutableSceneProviderRequest({
    providerId: bundle.routingDecision.selectedProviderId,
    adapterVersion: bundle.routingDecision.selectedAdapterVersion,
    intent,
    instructions,
    authority,
    compiledAt: bundle.correlation.scheduledAt,
    resolution: "480p",
  });
  const expectedId = compiledProviderRequestIdForSchedule({
    sceneExecutionId: TARGET.sceneExecutionId,
    scheduledAt: bundle.correlation.scheduledAt,
  });
  if (expectedRequest.compiledRequestId !== expectedId) {
    throw new Error("COMPILED_REQUEST_IDENTITY_DIVERGENT");
  }
  if (expectedRequest.modelId !== TARGET.expectedModel) {
    throw new Error("T2V_COMPILED_MODEL_BINDING_CONFLICT");
  }

  const before = await runtime.getCompiledRequest(expectedId);
  let persisted = before;
  if (apply) {
    persisted = await runtime.convergeCompiledRequestForAcceptedBundle({
      bundle,
      compiledProviderRequest: expectedRequest,
    });
  }
  if (persisted && persisted.requestFingerprint !== expectedRequest.requestFingerprint) {
    throw new Error("COMPILED_REQUEST_FINGERPRINT_CONFLICT");
  }

  let pricingRuleId: string | null = null;
  if (persisted) {
    const preview = await new CertificationCommercialAuthorityService(db)
      .previewForSceneExecution({
        orgId: persisted.orgId,
        workspaceId: persisted.workspaceId,
        sceneExecutionId: persisted.sceneExecutionId,
        compiledRequestId: persisted.compiledRequestId,
        requestFingerprint: persisted.requestFingerprint,
        executionIdentity: `certification-preview:${persisted.sceneExecutionId}`,
        reservedAt: new Date().toISOString(),
      });
    pricingRuleId = preview.pricingRule.providerUsdPricingRuleId;
  }

  const [attempts] = await db
    .select({ value: count() })
    .from(schema.aiStoryProviderAttemptCompiledBindings)
    .where(eq(
      schema.aiStoryProviderAttemptCompiledBindings.sceneExecutionId,
      TARGET.sceneExecutionId
    ));
  const [reservations] = await db
    .select({ value: count() })
    .from(schema.certificationCommercialReservations)
    .where(and(
      eq(schema.certificationCommercialReservations.orgId, bundle.correlation.ownership.orgId),
      eq(schema.certificationCommercialReservations.workspaceId, bundle.correlation.ownership.workspaceId)
    ));
  const [outboxes] = await db
    .select({ value: count() })
    .from(schema.aiStorySceneSchedulingCorrelations)
    .where(eq(
      schema.aiStorySceneSchedulingCorrelations.sceneExecutionId,
      TARGET.sceneExecutionId
    ));

  if ((attempts?.value ?? 0) !== 0 || (reservations?.value ?? 0) !== 0) {
    throw new Error("COMMERCIAL_NON_CONSUMPTION_VIOLATION");
  }
  if ((outboxes?.value ?? 0) !== 1) throw new Error("OUTBOX_IDEMPOTENCY_VIOLATION");

  console.info(JSON.stringify({
    mode: apply ? "APPLY" : "INSPECT",
    classification: "SAFE_TO_CONVERGE_IN_PLACE",
    sceneExecutionId: TARGET.sceneExecutionId,
    outboxJobId: bundle.outboxJobId,
    outboxStatus: "VISIBLE_UNCOMPLETED",
    compiledRequestId: expectedId,
    requestFingerprint: expectedRequest.requestFingerprint,
    compiledRequestBefore: before ? "PRESENT" : "MISSING",
    compiledRequestAfter: persisted ? "PRESENT" : "MISSING",
    pricing: pricingRuleId ? "PASS" : "NOT_RUN",
    pricingRuleId,
    outboxCount: outboxes?.value ?? 0,
    providerAttempts: attempts?.value ?? 0,
    commercialReservations: reservations?.value ?? 0,
    providerDispatch: 0,
  }));
}

await main();
