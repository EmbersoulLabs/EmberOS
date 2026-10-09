import {
  AI_STORY_CERTIFIED_LOCAL_WORKFLOWS,
  LOCAL_GPU_PRODUCT_ONLY_CANDIDATE_WORKFLOW,
  AiStoryLocalGenerationPackageV3Schema,
  type AiStoryGenerationResult,
  type AiStoryGenerationResultDecision,
  type AiStoryLocalGenerationPackage,
  type AiStoryLocalGenerationPackageV3,
  type AiStoryPostGenerationQcEvaluation,
} from "@ceo-agent/shared";
import {
  computeAiStoryEffectiveSceneGenerationAuthorityV2Fingerprint,
  computeAiStoryLocalGenerationPackageV3Fingerprint,
  computeAiStoryLocalPredecessorAuthorityFingerprint,
  computeAiStoryLocalReleaseAuthorityFingerprint,
  deterministicAiStoryLocalGenerationPackageV3Id,
  deterministicAiStoryLocalReleaseAuthorityId,
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "@ceo-agent/shared/server";

type V2Package = Extract<
  AiStoryLocalGenerationPackage,
  { version: "local-generation-package.v2" }
>;

export type SequentialContinuityEvidence = {
  predecessorPackage: AiStoryLocalGenerationPackageV3;
  generationResult: AiStoryGenerationResult;
  postQc: AiStoryPostGenerationQcEvaluation;
  decision: AiStoryGenerationResultDecision;
  frame: {
    frameAssetId: string;
    contentHash: string;
    sourceContentHash: string;
    extractionContractVersion: string;
    extractedAt: string;
  };
};

export type SequentialReleaseAudit = {
  releaseRevision: number;
  releasedBy: string;
  releasedAt: string;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function initialVisualStart(base: V2Package) {
  const firstFrame = base.references.find(
    (reference) => reference.authorityType === "FIRST_FRAME",
  );
  return firstFrame
    ? {
        sourceType: "INITIAL_MATERIAL" as const,
        assetId: firstFrame.assetId,
        contentHash: firstFrame.contentHash,
        mediaType: firstFrame.mediaType ?? "image/png",
      }
    : { sourceType: "NONE" as const };
}

function assertContinuity(
  base: V2Package,
  evidence: SequentialContinuityEvidence,
): void {
  const { predecessorPackage, generationResult, postQc, decision, frame } = evidence;
  if (
    predecessorPackage.executionPlanId !== base.executionPlanId
    || predecessorPackage.runtimeAuthorizationId !== base.runtimeAuthorizationId
    || predecessorPackage.organizationId !== base.organizationId
    || predecessorPackage.workspaceId !== base.workspaceId
    || predecessorPackage.campaignId !== base.campaignId
    || predecessorPackage.storyId !== base.storyId
    || predecessorPackage.storyVersionId !== base.storyVersionId
    || predecessorPackage.order + 1 !== base.order
    || predecessorPackage.sceneExecutionId !== generationResult.sceneExecutionId
    || predecessorPackage.unitId !== generationResult.generationUnitId
    || generationResult.runtimeAuthorizationId !== base.runtimeAuthorizationId
    || generationResult.source.sourceKind !== "MANUAL_LOCAL"
    || generationResult.ownership.orgId !== base.organizationId
    || generationResult.ownership.executionPlanId !== base.executionPlanId
    || generationResult.ownership.workspaceId !== base.workspaceId
    || generationResult.ownership.campaignId !== base.campaignId
    || generationResult.ownership.storyId !== base.storyId
    || generationResult.ownership.storyVersionId !== base.storyVersionId
    || generationResult.inputAuthority.localPackageId !== predecessorPackage.packageId
    || generationResult.inputAuthority.localPackageFingerprint
      !== predecessorPackage.packageFingerprint
  ) {
    throw new Error("SEQUENTIAL_LOCAL_PREDECESSOR_SCOPE_MISMATCH");
  }
  if (
    postQc.generationResultId !== generationResult.generationResultId
    || postQc.orgId !== base.organizationId
    || postQc.workspaceId !== base.workspaceId
    || postQc.sourceKind !== "MANUAL_LOCAL"
    || postQc.postQcEvaluationId !== decision.postQcEvaluationId
    || postQc.mediaContentHash !== generationResult.media.contentHash
    || !postQc.eligibleForHumanReview
    || postQc.aggregateStatus !== "POST_QC_PASS"
    || decision.generationResultId !== generationResult.generationResultId
    || decision.decision !== "APPROVED"
  ) {
    throw new Error("SEQUENTIAL_LOCAL_PREDECESSOR_APPROVAL_REQUIRED");
  }
  if (
    frame.sourceContentHash !== generationResult.media.contentHash
    || !frame.extractionContractVersion.trim()
  ) {
    throw new Error("SEQUENTIAL_LOCAL_CONTINUITY_FRAME_MISMATCH");
  }
}

/**
 * Converts an existing provider-neutral V2 frozen Unit snapshot into the V3
 * sequential envelope. Canonical generation strategy and local workflow remain
 * separate: a T2V successor stays T2V while its certified local workflow may
 * consume exact predecessor continuity.
 */
export function materializeSequentialLocalPackageV3(input: {
  basePackage: V2Package;
  release: SequentialReleaseAudit;
  predecessor: SequentialContinuityEvidence | null;
}): AiStoryLocalGenerationPackageV3 {
  const { basePackage: base, predecessor } = input;
  const recommendedWorkflow = base.recommendedWorkflow === LOCAL_GPU_PRODUCT_ONLY_CANDIDATE_WORKFLOW
    ? LOCAL_GPU_PRODUCT_ONLY_CANDIDATE_WORKFLOW
    : AI_STORY_CERTIFIED_LOCAL_WORKFLOWS.find(
      (workflow) => workflow === base.recommendedWorkflow,
    );
  if (!recommendedWorkflow) {
    throw new Error("LOCAL_WORKFLOW_CERTIFICATION_REQUIRED");
  }
  if (predecessor) assertContinuity(base, predecessor);
  if ((base.order === 1) !== (predecessor === null)) {
    throw new Error("SEQUENTIAL_LOCAL_PREDECESSOR_REQUIRED");
  }

  const visualStartAuthority = predecessor
    ? {
        sourceType: "PREDECESSOR_CONTINUITY" as const,
        assetId: predecessor.frame.frameAssetId,
        contentHash: predecessor.frame.contentHash,
        mediaType: "image/png",
      }
    : initialVisualStart(base);
  const productAssetId = base.productAuthority?.selectedMaterialAssetId ?? null;
  const productContentHash =
    base.productAuthority?.selectedMaterialContentHash ?? null;
  const references: AiStoryLocalGenerationPackageV3["references"] = [];
  if (visualStartAuthority.sourceType !== "NONE") {
    references.push({
      role: "VISUAL_START",
      assetId: visualStartAuthority.assetId,
      contentHash: visualStartAuthority.contentHash,
      authorityId: predecessor
        ? predecessor.generationResult.generationResultId
        : base.productAuthority?.assetId
          ?? base.sourceAuthority.localSourceAuthorityId,
      displayName: predecessor
        ? "Approved predecessor continuity frame"
        : "Authorized initial visual material",
      mediaType: visualStartAuthority.mediaType,
    });
  }
  if (productAssetId && productContentHash && base.productAuthority) {
    references.push({
      role: "PRODUCT_IDENTITY",
      assetId: productAssetId,
      contentHash: productContentHash,
      authorityId: base.productAuthority.assetId,
      displayName: "Authorized Product identity material",
      mediaType: base.references.find((item) => item.assetId === productAssetId)
        ?.mediaType ?? "image/png",
    });
  }

  const generationAuthority = {
    contractVersion: "ai-story-effective-scene-generation-authority.v2" as const,
    strategy: base.generationMode,
    referenceSource: base.sourceAuthority.generationAuthority.referenceSource,
    effectiveReferenceIds: unique([
      ...base.sourceAuthority.generationAuthority.effectiveReferenceIds,
      ...references.map((item) => item.assetId),
    ]),
    productReferenceAssetIds: productAssetId ? [productAssetId] : [],
    visualStartAuthority,
    productVisualIdentityRequirement:
      base.sourceAuthority.generationAuthority.productVisualIdentityRequirement,
  };
  const predecessorAuthority = predecessor
    ? (() => {
        const semantic = {
          contractVersion: "ai-story-local-predecessor-authority.v1" as const,
          predecessorSceneExecutionId:
            predecessor.predecessorPackage.sceneExecutionId,
          predecessorPackageId: predecessor.predecessorPackage.packageId,
          predecessorGenerationResultId:
            predecessor.generationResult.generationResultId,
          predecessorPostQcEvaluationId: predecessor.postQc.postQcEvaluationId,
          predecessorDecisionId: predecessor.decision.decisionId,
          predecessorOutputAssetId: predecessor.generationResult.media.assetId,
          predecessorOutputContentHash:
            predecessor.generationResult.media.contentHash,
          continuityFrameAssetId: predecessor.frame.frameAssetId,
          continuityFrameContentHash: predecessor.frame.contentHash,
          continuitySourceContentHash: predecessor.frame.sourceContentHash,
          extractionContractVersion:
            predecessor.frame.extractionContractVersion,
        };
        return {
          semantic,
          semanticFingerprint:
            computeAiStoryLocalPredecessorAuthorityFingerprint(semantic),
          audit: { extractedAt: predecessor.frame.extractedAt },
        };
      })()
    : null;
  const releaseSemantic = {
    contractVersion: "ai-story-scene-release-authority.v2" as const,
    executionMode: "MANUAL_LOCAL" as const,
    organizationId: base.organizationId,
    workspaceId: base.workspaceId,
    executionPlanId: base.executionPlanId,
    runtimeAuthorizationId: base.runtimeAuthorizationId,
    sceneExecutionId: base.sceneExecutionId,
    sceneOrder: base.order,
    releaseRevision: input.release.releaseRevision,
    gateKind: predecessor
      ? "PREDECESSOR_CONTINUITY" as const
      : "INITIAL_UNIT" as const,
    gateEvidenceFingerprint: predecessorAuthority?.semanticFingerprint ?? null,
  };
  const releaseFingerprint =
    computeAiStoryLocalReleaseAuthorityFingerprint(releaseSemantic);
  const sourceBody = {
    ...base.sourceAuthority,
    version: "ai-story-local-generation-source-authority.v3" as const,
    generationAuthority,
    generationAuthorityFingerprint:
      computeAiStoryEffectiveSceneGenerationAuthorityV2Fingerprint(
        generationAuthority,
      ),
  };
  const sourceAuthority = {
    ...sourceBody,
    localSourceAuthorityFingerprint: sha256CanonicalIntegrityHash({
      ...sourceBody,
      localSourceAuthorityId: undefined,
      localSourceAuthorityFingerprint: undefined,
    }),
  };
  sourceAuthority.localSourceAuthorityId =
    deterministicUuidFromFingerprint(
      "ai-story-local-source-authority-v3",
      sourceAuthority.localSourceAuthorityFingerprint,
    );
  const draft: AiStoryLocalGenerationPackageV3 = {
    ...base,
    version: "local-generation-package.v3",
    packageId: base.packageId,
    packageFingerprint: base.packageFingerprint,
    recommendedWorkflow,
    references,
    visualStartAuthority,
    predecessorAuthority,
    releaseAuthority: {
      releaseAuthorityId:
        deterministicAiStoryLocalReleaseAuthorityId(releaseFingerprint),
      semantic: releaseSemantic,
      semanticFingerprint: releaseFingerprint,
      audit: {
        releasedBy: input.release.releasedBy,
        releasedAt: input.release.releasedAt,
      },
    },
    sourceAuthority,
    successorOfPackageId: predecessor?.predecessorPackage.packageId ?? null,
    successorNumber: input.release.releaseRevision,
    instructions: predecessor
      ? `${base.instructions}\n\nPREDECESSOR CONTINUITY\nUse the exact approved predecessor continuity frame as the visual start. Canonical generation strategy remains ${base.generationMode}.`
      : base.instructions,
  };
  const packageFingerprint =
    computeAiStoryLocalGenerationPackageV3Fingerprint(draft);
  return AiStoryLocalGenerationPackageV3Schema.parse({
    ...draft,
    packageFingerprint,
    packageId:
      deterministicAiStoryLocalGenerationPackageV3Id(packageFingerprint),
  });
}
