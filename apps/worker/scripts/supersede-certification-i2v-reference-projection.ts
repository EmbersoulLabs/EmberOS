import "dotenv/config";
import {
  SupersedeAiStoryPreDispatchBundleService,
  buildAiStoryPreDispatchSuccessorBundle,
  compileImmutableSceneProviderRequest,
} from "@ceo-agent/agents";
import {
  AiStoryPreDispatchBundleSupersessionRepository,
  AiStoryProviderRuntimeRepository,
} from "@ceo-agent/db";

const SCENE_EXECUTION_ID = "e2c4b414-2bec-5f44-8f3e-95e88f8ae31a";
const SOURCE = {
  compiledRequestId: "a0536a56-21f7-5cfc-8cba-8c076ae6cbc9",
  requestFingerprint: "sha256:2c2fcbb6b8e3f4e6d82bfa8502a42b37be0b1e41a1d1378949a619f5f411d6bf",
  correlationId: "c0b0f6a4-68c7-539c-b1e4-3578ba85af52",
  outboxJobId: "9db6fcb9-cc3b-58e6-9aab-6b61e031b971",
  dispatchId: "dispatch:9e2d247c54a57b07f4ed04c961c2fa5344b6c5fc0d984c472f8d649420b157b2",
} as const;
const TARGET_CONTRACT_VERSION = "i2v-reference-role-provider-projection.v2";

async function main() {
  if ((process.env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase() !== "staging") throw new Error("STAGING_REQUIRED");
  if (process.env.AI_STORY_PROVIDER_DISPATCH_MODE !== "certification_no_dispatch") throw new Error("CERTIFICATION_NO_DISPATCH_HOLD_REQUIRED");
  const repository = new AiStoryPreDispatchBundleSupersessionRepository();
  const loaded = await repository.loadSourceBundle({ sceneExecutionId: SCENE_EXECUTION_ID, source: SOURCE });
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
    instructions: loaded.instructions,
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
    reason: "I2V_PROVIDER_INPUT_PROJECTION_DEFECT" as const,
    actorUserId: loaded.bundle.scheduledBy,
    idempotencyKey: `supersede:${SOURCE.dispatchId}:${TARGET_CONTRACT_VERSION}`,
    targetContractVersion: TARGET_CONTRACT_VERSION,
    createdAt: new Date(compiledAt),
  };
  const service = new SupersedeAiStoryPreDispatchBundleService(repository);
  const first = await service.execute(command);
  const replay = await service.execute(command);
  const continuity = corrected.storyReferenceMappings?.filter((reference) => reference.semanticRole === "STORY_CONTINUITY_REFERENCE") ?? [];
  console.log(JSON.stringify({
    contract: TARGET_CONTRACT_VERSION,
    hold: "ACTIVE",
    supersessionId: first.supersessionId,
    actorUserId: command.actorUserId,
    reason: first.reason,
    source: first.source,
    successor: first.successor,
    integrityHash: first.integrityHash,
    createdAt: first.createdAt,
    replayConverged: replay.replayed,
    storyReferenceCount: corrected.storyReferenceMappings?.length ?? 0,
    providerEmittedInputCount: corrected.referenceMappings.length,
    emittedMediaTypes: corrected.referenceMappings.map((reference) => reference.mediaType),
    continuityAssetIds: continuity.map((reference) => reference.assetId),
    continuityVideoEmitted: continuity.some((reference) => reference.providerEmitted),
    providerCallExecuted: false,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAILED", safeError: error instanceof Error ? error.message : "Supersession failed", providerCallExecuted: false }));
  process.exitCode = 1;
});
