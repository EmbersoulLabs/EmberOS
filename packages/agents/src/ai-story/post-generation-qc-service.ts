import {
  AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
  AI_STORY_POST_QC_POLICY_VERSION,
  AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION,
  AiStoryPostGenerationQcEvaluationSchema,
  AiStoryPostGenerationQcInputPackageSchema,
  AiStoryPostQcHumanReviewEvidenceSchema,
  AiStoryPostQcObservationSchema,
  type AiStoryPostGenerationQcEvaluation,
  type AiStoryPostGenerationQcInputPackage,
  type AiStoryPostQcFinding,
  type AiStoryPostQcHumanReviewEvidence,
  type AiStoryPostQcObservation,
  type AiStoryPostQcRequirement,
  type AiStoryCompiledProviderRequest,
  type AiStoryProviderAttemptBinding,
  type AiStoryPreGenerationQcEvaluation,
  type AiStorySceneCompiledInstructions,
  type AiStorySceneExecutionIntent,
  type AiStorySceneExecutionPackage,
} from "@ceo-agent/shared";
import { deterministicPersistenceUuid } from "@ceo-agent/db";
import { integrityHash } from "./scene-execution-compiler";

export interface AiStoryVisualEvidenceProvider {
  readonly providerId: string;
  readonly contractVersion: typeof AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION;
  analyze(input: AiStoryPostGenerationQcInputPackage): Promise<readonly AiStoryPostQcObservation[]>;
}

export interface AiStoryPostGenerationQcRepository {
  getByIdentity(input: { postQcInputId: string; evaluationVersion: number }): Promise<AiStoryPostGenerationQcEvaluation | null>;
  accept(evaluation: AiStoryPostGenerationQcEvaluation): Promise<{ evaluation: AiStoryPostGenerationQcEvaluation; replayed: boolean }>;
}

export class InMemoryAiStoryPostGenerationQcRepository implements AiStoryPostGenerationQcRepository {
  private readonly rows = new Map<string, AiStoryPostGenerationQcEvaluation>();
  private key(input: { postQcInputId: string; evaluationVersion: number }) { return `${input.postQcInputId}:${input.evaluationVersion}`; }
  async getByIdentity(input: { postQcInputId: string; evaluationVersion: number }) { return this.rows.get(this.key(input)) ?? null; }
  async accept(evaluation: AiStoryPostGenerationQcEvaluation) {
    const key = this.key(evaluation);
    const current = this.rows.get(key);
    if (current) {
      if (current.evaluationFingerprint !== evaluation.evaluationFingerprint) throw new Error("POST_QC_IMMUTABLE_CONFLICT");
      return { evaluation: current, replayed: true };
    }
    this.rows.set(key, evaluation);
    return { evaluation, replayed: false };
  }
}

export class FakeAiStoryVisualEvidenceProvider implements AiStoryVisualEvidenceProvider {
  readonly providerId = "deterministic-fake-visual-evidence";
  readonly contractVersion = AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION;
  constructor(private readonly evidence: readonly AiStoryPostQcObservation[] | Error) {}
  async analyze(): Promise<readonly AiStoryPostQcObservation[]> {
    if (this.evidence instanceof Error) throw this.evidence;
    return this.evidence.map((item) => AiStoryPostQcObservationSchema.parse(item));
  }
}

function observationId(input: AiStoryPostGenerationQcInputPackage, requirementId: string, source: string) {
  return deterministicPersistenceUuid("ai-story-post-qc-observation", { postQcInputId: input.postQcInputId, requirementId, source });
}

function textFact(value: unknown): string { return JSON.stringify(value); }

