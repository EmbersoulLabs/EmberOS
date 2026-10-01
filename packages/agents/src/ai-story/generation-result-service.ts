import {
  AiStoryGenerationResultSchema, AiStoryPostGenerationQcInputPackageSchema,
  AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION, AI_STORY_POST_QC_POLICY_VERSION,
  postQcAllowsHumanApproval,
  type AiStoryGenerationResult, type AiStoryLocalGenerationPackage,
  type AiStoryLocalGenerationOutput, type AiStoryPostQcRequirement,
  type AiStoryPostGenerationQcEvaluation, type AiStoryGenerationResultDecision,
} from "@ceo-agent/shared";
import {
  materializeGenerationResult, assertGenerationResultScope, deterministicPersistenceUuid,
  AiStoryGenerationResultRepository, AiStoryLocalGenerationRepository,
  AiStoryPostGenerationQcRepository, BoundAiStoryPostGenerationQcRepository,
  DurableSceneMediaAttestationRepositoryImpl, canonicalPersistenceHash,
} from "@ceo-agent/db";
import { AiStoryPostGenerationQcService, type AiStoryVisualEvidenceProvider } from "./post-generation-qc-service";
import { localGenerationPackageFingerprint } from "./local-generation-package";

export function materializeLocalGenerationResult(input: {
  package: AiStoryLocalGenerationPackage; output: AiStoryLocalGenerationOutput;
  animationPackageId: string; sceneId: string; sceneOrder: number;
  storagePath: string; byteSize: number; decodable: boolean;
}) {
  const { package: pkg, output } = input;
  if (output.packageId !== pkg.packageId || output.unitId !== pkg.unitId ||
      output.sceneExecutionId !== pkg.sceneExecutionId || !input.decodable) {
    throw new Error("GENERATION_RESULT_LOCAL_SOURCE_MISMATCH");
  }
  return materializeGenerationResult({
    ownership: { orgId: pkg.organizationId, workspaceId: pkg.workspaceId, campaignId: pkg.campaignId,
      storyId: pkg.storyId, storyVersionId: pkg.storyVersionId, animationPackageId: input.animationPackageId, executionPlanId: pkg.executionPlanId },
    runtimeAuthorizationId: pkg.runtimeAuthorizationId,
    generationUnitId: pkg.unitId, sceneExecutionId: pkg.sceneExecutionId, sceneId: input.sceneId, sceneOrder: input.sceneOrder,
    source: { sourceKind: "MANUAL_LOCAL", providerAttemptId: null, localGenerationOutputId: output.outputId, localWorkerOutputId: null },
    compiledRequestId: pkg.sourceAuthority.compiledRequestId, compiledRequestFingerprint: pkg.sourceAuthority.compiledRequestFingerprint,
    inputAuthorityFingerprint: pkg.sourceAuthority.schedulingAuthorityFingerprint,
    inputAuthority: { localPackageId: pkg.packageId, localPackageFingerprint: pkg.packageFingerprint,
      characterAuthority: pkg.characterAuthority, productAuthority: pkg.productAuthority,
      references: pkg.references, generationMode: pkg.generationMode, generateAudio: pkg.generateAudio,
      audioBlocked: pkg.audioBlocked, sourceAuthority: pkg.sourceAuthority, planningAuthority:pkg.planningAuthority },
    media: { assetId: output.assetId, contentHash: output.contentHash,
      durableObjectReference: input.storagePath, storagePath: input.storagePath, byteSize: input.byteSize,
      durationMs: Math.round(output.durationSec * 1000), mediaType: "video/mp4",
      width: output.width, height: output.height, readable: true, decodable: true },
    createdAt: output.uploadedAt,
  });
}

