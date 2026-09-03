import "dotenv/config";
import {
  SupersedeAiStoryPreDispatchBundleService,
  applyRetryInputRevision,
  buildAiStoryPreDispatchSuccessorBundle,
  compileImmutableSceneProviderRequest,
} from "@ceo-agent/agents";
import {
  AiStoryPreDispatchBundleSupersessionRepository,
  AiStoryProviderRuntimeRepository,
  DifferentiatedRetryRepository,
  GeneratedSceneReviewRepository,
} from "@ceo-agent/db";

const SCENE_EXECUTION_ID = "e2c4b414-2bec-5f44-8f3e-95e88f8ae31a";
const RETRY_AUTHORIZATION_ID = "54ea215c-5dc7-570e-b004-15bbd7bb8173";
const SOURCE = {
  compiledRequestId: "5f111fc9-2fe2-563e-a658-60216f7b52c9",
  requestFingerprint: "sha256:73cce2460a93d3e32ad0497dd43367241854a838b7c06159f35ec4832a42d914",
  correlationId: "72725b41-25e8-5fde-9a21-9312d0b879cf",
  outboxJobId: "ff305466-3f7f-5a95-83a0-5ada5d88a3b1",
  dispatchId: "dispatch:8516aaf45d1a05aaf4a0aa3a1cf71dca0aff21e5804e07bddfaac28ff43cc36f",
} as const;
const TARGET_CONTRACT_VERSION = "review-retry-creative-instruction-precedence.v1";