/** Builds the exact immutable evaluation input from the frozen execution package and durable media, never latest authority. */
export function buildAiStoryPostGenerationQcInputPackage(input: {
  readonly package: AiStorySceneExecutionPackage;
  readonly compiledRequest: AiStoryCompiledProviderRequest;
  readonly attempt: AiStoryProviderAttemptBinding;
  readonly privateMedia: {
    readonly mediaAssetId: string;
    readonly contentHash: string;
    readonly durableObjectReference: string;
    readonly byteSize: number;
    readonly durationMs: number | null;
    readonly width: number | null;
    readonly height: number | null;
    readonly readable: boolean;
    readonly decodable: boolean;
  };
  readonly createdAt?: string;
}): AiStoryPostGenerationQcInputPackage {
  const pkg = input.package;
  const compiled = input.compiledRequest;
  const attempt = input.attempt;
  if (
    compiled.sceneExecutionPackageId !== pkg.sceneExecutionPackageId ||
    compiled.packageFingerprint !== pkg.packageFingerprint ||
    attempt.compiledRequestId !== compiled.compiledRequestId ||
    compiled.requestFingerprint !== attempt.requestFingerprint ||
    attempt.mediaAssetId !== input.privateMedia.mediaAssetId ||
    attempt.sceneExecutionId !== compiled.sceneExecutionId ||
    attempt.orgId !== pkg.orgId || attempt.workspaceId !== pkg.workspaceId ||
    attempt.campaignId !== pkg.campaignId || attempt.storyId !== pkg.storyId ||
    attempt.storyVersionId !== pkg.storyVersionId ||
    compiled.sceneFingerprint !== pkg.scene.fingerprint ||
    compiled.directorFingerprint !== pkg.directorFingerprint ||
    compiled.motionFingerprint !== pkg.motionFingerprint ||
    compiled.qcFingerprint !== pkg.qcEvaluation.qcFingerprint
  ) {
    throw new Error("POST_QC_ATTEMPT_LINEAGE_MISMATCH");
  }
  const requirements: AiStoryPostQcRequirement[] = [];
  const add = (item: AiStoryPostQcRequirement) => requirements.push(item);
  add({ requirementId: "scene-purpose", dimension: "SCENE_FIDELITY", summary: `Scene Function ${pkg.scene.sceneFunction} and role ${pkg.scene.sceneRole} must be materially represented.`, required: true, waiverPolicy: "WAIVABLE_BY_HUMAN", sourceOwner: "SCENE", visuallyObservable: true });
  for (const fact of pkg.directorDirection.newAudienceInformation) add({ requirementId: `audience:${integrityHash(fact).slice(-16)}`, dimension: "REQUIRED_EVIDENCE", summary: fact, required: true, waiverPolicy: "WAIVABLE_BY_HUMAN", sourceOwner: "DIRECTOR", visuallyObservable: true });
  for (const product of pkg.productAuthorities) {
    add({ requirementId: `product:${product.productAuthorityId}`, dimension: "PRODUCT_FIDELITY", summary: `Product ${product.displayName} remains materially consistent with bound Product authority.`, required: product.visualIdentityRequirement === "REQUIRED", waiverPolicy: product.visualIdentityRequirement === "REQUIRED" ? "NON_WAIVABLE_INTEGRITY" : "WAIVABLE_BY_HUMAN", sourceOwner: "PRODUCT_AUTHORITY", visuallyObservable: true });
    for (const evidence of product.visibleEvidenceGoals) add({ requirementId: `product-evidence:${product.productAuthorityId}:${integrityHash(evidence).slice(-12)}`, dimension: "REQUIRED_EVIDENCE", summary: evidence, required: true, waiverPolicy: "WAIVABLE_BY_HUMAN", sourceOwner: "SCENE", visuallyObservable: true });
  }
  for (const cast of pkg.castAuthorities) add({ requirementId: `cast:${cast.reference.id}`, dimension: "CHARACTER_FIDELITY", summary: `${cast.reference.scope} ${cast.displayName} presence and canonical appearance continuity.`, required: cast.reference.visualIdentityRequirement === "REQUIRED", waiverPolicy: cast.reference.visualIdentityRequirement === "REQUIRED" ? "NON_WAIVABLE_INTEGRITY" : "WAIVABLE_BY_HUMAN", sourceOwner: "CHARACTER_AUTHORITY", visuallyObservable: true });
  add({ requirementId: `location:${pkg.scene.locationBinding.id}`, dimension: "LOCATION_FIDELITY", summary: `${pkg.scene.locationBinding.scope} environment satisfies canonical Location and Scene-state facts.`, required: pkg.scene.locationBinding.visualIdentityRequirement === "REQUIRED", waiverPolicy: pkg.scene.locationBinding.visualIdentityRequirement === "REQUIRED" ? "NON_WAIVABLE_INTEGRITY" : "WAIVABLE_BY_HUMAN", sourceOwner: "LOCATION_AUTHORITY", visuallyObservable: true });
  for (const action of pkg.motionScenePlan.actionExecutions) {
    add({ requirementId: `action:${action.actionExecutionId}`, dimension: "ACTION_COMPLETION", summary: action.semanticAction, required: true, waiverPolicy: "WAIVABLE_BY_HUMAN", sourceOwner: "MOTION", visuallyObservable: true });
    add({ requirementId: `end-state:${action.actionExecutionId}`, dimension: "END_STATE", summary: action.completionAssertions.map(textFact).join("; "), required: true, waiverPolicy: "WAIVABLE_BY_HUMAN", sourceOwner: "MOTION", visuallyObservable: true });
    if (action.objectInteractions.some((item) => item.contactRequired || item.requiresForceResponse)) add({ requirementId: `causality:${action.actionExecutionId}`, dimension: "MOTION_EXECUTION", summary: "Required contact, transfer, and physical causal chain remain observable.", required: true, waiverPolicy: "WAIVABLE_BY_HUMAN", sourceOwner: "MOTION", visuallyObservable: true });
  }
  for (const camera of pkg.motionScenePlan.cameraExecutions) add({ requirementId: `camera:${camera.directorShotId}`, dimension: "DIRECTOR_EXECUTION", summary: `Camera intent ${camera.cameraFamily}: ${camera.boundedMovement}`, required: pkg.generation.cameraMappingRequirement === "REQUIRED", waiverPolicy: "WAIVABLE_BY_HUMAN", sourceOwner: "DIRECTOR", visuallyObservable: true });
  for (const focus of pkg.motionScenePlan.focusExecutions) add({ requirementId: `focus:${focus.directorShotId}`, dimension: "DIRECTOR_EXECUTION", summary: `Focus progression ${focus.progression.map((item) => item.semanticLabel).join(" to ")}`, required: false, waiverPolicy: "WAIVABLE_BY_HUMAN", sourceOwner: "DIRECTOR", visuallyObservable: true });
  for (const keep of pkg.scene.mustKeep) add({ requirementId: `must-keep:${integrityHash(keep).slice(-16)}`, dimension: "MUST_KEEP", summary: keep, required: true, waiverPolicy: "NON_WAIVABLE_INTEGRITY", sourceOwner: "SCENE", visuallyObservable: true });
  for (const avoid of pkg.scene.mustAvoid) add({ requirementId: `must-avoid:${integrityHash(avoid).slice(-16)}`, dimension: "MUST_AVOID", summary: avoid, required: true, waiverPolicy: "NON_WAIVABLE_INTEGRITY", sourceOwner: "SCENE", visuallyObservable: true });
  add({ requirementId: "visual-artifact-integrity", dimension: "VISUAL_ARTIFACTS", summary: "No severe generated deformation, fusion, melting, instability, duplication, or frame corruption materially breaks acceptance.", required: true, waiverPolicy: "WAIVABLE_BY_HUMAN", sourceOwner: "PROVIDER_EXECUTION", visuallyObservable: true });
  add({ requirementId: "output-integrity", dimension: "OUTPUT_INTEGRITY", summary: "Durable video is readable, decodable, non-empty, and structurally usable.", required: true, waiverPolicy: "NON_WAIVABLE_INTEGRITY", sourceOwner: "POST_PROCESSING", visuallyObservable: false });
  const createdAt = input.createdAt ?? new Date().toISOString();
  return AiStoryPostGenerationQcInputPackageSchema.parse({
    postQcInputId: deterministicPersistenceUuid("ai-story-post-qc-input", { providerAttemptId: input.attempt.providerAttemptId, mediaAssetId: input.privateMedia.mediaAssetId, contentHash: input.privateMedia.contentHash, contractVersion: AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION }),
    contractVersion: AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION, policyVersion: AI_STORY_POST_QC_POLICY_VERSION,
    orgId: pkg.orgId, workspaceId: pkg.workspaceId, campaignId: pkg.campaignId, storyId: pkg.storyId,
    storyVersionId: pkg.storyVersionId, scriptVersionId: pkg.scriptVersionId, handoffId: pkg.handoffId,
    sceneExecutionId: input.attempt.sceneExecutionId, sceneId: pkg.scene.sceneId, sceneVersion: pkg.scene.version,
    sceneFingerprint: pkg.scene.fingerprint, sceneExecutionFingerprint: pkg.packageFingerprint,
    providerAttemptId: input.attempt.providerAttemptId, generationMode: input.attempt.generationMode,
    privateMediaAssetId: input.privateMedia.mediaAssetId, privateMediaContentHash: input.privateMedia.contentHash,
    compiledRequestId: input.compiledRequest.compiledRequestId, compiledRequestFingerprint: input.compiledRequest.requestFingerprint,
    semanticPlanFingerprint: input.compiledRequest.semanticPlanFingerprint, preGenerationQcEvaluationId: pkg.qcEvaluation.qcEvaluationId,
    preGenerationQcFingerprint: pkg.qcEvaluation.qcFingerprint, handoffFingerprint: pkg.handoffFingerprint,
    directorFingerprint: pkg.directorFingerprint, motionFingerprint: pkg.motionFingerprint,
    shotRecipeFingerprint: pkg.motionScenePlan.shotRecipeBinding?.recipeFingerprint ?? null,
    castSnapshotFingerprint: input.compiledRequest.castSnapshotFingerprint, locationSnapshotFingerprint: input.compiledRequest.locationSnapshotFingerprint,
    productSnapshotFingerprint: input.compiledRequest.productSnapshotFingerprint,
    entryState: pkg.scene.entryState.map(textFact), scriptActions: pkg.scene.events.filter((event) => event.type === "ACTION").map((event) => event.action),
    requiredExitState: pkg.scene.exitState.map(textFact), mustKeep: pkg.scene.mustKeep, mustAvoid: pkg.scene.mustAvoid,
    newAudienceInformation: pkg.directorDirection.newAudienceInformation, requiredEvidence: pkg.productAuthorities.flatMap((product) => product.visibleEvidenceGoals),
    requirements, providerMetadata: { providerId: input.attempt.providerId, modelId: input.attempt.modelId, providerTaskId: input.attempt.providerTaskId ?? null, actualUsage: input.attempt.actualUsage ?? null },
    media: { durableObjectReference: input.privateMedia.durableObjectReference, mediaType: "video/mp4", byteSize: input.privateMedia.byteSize, durationMs: input.privateMedia.durationMs, width: input.privateMedia.width, height: input.privateMedia.height, readable: input.privateMedia.readable, decodable: input.privateMedia.decodable }, createdAt,
  });
}