/** Builds source-neutral QC input from frozen requirements. No fake Attempt, Provider or model. */
export function buildGenerationResultPostQcInput(result: AiStoryGenerationResult, pkg: AiStoryLocalGenerationPackage) {
  AiStoryGenerationResultSchema.parse(result);
  assertGenerationResultScope(result, {
    orgId: pkg.organizationId, workspaceId: pkg.workspaceId, campaignId: pkg.campaignId,
    storyId: pkg.storyId, storyVersionId: pkg.storyVersionId, executionPlanId: pkg.executionPlanId,
    sceneExecutionId: pkg.sceneExecutionId, generationUnitId: pkg.unitId,
  });
  if (result.compiledRequestFingerprint !== pkg.sourceAuthority.compiledRequestFingerprint ||
      result.inputAuthorityFingerprint !== pkg.sourceAuthority.schedulingAuthorityFingerprint) {
    throw new Error("POST_QC_GENERATION_RESULT_LINEAGE_MISMATCH");
  }
  const requirements: AiStoryPostQcRequirement[] = [{
    requirementId: "output-integrity", dimension: "OUTPUT_INTEGRITY", summary: "Durable local video is readable, decodable and has valid duration.",
    required: true, waiverPolicy: "NON_WAIVABLE_INTEGRITY", sourceOwner: "POST_PROCESSING", visuallyObservable: false,
  }];
  for (const [index, fact] of pkg.mustKeep.entries()) requirements.push({
    requirementId: `must-keep:${index}`, dimension: "MUST_KEEP", summary: fact,
    required: true, waiverPolicy: "NON_WAIVABLE_INTEGRITY", sourceOwner: "SCENE", visuallyObservable: true,
  });
  if (pkg.characterAuthority) requirements.push({
    requirementId: "character-identity", dimension: "CHARACTER_FIDELITY",
    summary: `Preserve Character ${pkg.characterAuthority.characterId} version ${pkg.characterAuthority.characterVersionId} and pinned DNA.`,
    required: true, waiverPolicy: "NON_WAIVABLE_INTEGRITY", sourceOwner: "CHARACTER_AUTHORITY", visuallyObservable: true,
  });
  if (pkg.productAuthority) requirements.push({
    requirementId: "product-identity", dimension: "PRODUCT_FIDELITY",
    summary: `Preserve source Product ${pkg.productAuthority.assetId} and variant ${pkg.productAuthority.confirmedVariant ?? "as authorized"}.`,
    required: true, waiverPolicy: "NON_WAIVABLE_INTEGRITY", sourceOwner: "PRODUCT_AUTHORITY", visuallyObservable: true,
  });
  for (const [index, fact] of pkg.continuityRequirements.entries()) requirements.push({
    requirementId: `continuity:${index}`, dimension: "CONTINUITY", summary: fact,
    required: true, waiverPolicy: "WAIVABLE_BY_HUMAN", sourceOwner: "SCENE", visuallyObservable: true,
  });
  requirements.push(...pkg.qcRequirements);
  return AiStoryPostGenerationQcInputPackageSchema.parse({
    postQcInputId: deterministicPersistenceUuid("ai-story-generation-result-qc", { generationResultId: result.generationResultId }),
    contractVersion: AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION, policyVersion: AI_STORY_POST_QC_POLICY_VERSION,
    orgId: result.ownership.orgId, workspaceId: result.ownership.workspaceId,
    campaignId: result.ownership.campaignId, storyId: result.ownership.storyId, storyVersionId: result.ownership.storyVersionId,
    ...pkg.planningAuthority,
    sceneExecutionId: result.sceneExecutionId, sceneId: result.sceneId,
    sceneFingerprint: pkg.sourceAuthority.sceneFingerprint, sceneExecutionFingerprint: result.inputAuthorityFingerprint,
    generationResultId: result.generationResultId, sourceKind: result.source.sourceKind, providerAttemptId: result.source.providerAttemptId,
    generationMode: pkg.generationMode === "TEXT_TO_VIDEO" ? "TEXT_TO_VIDEO" : "FIRST_FRAME_IMAGE_TO_VIDEO",
    privateMediaAssetId: result.media.assetId, privateMediaContentHash: result.media.contentHash,
    compiledRequestId: result.compiledRequestId, compiledRequestFingerprint: result.compiledRequestFingerprint,
    semanticPlanFingerprint: pkg.sourceAuthority.semanticPlanFingerprint,
    preGenerationQcEvaluationId: pkg.sourceAuthority.preGenerationQcEvaluationId, preGenerationQcFingerprint: pkg.sourceAuthority.preGenerationQcFingerprint,
    directorFingerprint: pkg.sourceAuthority.directorFingerprint, motionFingerprint: pkg.sourceAuthority.motionFingerprint,
    shotRecipeFingerprint: null, castSnapshotFingerprint: pkg.sourceAuthority.castSnapshotFingerprint,
    locationSnapshotFingerprint: pkg.sourceAuthority.locationSnapshotFingerprint, productSnapshotFingerprint: pkg.sourceAuthority.productSnapshotFingerprint,
    entryState: pkg.currentUnitStartState, scriptActions: pkg.mustKeep, requiredExitState: pkg.expectedEndState,
    mustKeep: pkg.mustKeep, mustAvoid: pkg.mustAvoid, newAudienceInformation: [], requiredEvidence: pkg.continuityRequirements,
    requirements, providerMetadata: { sourceKind: result.source.sourceKind },
    media: { durableObjectReference: result.media.durableObjectReference, mediaType: "video/mp4",
      byteSize: result.media.byteSize, durationMs: result.media.durationMs, width: result.media.width, height: result.media.height,
      readable: result.media.readable, decodable: result.media.decodable },
    createdAt: result.createdAt,
  });
}

export function assertGenerationResultApproval(result: AiStoryGenerationResult, qc: AiStoryPostGenerationQcEvaluation | null) {
  if (!qc || qc.generationResultId !== result.generationResultId || qc.mediaContentHash !== result.media.contentHash ||
      qc.workspaceId !== result.ownership.workspaceId || qc.sceneExecutionId !== result.sceneExecutionId ||
      qc.compiledRequestFingerprint !== result.compiledRequestFingerprint ||
      !qc.eligibleForHumanReview || !postQcAllowsHumanApproval(qc)) {
    throw new Error("GENERATED_SCENE_POST_QC_REQUIRED");
  }
}

