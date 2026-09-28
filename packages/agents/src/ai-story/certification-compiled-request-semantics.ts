import type { AiStoryCompiledProviderRequest } from "@ceo-agent/shared";
import { validateAiStoryCompiledRequestFingerprint } from "./provider-runtime-dispatch-integration";

/**
 * Certification evidence only. This does not replace
 * validateAiStoryCompiledRequestFingerprint(), which still covers compiledAt,
 * compiledRequestId, and the rest of the persisted request.
 */
export type CertificationCompiledRequestStableSemantics = {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly storyVersionId: string;
  readonly sceneExecutionId: string;
  readonly generationMode: AiStoryCompiledProviderRequest["generationMode"];
  readonly providerId: AiStoryCompiledProviderRequest["providerId"];
  readonly modelId: AiStoryCompiledProviderRequest["modelId"];
  readonly adapterVersion: string;
  readonly mappingVersion: string;
  readonly capabilityVersion: string;
  readonly qcCapabilityVersion: string;
  readonly qcEvaluationId: string;
  readonly qcFingerprint: string;
  readonly sceneFingerprint: string;
  readonly directorFingerprint: string;
  readonly motionFingerprint: string;
  readonly packageFingerprint: string;
  readonly castSnapshotFingerprint: string;
  readonly locationSnapshotFingerprint: string;
  readonly productSnapshotFingerprint: string;
  readonly semanticPlanFingerprint: string;
  readonly compiledPromptFingerprint: string;
  readonly structuredRequest: {
    readonly model: AiStoryCompiledProviderRequest["structuredRequest"]["model"];
    readonly duration: AiStoryCompiledProviderRequest["structuredRequest"]["duration"];
    readonly ratio: AiStoryCompiledProviderRequest["structuredRequest"]["ratio"];
    readonly resolution: AiStoryCompiledProviderRequest["structuredRequest"]["resolution"];
    readonly generateAudio: AiStoryCompiledProviderRequest["structuredRequest"]["generateAudio"];
    readonly watermark: boolean;
  };
  readonly referenceMappings: readonly {
    readonly authorityType: string;
    readonly authorityId: string;
    readonly authorityClass: string;
    readonly assetId: string;
    readonly wireRole: string;
    readonly semanticBinding: string;
  }[];
  readonly storyReferenceMappings: readonly {
    readonly assetId: string;
    readonly semanticRole: string;
    readonly providerWireRole: string | null;
    readonly providerEmitted: true;
  }[];
  readonly productSourceAssetId: string | null;
  readonly selectedProductMaterialAssetId: string | null;
  readonly providerReadyFirstFrameAssetId: string | null;
  readonly referenceBudget: AiStoryCompiledProviderRequest["referenceBudget"];
  readonly blockedCapabilities: readonly string[];
};

export function certificationCompiledRequestStableSemantics(
  request: AiStoryCompiledProviderRequest
): CertificationCompiledRequestStableSemantics {
  const firstFrame = request.referenceMappings.find((mapping) => mapping.wireRole === "first_frame");
  return {
    orgId: request.orgId,
    workspaceId: request.workspaceId,
    campaignId: request.campaignId,
    storyId: request.storyId,
    storyVersionId: request.storyVersionId,
    sceneExecutionId: request.sceneExecutionId,
    generationMode: request.generationMode,
    providerId: request.providerId,
    modelId: request.modelId,
    adapterVersion: request.adapterVersion,
    mappingVersion: request.mappingVersion,
    capabilityVersion: request.capabilityVersion,
    qcCapabilityVersion: request.qcCapabilityVersion,
    qcEvaluationId: request.qcEvaluationId,
    qcFingerprint: request.qcFingerprint,
    sceneFingerprint: request.sceneFingerprint,
    directorFingerprint: request.directorFingerprint,
    motionFingerprint: request.motionFingerprint,
    packageFingerprint: request.packageFingerprint,
    castSnapshotFingerprint: request.castSnapshotFingerprint,
    locationSnapshotFingerprint: request.locationSnapshotFingerprint,
    productSnapshotFingerprint: request.productSnapshotFingerprint,
    semanticPlanFingerprint: request.semanticPlanFingerprint,
    compiledPromptFingerprint: request.compiledPromptFingerprint,
    structuredRequest: {
      model: request.structuredRequest.model,
      duration: request.structuredRequest.duration,
      ratio: request.structuredRequest.ratio,
      resolution: request.structuredRequest.resolution,
      generateAudio: request.structuredRequest.generateAudio,
      watermark: request.structuredRequest.watermark,
    },
    referenceMappings: [...request.referenceMappings]
      .map((mapping) => ({
        authorityType: mapping.authorityType,
        authorityId: mapping.authorityId,
        authorityClass: mapping.authorityClass,
        assetId: mapping.assetId,
        wireRole: mapping.wireRole,
        semanticBinding: mapping.semanticBinding,
      }))
      .sort((left, right) => `${left.assetId}:${left.wireRole}`.localeCompare(`${right.assetId}:${right.wireRole}`)),
    storyReferenceMappings: [...(request.storyReferenceMappings ?? [])]
      .filter((reference) => reference.providerEmitted)
      .map((reference) => ({
        assetId: reference.assetId,
        semanticRole: reference.semanticRole,
        providerWireRole: reference.providerWireRole ?? null,
        providerEmitted: true as const,
      }))
      .sort((left, right) => `${left.assetId}:${left.semanticRole}`.localeCompare(`${right.assetId}:${right.semanticRole}`)),
    productSourceAssetId: request.productMaterialSelection?.productAuthority.sourceAssetId ?? null,
    selectedProductMaterialAssetId: request.productMaterialSelection?.selectedMaterial?.assetId ?? null,
    providerReadyFirstFrameAssetId: request.providerReadySceneInput?.assetId ?? firstFrame?.assetId ?? null,
    referenceBudget: request.referenceBudget,
    blockedCapabilities: [...request.blockedCapabilities].sort(),
  };
}

export function compareCertificationCompiledRequestSemantics(
  scheduled: AiStoryCompiledProviderRequest,
  preflight: AiStoryCompiledProviderRequest
): { readonly equivalent: boolean; readonly differences: readonly string[] } {
  const left = certificationCompiledRequestStableSemantics(scheduled);
  const right = certificationCompiledRequestStableSemantics(preflight);
  const differences = (Object.keys(left) as (keyof CertificationCompiledRequestStableSemantics)[])
    .filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
  return { equivalent: differences.length === 0, differences };
}

/**
 * Cross-run certification gate. Exact requestFingerprint equality is not required.
 * The scheduled request must still validate against its own fingerprint.
 */
export function certifyScheduledRequestAgainstPreflight(input: {
  readonly scheduled: AiStoryCompiledProviderRequest;
  readonly preflight: AiStoryCompiledProviderRequest;
}): {
  readonly selfFingerprintValid: boolean;
  readonly stableSemanticEquivalent: boolean;
  readonly differences: readonly string[];
} {
  const selfFingerprintValid = validateAiStoryCompiledRequestFingerprint(input.scheduled);
  const comparison = compareCertificationCompiledRequestSemantics(input.scheduled, input.preflight);
  return {
    selfFingerprintValid,
    stableSemanticEquivalent: selfFingerprintValid && comparison.equivalent,
    differences: comparison.differences,
  };
}
