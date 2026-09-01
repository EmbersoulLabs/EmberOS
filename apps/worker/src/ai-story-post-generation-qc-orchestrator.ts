import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AiStoryPostGenerationQcService,
  buildAiStoryPostGenerationQcInputFromCompiledAuthority,
  probeAssemblyMedia,
  type AiStoryVisualEvidenceProvider,
  type DurableObjectStore,
} from "@ceo-agent/agents";
import { AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION } from "@ceo-agent/shared";
import {
  AiStoryPostGenerationQcRepository,
  BoundAiStoryPostGenerationQcRepository,
} from "@ceo-agent/db";

const unavailableVisualEvidence: AiStoryVisualEvidenceProvider = {
  providerId: "post-qc-visual-evidence-unavailable",
  contractVersion: AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION,
  async analyze() {
    // The deterministic media gate still runs. Visually observable facts remain
    // explicitly UNVERIFIED and therefore require legitimate Human Review.
    throw new Error("AI_STORY_VISUAL_EVIDENCE_UNAVAILABLE");
  },
};

export class AiStoryPostGenerationQcRuntimeOrchestrator {
  constructor(
    private readonly repository = new AiStoryPostGenerationQcRepository(),
    private readonly durableObjectStore: DurableObjectStore,
  ) {}

  async evaluateSceneExecution(sceneExecutionId: string) {
    const authority = await this.repository.loadRuntimeRecoveryAuthority(sceneExecutionId);
    if (!authority) throw new Error("POST_QC_RUNTIME_AUTHORITY_MISSING");
    const working = await mkdtemp(join(tmpdir(), "ember-post-qc-"));
    const localPath = join(working, "scene.mp4");
    try {
      await this.durableObjectStore.assertReadableObject({
        workspaceId: authority.attestation.workspaceId,
        objectKey: authority.attestation.durableObjectReference,
        expectedContentHash: authority.attestation.contentHash,
      });
      await this.durableObjectStore.downloadObject({
        workspaceId: authority.attestation.workspaceId,
        objectKey: authority.attestation.durableObjectReference,
        destinationPath: localPath,
      });
      const probe = await probeAssemblyMedia({
        sceneResultId: authority.attestation.sceneResultId,
        localPath,
        expectedContentHash: authority.attestation.contentHash,
      });
      const compiled = authority.compiledRequest;
      const input = buildAiStoryPostGenerationQcInputFromCompiledAuthority({
        intent: authority.intent,
        instructions: authority.instructions,
        preGenerationAuthority: authority.preGenerationAuthority,
        handoffFingerprint: authority.handoffFingerprint,
        sceneVersion: authority.sceneVersion,
        compiledRequest: compiled,
        attempt: {
          providerAttemptId: authority.providerAttemptId,
          compiledRequestId: compiled.compiledRequestId,
          requestFingerprint: compiled.requestFingerprint,
          sceneExecutionId: compiled.sceneExecutionId,
          orgId: compiled.orgId,
          workspaceId: compiled.workspaceId,
          campaignId: compiled.campaignId,
          storyId: compiled.storyId,
          storyVersionId: compiled.storyVersionId,
          generationMode: compiled.generationMode,
          providerId: compiled.providerId,
          modelId: compiled.modelId,
          ...(authority.providerTaskId ? { providerTaskId: authority.providerTaskId } : {}),
          ...(authority.actualUsage ? { actualUsage: authority.actualUsage } : {}),
          mediaAssetId: authority.attestation.mediaAttestationId,
        },
        privateMedia: {
          mediaAssetId: authority.attestation.mediaAttestationId,
          contentHash: authority.attestation.contentHash,
          durableObjectReference: authority.attestation.durableObjectReference,
          byteSize: authority.attestation.byteSize,
          durationMs: probe.durationMs,
          width: probe.width,
          height: probe.height,
          readable: true,
          decodable: true,
        },
        createdAt: authority.attestation.acceptedAt,
      });
      return new AiStoryPostGenerationQcService({
        repository: new BoundAiStoryPostGenerationQcRepository(input, this.repository),
        evidenceProvider: unavailableVisualEvidence,
      }).evaluate(input);
    } finally {
      await rm(working, { recursive: true, force: true });
    }
  }

  async recoverNext() {
    const [sceneExecutionId] = await this.repository.listPendingRuntimeRecoverySceneExecutionIds(1);
    if (!sceneExecutionId) return null;
    return this.evaluateSceneExecution(sceneExecutionId);
  }
}