export function materializeLocalRetryPackage(pkg: AiStoryLocalGenerationPackage, result: AiStoryGenerationResult, qc: AiStoryPostGenerationQcEvaluation) {
  if (result.source.sourceKind !== "MANUAL_LOCAL" || result.generationUnitId !== pkg.unitId ||
      qc.generationResultId !== result.generationResultId || qc.aggregateStatus !== "POST_QC_REJECT") {
    throw new Error("LOCAL_RETRY_QC_BINDING_INVALID");
  }
  const corrections = qc.findings.filter(f => f.result === "REJECT").map(f => `- ${f.reason}`);
  const retryNumber = pkg.retryNumber + 1;
  const base = {
    ...pkg, packageId: deterministicPersistenceUuid("ai-story-local-retry-package", { generationResultId: result.generationResultId, retryNumber }),
    retryOfPackageId: pkg.packageId, retryNumber,
    instructions: `${pkg.instructions}\n\nLOCAL REGENERATION REQUIRED\n${corrections.join("\n")}`,
    state: "AWAITING_LOCAL_OUTPUT" as const,
  };
  return { ...base, packageFingerprint: localGenerationPackageFingerprint(base) };
}

export class AiStoryGenerationResultService {
  constructor(
    private readonly results = new AiStoryGenerationResultRepository(),
    private readonly packages = new AiStoryLocalGenerationRepository(),
    private readonly qc = new AiStoryPostGenerationQcRepository(),
    private readonly durableMedia = new DurableSceneMediaAttestationRepositoryImpl(),
  ) {}

  async evaluateLocal(result: AiStoryGenerationResult, pkg: AiStoryLocalGenerationPackage, evidenceProvider: AiStoryVisualEvidenceProvider, actorUserId: string) {
    const accepted = await this.results.get(result.ownership.workspaceId, result.generationResultId);
    if (!accepted || accepted.fingerprint !== result.fingerprint) throw new Error("GENERATION_RESULT_NOT_ACCEPTED");
    const input = buildGenerationResultPostQcInput(accepted, pkg);
    if (await this.results.decision(result.generationResultId)) throw new Error("GENERATION_RESULT_DECISION_ALREADY_FROZEN");
    const latest = await this.results.latestQc(result.ownership.workspaceId, result.generationResultId);
    const evaluation = await new AiStoryPostGenerationQcService({
      repository: new BoundAiStoryPostGenerationQcRepository(input, this.qc), evidenceProvider,
    }).evaluate(input, (latest?.evaluationVersion ?? 0) + 1);
    if (evaluation.evaluation.aggregateStatus === "POST_QC_REJECT" && result.source.sourceKind === "MANUAL_LOCAL") {
      await this.packages.insertOrConverge({
        packages: [materializeLocalRetryPackage(pkg, result, evaluation.evaluation)], createdBy: actorUserId,
      });
    }
    return evaluation;
  }

  async approve(result: AiStoryGenerationResult, actorUserId: string, rationale: string) {
    const qc = await this.results.latestQc(result.ownership.workspaceId, result.generationResultId);
    assertGenerationResultApproval(result, qc);
    if (!qc) throw new Error("GENERATED_SCENE_POST_QC_REQUIRED");
    const decision: AiStoryGenerationResultDecision = {
      decisionId: deterministicPersistenceUuid("ai-story-generation-result-decision", { generationResultId: result.generationResultId }),
      generationResultId: result.generationResultId, postQcEvaluationId: qc.postQcEvaluationId,
      decision: "APPROVED", actorUserId, rationale, decidedAt: new Date().toISOString(),
    };
    const accepted = await this.results.acceptDecision(result, decision);
    if (result.source.sourceKind !== "REMOTE_PROVIDER") {
      // Retriable accept-or-converge: no signed transport URI and no invented Provider.
      await this.durableMedia.acceptOrConverge(
        materializeGenerationResultDurableAttestation(result, accepted.decision),
      );
    }
    return accepted;
  }
}

export function materializeGenerationResultDurableAttestation(result: AiStoryGenerationResult, decision: AiStoryGenerationResultDecision) {
  if (decision.decision !== "APPROVED" || decision.generationResultId !== result.generationResultId) throw new Error("GENERATION_RESULT_APPROVAL_REQUIRED");
  const facts = {
    contractVersion: "1" as const,
    mediaAttestationId: deterministicPersistenceUuid("ai-story-generation-result-durable-media", { generationResultId: result.generationResultId }),
    ...result.ownership, sceneExecutionId: result.sceneExecutionId,
    sceneResultId: deterministicPersistenceUuid("ai-story-generation-scene-result", { generationResultId: result.generationResultId }),
    sourceMediaReference: { scheme: "generation-result" as const, generationResultId: result.generationResultId },
    durableObjectReference: result.media.durableObjectReference, contentHash: result.media.contentHash,
    byteSize: result.media.byteSize, mediaType: result.media.mediaType, ingestContractVersion: "1" as const,
    storageProvider: "supabase-storage" as const, storageNamespaceVersion: "1" as const,
    acceptedAt: decision.decidedAt, executionAllowed: false as const, executionLockCode: "PHASE1_EXECUTION_LOCKED" as const,
  };
  return { ...facts, integrityHash: canonicalPersistenceHash({ ...facts, acceptedAt: undefined }) };
}
