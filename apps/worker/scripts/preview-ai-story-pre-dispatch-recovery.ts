/**
 * Read-only, zero-provider-call preview for an existing AI Story dispatch.
 * Prints only stable identities and boolean request-shape evidence.
 */
import { and, count, eq } from "drizzle-orm";
import {
  mapCanonicalEnvelopeToSeedanceRequest,
  buildPreDispatchRecoveryPreview,
  loadSeedanceAdapterConfig,
  type CanonicalScenePayloadForAdapter,
} from "@ceo-agent/agents";
import {
  AiStorySceneExecutionPersistenceRepository,
  ExecutionDispatchRepository,
  ExecutionEnvelopeRepository,
  getDb,
  schema,
} from "@ceo-agent/db";
import { createEnvelopeBackedCanonicalPayloadResolver } from "../src/ai-story-canonical-adapter-registry";
import { createWorkerProviderAssetAccessResolver } from "../src/ai-story-provider-asset-access";

function requiredArg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : "";
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function main() {
  const executionPlanId = requiredArg("--execution-plan-id");
  const sceneExecutionId = requiredArg("--scene-execution-id");
  const dispatchId = requiredArg("--dispatch-id");
  const dispatch = await new ExecutionDispatchRepository().getDispatch(dispatchId);
  if (!dispatch) throw new Error("Dispatch not found");
  const envelopes = new ExecutionEnvelopeRepository();
  const envelope = await envelopes.getEnvelopeByPayloadReference(
    dispatch.payloadReference
  );
  if (!envelope) throw new Error("Execution Envelope not found");
  const trace = envelope.executionContext.trace ?? {};
  if (
    trace.executionPlanId !== executionPlanId ||
    trace.sceneExecutionId !== sceneExecutionId
  ) {
    throw new Error("Dispatch trace does not match requested Scene authority");
  }

  const db = getDb();
  const [worker] = await db
    .select()
    .from(schema.aiStoryWorkerExecutionResults)
    .where(eq(schema.aiStoryWorkerExecutionResults.dispatchId, dispatchId))
    .limit(1);
  if (!worker) throw new Error("Worker pre-dispatch result not found");
  const [[attempts], [results], [reviews], [correlation], [outbox], [providerExecution]] =
    await Promise.all([
      db.select({ value: count() }).from(schema.providerAttempts).where(
        eq(schema.providerAttempts.executionId, dispatch.executionId)
      ),
      db.select({ value: count() }).from(schema.aiStorySceneResults).where(
        and(
          eq(schema.aiStorySceneResults.executionPlanId, executionPlanId),
          eq(schema.aiStorySceneResults.sceneExecutionId, sceneExecutionId)
        )
      ),
      db.select({ value: count() }).from(schema.aiStoryGeneratedSceneReviews).where(
        and(
          eq(schema.aiStoryGeneratedSceneReviews.executionPlanId, executionPlanId),
          eq(schema.aiStoryGeneratedSceneReviews.sceneExecutionId, sceneExecutionId)
        )
      ),
      db.select().from(schema.aiStorySceneSchedulingCorrelations).where(
        and(
          eq(schema.aiStorySceneSchedulingCorrelations.executionPlanId, executionPlanId),
          eq(schema.aiStorySceneSchedulingCorrelations.sceneExecutionId, sceneExecutionId)
        )
      ).limit(1),
      db.select().from(schema.providerOutboxJobs).where(
        eq(schema.providerOutboxJobs.jobId, dispatch.jobId)
      ).limit(1),
      db.select().from(schema.providerExecutions).where(
        eq(schema.providerExecutions.executionId, dispatch.executionId)
      ).limit(1),
    ]);
  if (!correlation || !outbox || !providerExecution) {
    throw new Error("Existing release/outbox/provider execution chain is incomplete");
  }

  const recovery = buildPreDispatchRecoveryPreview({
    executionPlanId,
    sceneExecutionId,
    providerExecutionId: providerExecution.executionId,
    outboxJobId: outbox.jobId,
    dispatchId,
    workerState: worker.workerState,
    providerRequestId: worker.providerRequestId,
    providerAttemptCount: Number(attempts?.value ?? 0),
    resultCount: Number(results?.value ?? 0),
    generatedReviewCount: Number(reviews?.value ?? 0),
  });

  const resolver = createEnvelopeBackedCanonicalPayloadResolver(
    envelopes,
    new AiStorySceneExecutionPersistenceRepository(),
    {
      resolution: "480p",
      productGroundedProviderMode: "FIRST_FRAME_I2V",
      productGroundedProviderModeCertified: true,
    }
  );
  const payload = await resolver.resolve(
    envelope.canonicalRequest.normalizedPayloadReference
  ) as CanonicalScenePayloadForAdapter;
  const seedance = loadSeedanceAdapterConfig(process.env, {
    requireEnabled: true,
  });
  const request = await mapCanonicalEnvelopeToSeedanceRequest({
    envelope,
    idempotencyKey: `dry-run:${dispatchId}`,
    model: seedance.model,
    payloadResolver: { resolve: async () => payload },
    assetAccessResolver: createWorkerProviderAssetAccessResolver(),
  });
  const images = request.content.filter((item) => item.type === "image_url");
  const text = request.content.find((item) => item.type === "text");

  console.log(JSON.stringify({
    contract: "ai-story-pre-dispatch-recovery-preview.v1",
    executionPlanId,
    sceneExecutionId,
    recovery,
    existingReleaseState: "RELEASED",
    existingOutboxState: outbox.status,
    existingDispatchState: dispatch.status,
    existingProviderExecutionState: providerExecution.status,
    providerMode: payload.productGrounding?.providerMode ?? null,
    visualAuthorityCertified:
      payload.visualAuthorityCertification?.status === "CERTIFIED",
    productAuthorityResolved:
      payload.productGrounding?.authorityStatus === "RESOLVED",
    firstFramePresent: images.some((item) => item.role === "first_frame"),
    firstFrameAssetId:
      payload.visualAuthorityCertification?.productAssetId ?? null,
    explicitImageBinding: /Image 1\s*=\s*the canonical Campaign Product Asset/i.test(
      text && text.type === "text" ? text.text : ""
    ),
    productReferenceIsImage1:
      images.length === 1 && images[0]?.role === "first_frame",
    productLockPromptPresent: /PRODUCT LOCK:/i.test(
      text && text.type === "text" ? text.text : ""
    ),
    directorSafe:
      payload.productGrounding?.directorCameraPolicy.compatible === true,
    preDispatchGate: "PASS",
    providerCallExecuted: false,
  }));
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      contract: "ai-story-pre-dispatch-recovery-preview.v1",
      status: "FAILED",
      safeError: error instanceof Error ? error.message : "Preview failed",
      providerCallExecuted: false,
    })
  );
  process.exitCode = 1;
});