/**
 * Builds the same immutable Post-QC contract for the persisted V1 compilation
 * capsule used by the production scheduler.  Older V1 schedules persist the
 * provider-neutral Intent/Instructions and compiled request separately rather
 * than embedding the larger SceneExecutionPackage.  This adapter never treats
 * UI state as authority and fails closed on every execution-significant edge.
 */
export function buildAiStoryPostGenerationQcInputFromCompiledAuthority(input: {
  readonly intent: AiStorySceneExecutionIntent;
  readonly instructions: AiStorySceneCompiledInstructions;
  readonly preGenerationQc: AiStoryPreGenerationQcEvaluation;
  readonly handoffFingerprint: string;
  readonly sceneVersion: number;
  readonly compiledRequest: AiStoryCompiledProviderRequest;
  readonly attempt: {
    readonly providerAttemptId: string;
    readonly compiledRequestId: string;
    readonly requestFingerprint: string;
    readonly sceneExecutionId: string;
    readonly orgId: string;
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly storyId: string;
    readonly storyVersionId: string;
    readonly generationMode: "TEXT_TO_VIDEO" | "FIRST_FRAME_IMAGE_TO_VIDEO";
    readonly providerId: "seedance";
    readonly modelId: "dreamina-seedance-2-0-260128";
    readonly providerTaskId?: string;
    readonly actualUsage?: Record<string, unknown>;
    readonly mediaAssetId?: string;
  };
  readonly privateMedia: {
    readonly mediaAssetId: string;
    readonly contentHash: string;
    readonly durableObjectReference: string;
    readonly byteSize: number;
    readonly durationMs: number | null;
    readonly width: number | null;
    readonly height: number | null;
    readonly readable: boolean;
    readonly decodable: boolean;
  };
  readonly createdAt?: string;
}): AiStoryPostGenerationQcInputPackage {
  const { intent, instructions, preGenerationQc: qc, compiledRequest: compiled, attempt } = input;
  if (
    intent.identity.sceneExecutionId !== compiled.sceneExecutionId ||
    instructions.sceneId !== intent.identity.sceneId ||
    qc.sceneExecutionId !== compiled.sceneExecutionId ||
    qc.qcEvaluationId !== compiled.qcEvaluationId ||
    qc.qcFingerprint !== compiled.qcFingerprint ||
    attempt.compiledRequestId !== compiled.compiledRequestId ||
    attempt.requestFingerprint !== compiled.requestFingerprint ||
    attempt.sceneExecutionId !== compiled.sceneExecutionId ||
    attempt.orgId !== compiled.orgId || attempt.workspaceId !== compiled.workspaceId ||
    attempt.campaignId !== compiled.campaignId || attempt.storyId !== compiled.storyId ||
    attempt.storyVersionId !== compiled.storyVersionId ||
    attempt.generationMode !== compiled.generationMode ||
    attempt.providerId !== compiled.providerId || attempt.modelId !== compiled.modelId ||
    (attempt.mediaAssetId !== undefined && attempt.mediaAssetId !== input.privateMedia.mediaAssetId) ||
    intent.compilationHash !== compiled.sceneFingerprint
  ) {
    throw new Error("POST_QC_COMPILED_AUTHORITY_LINEAGE_MISMATCH");
  }

  const section = (name: string) =>
    compiled.semanticPlan.sections.find((candidate) => candidate.section === name)?.facts ?? [];
  const requirements: AiStoryPostQcRequirement[] = [];
  requirements.push({
    requirementId: "scene-purpose",
    dimension: "SCENE_FIDELITY",
    summary: instructions.purpose,
    required: true,
    waiverPolicy: "WAIVABLE_BY_HUMAN",
    sourceOwner: "SCENE",
    visuallyObservable: true,
  });
  instructions.shots.forEach((shot) => requirements.push({
    requirementId: `action:${shot.shotId}`,
    dimension: "ACTION_COMPLETION",
    summary: shot.information,
    required: true,
    waiverPolicy: "WAIVABLE_BY_HUMAN",
    sourceOwner: "MOTION",
    visuallyObservable: true,
  }));
  if (instructions.continuityNotes.trim()) requirements.push({
    requirementId: "continuity",
    dimension: "CONTINUITY",
    summary: instructions.continuityNotes,
    required: true,
    waiverPolicy: "WAIVABLE_BY_HUMAN",
    sourceOwner: "SCENE",
    visuallyObservable: true,
  });
  instructions.productIdentityConstraints.forEach((constraint, index) => requirements.push({
    requirementId: `product-identity:${index + 1}`,
    dimension: "PRODUCT_FIDELITY",
    summary: constraint,
    required: qc.productGrounded,
    waiverPolicy: qc.productGrounded ? "NON_WAIVABLE_INTEGRITY" : "WAIVABLE_BY_HUMAN",
    sourceOwner: "PRODUCT_AUTHORITY",
    visuallyObservable: true,
  }));
  section("MUST_KEEP").forEach((fact, index) => requirements.push({
    requirementId: `must-keep:${index + 1}`,
    dimension: "MUST_KEEP",
    summary: fact,
    required: true,
    waiverPolicy: "NON_WAIVABLE_INTEGRITY",
    sourceOwner: "SCENE",
    visuallyObservable: true,
  }));
  section("MUST_AVOID").forEach((fact, index) => requirements.push({
    requirementId: `must-avoid:${index + 1}`,
    dimension: "MUST_AVOID",
    summary: fact,
    required: true,
    waiverPolicy: "NON_WAIVABLE_INTEGRITY",
    sourceOwner: "SCENE",
    visuallyObservable: true,
  }));
  requirements.push({
    requirementId: "visual-artifact-integrity",
    dimension: "VISUAL_ARTIFACTS",
    summary: "No severe generated deformation, fusion, melting, instability, duplication, or frame corruption materially breaks acceptance.",
    required: true,
    waiverPolicy: "WAIVABLE_BY_HUMAN",
    sourceOwner: "PROVIDER_EXECUTION",
    visuallyObservable: true,
  }, {
    requirementId: "output-integrity",
    dimension: "OUTPUT_INTEGRITY",
    summary: "Durable video is readable, decodable, non-empty, and structurally usable.",
    required: true,
    waiverPolicy: "NON_WAIVABLE_INTEGRITY",
    sourceOwner: "POST_PROCESSING",
    visuallyObservable: false,
  });

  const createdAt = input.createdAt ?? new Date().toISOString();
  return AiStoryPostGenerationQcInputPackageSchema.parse({
    postQcInputId: deterministicPersistenceUuid("ai-story-post-qc-input", {
      sceneExecutionId: compiled.sceneExecutionId,
      providerAttemptId: attempt.providerAttemptId,
      mediaAssetId: input.privateMedia.mediaAssetId,
      contentHash: input.privateMedia.contentHash,
      contractVersion: AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
    }),
    contractVersion: AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
    policyVersion: AI_STORY_POST_QC_POLICY_VERSION,
    orgId: compiled.orgId,
    workspaceId: compiled.workspaceId,
    campaignId: compiled.campaignId,
    storyId: compiled.storyId,
    storyVersionId: compiled.storyVersionId,
    scriptVersionId: qc.scriptVersionId,
    handoffId: qc.handoffId,
    sceneExecutionId: compiled.sceneExecutionId,
    sceneId: intent.identity.sceneId,
    sceneVersion: input.sceneVersion,
    sceneFingerprint: compiled.sceneFingerprint,
    sceneExecutionFingerprint: compiled.packageFingerprint,
    providerAttemptId: attempt.providerAttemptId,
    generationMode: compiled.generationMode,
    privateMediaAssetId: input.privateMedia.mediaAssetId,
    privateMediaContentHash: input.privateMedia.contentHash,
    compiledRequestId: compiled.compiledRequestId,
    compiledRequestFingerprint: compiled.requestFingerprint,
    semanticPlanFingerprint: compiled.semanticPlanFingerprint,
    preGenerationQcEvaluationId: qc.qcEvaluationId,
    preGenerationQcFingerprint: qc.qcFingerprint,
    handoffFingerprint: input.handoffFingerprint,
    directorFingerprint: compiled.directorFingerprint,
    motionFingerprint: compiled.motionFingerprint,
    shotRecipeFingerprint: qc.shotRecipeBindings?.[0]?.recipeFingerprint ?? null,
    castSnapshotFingerprint: compiled.castSnapshotFingerprint,
    locationSnapshotFingerprint: compiled.locationSnapshotFingerprint,
    productSnapshotFingerprint: compiled.productSnapshotFingerprint,
    entryState: instructions.continuityNotes.trim() ? [instructions.continuityNotes] : [],
    scriptActions: instructions.shots.map((shot) => shot.information),
    requiredExitState: section("REQUIRED_EXIT_STATE"),
    mustKeep: section("MUST_KEEP"),
    mustAvoid: section("MUST_AVOID"),
    newAudienceInformation: section("REQUIRED_EVIDENCE"),
    requiredEvidence: section("REQUIRED_EVIDENCE"),
    requirements,
    providerMetadata: {
      providerId: attempt.providerId,
      modelId: attempt.modelId,
      providerTaskId: attempt.providerTaskId ?? null,
      actualUsage: attempt.actualUsage ?? null,
    },
    media: {
      durableObjectReference: input.privateMedia.durableObjectReference,
      mediaType: "video/mp4",
      byteSize: input.privateMedia.byteSize,
      durationMs: input.privateMedia.durationMs,
      width: input.privateMedia.width,
      height: input.privateMedia.height,
      readable: input.privateMedia.readable,
      decodable: input.privateMedia.decodable,
    },
    createdAt,
  });
}