async function main() {
  if ((process.env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase() !== "staging") throw new Error("STAGING_REQUIRED");
  if (process.env.AI_STORY_PROVIDER_DISPATCH_MODE !== "certification_no_dispatch") throw new Error("HOLD_REQUIRED");

  const repository = new AiStoryPreDispatchBundleSupersessionRepository();
  const loaded = await repository.loadSourceBundle({ sceneExecutionId: SCENE_EXECUTION_ID, source: SOURCE });
  const retries = new DifferentiatedRetryRepository();
  const authorization = await retries.getAuthorization(RETRY_AUTHORIZATION_ID);
  if (!authorization || authorization.sceneExecutionId !== SCENE_EXECUTION_ID || authorization.status !== "CONSUMED") throw new Error("RETRY_AUTHORITY_CONFLICT");
  if (loaded.bundle.correlation.retryInputRevisionId !== authorization.retryInputRevisionId) throw new Error("RETRY_REVISION_CONFLICT");
  const revision = await retries.getRevision(authorization.retryInputRevisionId);
  if (!revision || revision.sourceReviewId !== authorization.sourceReviewId) throw new Error("RETRY_REVISION_MISSING");
  const review = (await new GeneratedSceneReviewRepository().listByExecutionPlanId(authorization.executionPlanId))
    .find((candidate) => candidate.generatedSceneReviewId === authorization.sourceReviewId);
  if (!review || review.decision !== "REJECTED" || !review.rationale) throw new Error("HUMAN_REVIEW_CORRECTION_MISSING");

  const instructions = applyRetryInputRevision(loaded.instructions, revision, {
    latestHumanReviewCorrection: review.rationale,
  });
  const sourceRequest = loaded.bundle.compiledProviderRequest;
  const referenceIds = (loaded.intent.generationAuthority ?? loaded.instructions.generationAuthority)?.effectiveReferenceIds ?? loaded.intent.referencedAssetIds;
  const referenceAssets = await new AiStoryProviderRuntimeRepository().getReferenceAssetAuthorities({
    orgId: sourceRequest.orgId,
    workspaceId: sourceRequest.workspaceId,
    campaignId: sourceRequest.campaignId,
    assetIds: referenceIds,
  });
  const compiledAt = new Date(Date.parse(loaded.bundle.correlation.scheduledAt) + 1_000).toISOString();
  const corrected = compileImmutableSceneProviderRequest({
    providerId: sourceRequest.providerId,
    adapterVersion: loaded.bundle.routingDecision.selectedAdapterVersion,
    intent: loaded.intent,
    instructions,
    authority: {
      qcEvaluationId: sourceRequest.qcEvaluationId,
      qcFingerprint: sourceRequest.qcFingerprint,
      qcCapabilityVersion: sourceRequest.qcCapabilityVersion,
      directorFingerprint: sourceRequest.directorFingerprint,
      motionFingerprint: sourceRequest.motionFingerprint,
    },
    compiledAt,
    resolution: sourceRequest.structuredRequest.resolution,
    referenceAssets,
  });
  // Content readiness is a Provider-facing gate, so inspect the exact compiled
  // prompt rather than the broader instruction object or immutable review prose.
  const activeText = corrected.compiledPrompt.toLowerCase();
  const readiness = {
    urbanWalkway: /urban[^.]{0,80}walkway|urban pedestrian walkway/.test(activeText),
    maraCarryingBouquet: activeText.includes("mara") && /carr(?:y|ies|ying)[^.]*(?:bouquet)|bouquet[^.]*carr/.test(activeText),
    movement: /walking|moving forward|move through|walkway/.test(activeText),
    explicitCourier: activeText.includes("courier") || activeText.includes("delivery worker"),
    bouquetContinuity: /same[^.]{0,80}bouquet|bouquet continuity|recognizable spring bouquet/.test(activeText),
    narrativeProgression: activeText.includes("delivery journey") || activeText.includes("transition"),
    conflictingPresentationAbsent: !activeText.includes("shop owner presenting the bouquet") && !activeText.includes("workbench presentation"),
    providerContract: corrected.generationMode === "FIRST_FRAME_IMAGE_TO_VIDEO" && corrected.storyReferenceMappings?.length === 3 && corrected.referenceMappings.length === 1 && corrected.referenceMappings[0]?.wireRole === "first_frame",
  };
  if (Object.values(readiness).some((value) => !value)) throw new Error(`CONTENT_READINESS_FAILED:${JSON.stringify(readiness)}`);

  const built = await buildAiStoryPreDispatchSuccessorBundle({
    source: loaded.bundle,
    sourceDispatch: loaded.dispatch,
    compiledProviderRequest: corrected,
    targetContractVersion: TARGET_CONTRACT_VERSION,
    createdAt: compiledAt,
  });
  const command = {
    orgId: sourceRequest.orgId,
    workspaceId: sourceRequest.workspaceId,
    sceneExecutionId: SCENE_EXECUTION_ID,
    source: SOURCE,
    successor: built.successor,
    successorDispatch: built.dispatch,
    reason: "REVIEW_RETRY_CREATIVE_INSTRUCTION_PRECEDENCE_DEFECT" as const,
    actorUserId: authorization.authorizedBy,
    idempotencyKey: `supersede:${SOURCE.dispatchId}:${TARGET_CONTRACT_VERSION}`,
    targetContractVersion: TARGET_CONTRACT_VERSION,
    createdAt: new Date(compiledAt),
  };
  const service = new SupersedeAiStoryPreDispatchBundleService(repository);
  const first = await service.execute(command);
  const replay = await service.execute(command);
  console.log(JSON.stringify({
    contract: TARGET_CONTRACT_VERSION,
    hold: "ACTIVE",
    reviewAuthorityId: review.generatedSceneReviewId,
    retryAuthorizationId: authorization.retryAuthorizationId,
    supersessionId: first.supersessionId,
    reason: first.reason,
    actorUserId: command.actorUserId,
    source: first.source,
    successor: first.successor,
    integrityHash: first.integrityHash,
    replayConverged: replay.replayed,
    readiness,
    provider: { mode: corrected.generationMode, storyReferences: corrected.storyReferenceMappings?.length ?? 0, images: corrected.referenceMappings.length, firstFrameAssetId: corrected.referenceMappings[0]?.assetId ?? null, supportingImageEmitted: false, continuityVideoEmitted: false },
    providerCallExecuted: false,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAILED", safeError: error instanceof Error ? error.message : "Repair failed", providerCallExecuted: false }));
  process.exitCode = 1;
});