function deterministicMediaObservations(input: AiStoryPostGenerationQcInputPackage): AiStoryPostQcObservation[] {
  return input.requirements.filter((item) => item.dimension === "OUTPUT_INTEGRITY").map((requirement) => {
    const valid = input.media.readable && input.media.decodable && input.media.byteSize > 0 && input.media.durationMs !== null;
    return AiStoryPostQcObservationSchema.parse({
      observationId: observationId(input, requirement.requirementId, "media"),
      evidenceVersion: AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION,
      requirementId: requirement.requirementId,
      source: "DETERMINISTIC_MEDIA_CHECK",
      summary: valid ? "Durable private media is readable, decodable, non-empty, and has duration metadata." : "Durable private media failed one or more structural integrity checks.",
      observableSignal: valid ? "SATISFIED" : "VIOLATED",
      confidence: { level: "HIGH", score: 1, evidenceQuality: "DETERMINISTIC" },
      timeRangeMs: null,
      subjects: [input.privateMediaAssetId],
      artifactSeverity: valid ? null : "SEVERE",
      subjectiveTasteOnly: false,
    });
  });
}

function failureClass(requirement: AiStoryPostQcRequirement): AiStoryPostQcFinding["failureClass"] {
  const summary = requirement.summary.toLowerCase();
  if (requirement.dimension === "ACTION_COMPLETION") return "ACTION_INCOMPLETE";
  if (requirement.dimension === "END_STATE") return "END_STATE_MISSING";
  if (requirement.dimension === "PRODUCT_FIDELITY") return summary.includes("continuity") ? "PRODUCT_CONTINUITY_FAILURE" : "PRODUCT_IDENTITY_DRIFT";
  if (requirement.dimension === "CHARACTER_FIDELITY") return summary.includes("continuity") ? "CHARACTER_CONTINUITY_FAILURE" : "CHARACTER_IDENTITY_DRIFT";
  if (requirement.dimension === "LOCATION_FIDELITY") return summary.includes("continuity") ? "LOCATION_CONTINUITY_FAILURE" : "LOCATION_IDENTITY_DRIFT";
  if (requirement.dimension === "SCENE_FIDELITY") return "STORY_FUNCTION_MISSING";
  if (requirement.dimension === "REQUIRED_EVIDENCE") return "REQUIRED_EVIDENCE_MISSING";
  if (requirement.dimension === "MUST_KEEP") return "MUST_KEEP_VIOLATION";
  if (requirement.dimension === "MUST_AVOID") return "MUST_AVOID_VIOLATION";
  if (requirement.dimension === "TEXT_CONTAMINATION") return "TEXT_CONTAMINATION";
  if (requirement.dimension === "VISUAL_ARTIFACTS") return "VISUAL_QUALITY_FAILURE";
  if (requirement.dimension === "OUTPUT_INTEGRITY") return "OUTPUT_INTEGRITY_FAILURE";
  if (requirement.dimension === "DIRECTOR_EXECUTION") return summary.includes("focus") ? "FOCUS_EXECUTION_FAILURE" : "CAMERA_MOTION_UNACCEPTABLE";
  if (requirement.dimension === "MOTION_EXECUTION" || requirement.dimension === "CONTINUITY") return summary.includes("causal") ? "PHYSICAL_CAUSALITY_FAILURE" : "PROVIDER_EXECUTION_MISMATCH";
  return "PROVIDER_EXECUTION_MISMATCH";
}

function repairOwner(requirement: AiStoryPostQcRequirement, failure: AiStoryPostQcFinding["failureClass"]): AiStoryPostQcFinding["repairOwner"] {
  if (failure === "OUTPUT_INTEGRITY_FAILURE") return "POST_PROCESSING";
  if (failure === "STORY_FUNCTION_MISSING" || failure === "INSUFFICIENT_SCENE_DIFFERENTIATION") return requirement.sourceOwner;
  if (requirement.sourceOwner === "PROVIDER_ADAPTER") return "PROVIDER_ADAPTER";
  return "PROVIDER_EXECUTION";
}

function findingFor(input: AiStoryPostGenerationQcInputPackage, requirement: AiStoryPostQcRequirement, observations: readonly AiStoryPostQcObservation[]): AiStoryPostQcFinding {
  const relevant = observations.filter((item) => item.requirementId === requirement.requirementId);
  const violation = relevant.find((item) => item.observableSignal === "VIOLATED");
  const satisfied = relevant.find((item) => item.observableSignal === "SATISFIED");
  const subjectiveOnly = relevant.length > 0 && relevant.every((item) => item.subjectiveTasteOnly);
  let result: AiStoryPostQcFinding["result"];
  let reason: string;
  if (subjectiveOnly) {
    result = "WARN"; reason = "Subjective quality observation is reserved for Human Review and is not a hard contract failure.";
  } else if (violation) {
    const strong = ["STRONG", "DETERMINISTIC"].includes(violation.confidence.evidenceQuality);
    const explicitlyMinor = violation.artifactSeverity === "MINOR";
    result = explicitlyMinor ? "WARN" : requirement.required && strong ? "REJECT" : requirement.required ? "UNVERIFIED" : "WARN";
    reason = `QC interpretation: observable evidence indicates the canonical requirement was not satisfied. ${violation.summary}`;
  } else if (satisfied) {
    result = "PASS"; reason = `QC interpretation: available observable evidence satisfies the canonical requirement. ${satisfied.summary}`;
  } else if (requirement.required) {
    result = "UNVERIFIED"; reason = "Required fact could not be safely verified from available observable evidence.";
  } else {
    result = "WARN"; reason = "Optional quality fact was not verified and remains available for Human Review.";
  }
  const failure = result === "REJECT" || result === "UNVERIFIED" ? failureClass(requirement) : null;
  return {
    findingId: deterministicPersistenceUuid("ai-story-post-qc-finding", { postQcInputId: input.postQcInputId, requirementId: requirement.requirementId }),
    requirementId: requirement.requirementId,
    dimension: requirement.dimension,
    result,
    reason,
    evidenceIds: relevant.map((item) => item.observationId),
    confidence: relevant.some((item) => item.confidence.level === "HIGH") ? "HIGH" : relevant.some((item) => item.confidence.level === "MEDIUM") ? "MEDIUM" : "LOW",
    failureClass: failure,
    repairOwner: repairOwner(requirement, failure),
    waiverPolicy: requirement.waiverPolicy,
    sameInputRetryCandidate: result === "REJECT" && repairOwner(requirement, failure) === "PROVIDER_EXECUTION",
  };
}

function aggregate(findings: readonly AiStoryPostQcFinding[]) {
  if (findings.some((item) => item.result === "REJECT")) return "POST_QC_REJECT" as const;
  if (findings.some((item) => item.result === "UNVERIFIED")) return "POST_QC_REQUIRES_HUMAN_CONFIRMATION" as const;
  if (findings.some((item) => item.result === "WARN")) return "POST_QC_WARN" as const;
  return "POST_QC_PASS" as const;
}

export function computeAiStoryPostQcEvaluationFingerprint(input: Omit<AiStoryPostGenerationQcEvaluation, "evaluationFingerprint" | "evaluatedAt">): string {
  return integrityHash({ kind: AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION, ...input });
}

export function isAiStoryPostQcCurrentForMedia(evaluation: AiStoryPostGenerationQcEvaluation, mediaAssetId: string, mediaContentHash: string): boolean {
  return evaluation.mediaAssetId === mediaAssetId && evaluation.mediaContentHash === mediaContentHash;
}

export function postQcAllowsHumanApproval(evaluation: AiStoryPostGenerationQcEvaluation): boolean {
  return !evaluation.findings.some((item) => item.result === "REJECT" && item.waiverPolicy === "NON_WAIVABLE_INTEGRITY");
}

export function buildAiStoryPostQcHumanReviewEvidence(input: { evaluation: AiStoryPostGenerationQcEvaluation; sceneSummary: string }): AiStoryPostQcHumanReviewEvidence {
  const byId = new Map(input.evaluation.observations.map((item) => [item.observationId, item]));
  return AiStoryPostQcHumanReviewEvidenceSchema.parse({
    postQcEvaluationId: input.evaluation.postQcEvaluationId,
    aggregateStatus: input.evaluation.aggregateStatus,
    sceneSummary: input.sceneSummary,
    findings: input.evaluation.findings.map((finding) => ({
      category: finding.dimension,
      result: finding.result,
      reason: finding.reason,
      evidenceSummary: finding.evidenceIds.map((id) => byId.get(id)?.summary).filter(Boolean).join(" ") || "No machine-verifiable observation was available.",
      repairOwner: finding.repairOwner,
      confidence: finding.confidence,
      waiverPolicy: finding.waiverPolicy,
    })),
    warningsMayBeAccepted: true,
    hardFailureWaiverPolicy: "EXPLICIT_NON_WAIVABLE_INTEGRITY_DENIAL",
    humanDecisionRequired: true,
  });
}

export class AiStoryPostGenerationQcService {
  constructor(private readonly dependencies: { repository: AiStoryPostGenerationQcRepository; evidenceProvider: AiStoryVisualEvidenceProvider; now?: () => string }) {}
  async evaluate(rawInput: AiStoryPostGenerationQcInputPackage, evaluationVersion = 1) {
    const input = AiStoryPostGenerationQcInputPackageSchema.parse(rawInput);
    const current = await this.dependencies.repository.getByIdentity({ postQcInputId: input.postQcInputId, evaluationVersion });
    if (current) return { evaluation: current, replayed: true };
    let visual: readonly AiStoryPostQcObservation[] = [];
    let evidenceUnavailable = false;
    try { visual = await this.dependencies.evidenceProvider.analyze(input); }
    catch { evidenceUnavailable = true; }
    const observations = [...deterministicMediaObservations(input), ...visual].map((item) => AiStoryPostQcObservationSchema.parse(item));
    const findings = input.requirements.map((requirement) => findingFor(input, requirement, observations));
    const base = {
      postQcEvaluationId: deterministicPersistenceUuid("ai-story-post-qc-evaluation", { postQcInputId: input.postQcInputId, evaluationVersion }),
      contractVersion: AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
      policyVersion: AI_STORY_POST_QC_POLICY_VERSION,
      evaluationVersion,
      postQcInputId: input.postQcInputId,
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      providerAttemptId: input.providerAttemptId,
      mediaAssetId: input.privateMediaAssetId,
      mediaContentHash: input.privateMediaContentHash,
      sceneExecutionId: input.sceneExecutionId,
      sceneFingerprint: input.sceneFingerprint,
      compiledRequestFingerprint: input.compiledRequestFingerprint,
      generationMode: input.generationMode,
      observations,
      findings,
      aggregateStatus: aggregate(findings),
      evidenceUnavailable,
      eligibleForHumanReview: true as const,
      autoApproved: false as const,
      autoRetryAuthorized: false as const,
      autoReleaseAuthorized: false as const,
      creativeAuthority: false as const,
    };
    const evaluation = AiStoryPostGenerationQcEvaluationSchema.parse({
      ...base,
      evaluationFingerprint: computeAiStoryPostQcEvaluationFingerprint(base),
      evaluatedAt: this.dependencies.now?.() ?? new Date().toISOString(),
    });
    return this.dependencies.repository.accept(evaluation);
  }
}

export const POST_QC_PERSISTS_CHAIN_OF_THOUGHT = false as const;
export const POST_QC_SUBJECTIVE_TASTE_HARD_REJECT = false as const;
export const POST_QC_DEFAULT_REPAIR_OWNER_SCRIPT = false as const;
