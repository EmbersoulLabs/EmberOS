import { z } from "zod";

export const AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION = "ai-story-post-generation-qc.v1" as const;
export const AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION = "ai-story-visual-evidence.v1" as const;
export const AI_STORY_POST_QC_POLICY_VERSION = "ai-story-post-qc-policy.2026-08-30.v1" as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1).max(3000);

export const AI_STORY_POST_QC_DIMENSIONS = [
  "SCENE_FIDELITY", "PRODUCT_FIDELITY", "CHARACTER_FIDELITY", "LOCATION_FIDELITY",
  "ACTION_COMPLETION", "END_STATE", "CONTINUITY", "DIRECTOR_EXECUTION", "MOTION_EXECUTION",
  "REQUIRED_EVIDENCE", "MUST_KEEP", "MUST_AVOID", "VISUAL_ARTIFACTS", "TEXT_CONTAMINATION",
  "OUTPUT_INTEGRITY",
] as const;

export const AI_STORY_POST_QC_FAILURE_CLASSES = [
  "STORY_FUNCTION_MISSING", "INSUFFICIENT_SCENE_DIFFERENTIATION", "ACTION_INCOMPLETE",
  "END_STATE_MISSING", "PHYSICAL_CAUSALITY_FAILURE", "PRODUCT_IDENTITY_DRIFT",
  "CHARACTER_IDENTITY_DRIFT", "LOCATION_IDENTITY_DRIFT", "CHARACTER_CONTINUITY_FAILURE",
  "PRODUCT_CONTINUITY_FAILURE", "LOCATION_CONTINUITY_FAILURE", "CAMERA_MOTION_UNACCEPTABLE",
  "FOCUS_EXECUTION_FAILURE", "REQUIRED_EVIDENCE_MISSING", "MUST_KEEP_VIOLATION",
  "MUST_AVOID_VIOLATION", "VISUAL_QUALITY_FAILURE", "TEXT_CONTAMINATION",
  "OUTPUT_INTEGRITY_FAILURE", "PROVIDER_EXECUTION_MISMATCH",
] as const;

export const AI_STORY_POST_QC_REPAIR_OWNERS = [
  "SCRIPT", "SCENE", "CHARACTER_AUTHORITY", "LOCATION_AUTHORITY", "PRODUCT_AUTHORITY",
  "DIRECTOR", "MOTION", "PROVIDER_ADAPTER", "PROVIDER_EXECUTION", "POST_PROCESSING",
  "HUMAN_REVIEW_ONLY",
] as const;

export const AiStoryPostQcRequirementSchema = z.object({
  requirementId: Text.max(200),
  dimension: z.enum(AI_STORY_POST_QC_DIMENSIONS),
  summary: Text,
  required: z.boolean(),
  waiverPolicy: z.enum(["WAIVABLE_BY_HUMAN", "NON_WAIVABLE_INTEGRITY"]),
  sourceOwner: z.enum(AI_STORY_POST_QC_REPAIR_OWNERS),
  visuallyObservable: z.boolean(),
}).strict();

export const AiStoryPostGenerationQcInputPackageSchema = z.object({
  postQcInputId: Id,
  contractVersion: z.literal(AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION),
  policyVersion: z.literal(AI_STORY_POST_QC_POLICY_VERSION),
  orgId: Id,
  workspaceId: Id,
  campaignId: Id,
  storyId: Id,
  storyVersionId: Id,
  scriptVersionId: Id,
  handoffId: Id,
  sceneExecutionId: Id,
  sceneId: Text.max(300),
  sceneVersion: z.number().int().positive(),
  sceneFingerprint: Hash,
  sceneExecutionFingerprint: Hash,
  providerAttemptId: Text.max(300),
  generationMode: z.enum(["TEXT_TO_VIDEO", "FIRST_FRAME_IMAGE_TO_VIDEO"]),
  privateMediaAssetId: Id,
  privateMediaContentHash: Hash,
  compiledRequestId: Id,
  compiledRequestFingerprint: Hash,
  semanticPlanFingerprint: Hash,
  preGenerationQcEvaluationId: Id,
  preGenerationQcFingerprint: Hash,
  handoffFingerprint: Hash,
  directorFingerprint: Hash,
  motionFingerprint: Hash,
  shotRecipeFingerprint: Hash.nullable(),
  castSnapshotFingerprint: Hash,
  locationSnapshotFingerprint: Hash,
  productSnapshotFingerprint: Hash,
  entryState: z.array(Text),
  scriptActions: z.array(Text),
  requiredExitState: z.array(Text),
  mustKeep: z.array(Text),
  mustAvoid: z.array(Text),
  newAudienceInformation: z.array(Text),
  requiredEvidence: z.array(Text),
  requirements: z.array(AiStoryPostQcRequirementSchema).min(1),
  providerMetadata: z.record(z.unknown()),
  media: z.object({
    durableObjectReference: Text,
    mediaType: z.literal("video/mp4"),
    byteSize: z.number().int().positive(),
    durationMs: z.number().int().positive().nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    readable: z.boolean(),
    decodable: z.boolean(),
  }).strict(),
  createdAt: z.string().datetime(),
}).strict();

export const AiStoryPostQcObservationSchema = z.object({
  observationId: Id,
  evidenceVersion: z.literal(AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION),
  requirementId: Text.max(200),
  source: z.enum(["DETERMINISTIC_MEDIA_CHECK", "AI_VISUAL_EVIDENCE", "HUMAN_SUPPLIED_EVIDENCE"]),
  summary: Text,
  observableSignal: z.enum(["SATISFIED", "VIOLATED", "UNCERTAIN", "NOT_APPLICABLE"]),
  confidence: z.object({
    level: z.enum(["LOW", "MEDIUM", "HIGH"]),
    score: z.number().min(0).max(1),
    evidenceQuality: z.enum(["LIMITED", "ADEQUATE", "STRONG", "DETERMINISTIC"]),
  }).strict(),
  timeRangeMs: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict().nullable(),
  subjects: z.array(Text.max(300)),
  artifactSeverity: z.enum(["MINOR", "MODERATE", "SEVERE"]).nullable(),
  subjectiveTasteOnly: z.boolean().default(false),
}).strict();

export const AiStoryPostQcFindingSchema = z.object({
  findingId: Id,
  requirementId: Text.max(200),
  dimension: z.enum(AI_STORY_POST_QC_DIMENSIONS),
  result: z.enum(["PASS", "WARN", "REJECT", "UNVERIFIED"]),
  reason: Text,
  evidenceIds: z.array(Id),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  failureClass: z.enum(AI_STORY_POST_QC_FAILURE_CLASSES).nullable(),
  repairOwner: z.enum(AI_STORY_POST_QC_REPAIR_OWNERS),
  waiverPolicy: z.enum(["WAIVABLE_BY_HUMAN", "NON_WAIVABLE_INTEGRITY"]),
  sameInputRetryCandidate: z.boolean(),
}).strict();

export const AiStoryPostGenerationQcEvaluationSchema = z.object({
  postQcEvaluationId: Id,
  contractVersion: z.literal(AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION),
  policyVersion: z.literal(AI_STORY_POST_QC_POLICY_VERSION),
  evaluationVersion: z.number().int().positive(),
  postQcInputId: Id,
  orgId: Id,
  workspaceId: Id,
  providerAttemptId: Text.max(300),
  mediaAssetId: Id,
  mediaContentHash: Hash,
  sceneExecutionId: Id,
  sceneFingerprint: Hash,
  compiledRequestFingerprint: Hash,
  generationMode: z.enum(["TEXT_TO_VIDEO", "FIRST_FRAME_IMAGE_TO_VIDEO"]),
  observations: z.array(AiStoryPostQcObservationSchema),
  findings: z.array(AiStoryPostQcFindingSchema),
  aggregateStatus: z.enum(["POST_QC_PASS", "POST_QC_WARN", "POST_QC_REJECT", "POST_QC_REQUIRES_HUMAN_CONFIRMATION"]),
  evidenceUnavailable: z.boolean(),
  eligibleForHumanReview: z.literal(true),
  autoApproved: z.literal(false),
  autoRetryAuthorized: z.literal(false),
  autoReleaseAuthorized: z.literal(false),
  creativeAuthority: z.literal(false),
  evaluationFingerprint: Hash,
  evaluatedAt: z.string().datetime(),
}).strict();

export const AiStoryPostQcHumanReviewEvidenceSchema = z.object({
  postQcEvaluationId: Id,
  aggregateStatus: z.enum(["POST_QC_PASS", "POST_QC_WARN", "POST_QC_REJECT", "POST_QC_REQUIRES_HUMAN_CONFIRMATION"]),
  sceneSummary: Text,
  findings: z.array(z.object({
    category: z.enum(AI_STORY_POST_QC_DIMENSIONS),
    result: z.enum(["PASS", "WARN", "REJECT", "UNVERIFIED"]),
    reason: Text,
    evidenceSummary: Text,
    repairOwner: z.enum(AI_STORY_POST_QC_REPAIR_OWNERS),
    confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
    waiverPolicy: z.enum(["WAIVABLE_BY_HUMAN", "NON_WAIVABLE_INTEGRITY"]),
  }).strict()),
  warningsMayBeAccepted: z.literal(true),
  hardFailureWaiverPolicy: z.literal("EXPLICIT_NON_WAIVABLE_INTEGRITY_DENIAL"),
  humanDecisionRequired: z.literal(true),
}).strict();

export type AiStoryPostQcRequirement = z.infer<typeof AiStoryPostQcRequirementSchema>;
export type AiStoryPostGenerationQcInputPackage = z.infer<typeof AiStoryPostGenerationQcInputPackageSchema>;
export type AiStoryPostQcObservation = z.infer<typeof AiStoryPostQcObservationSchema>;
export type AiStoryPostQcFinding = z.infer<typeof AiStoryPostQcFindingSchema>;
export type AiStoryPostGenerationQcEvaluation = z.infer<typeof AiStoryPostGenerationQcEvaluationSchema>;
export type AiStoryPostQcHumanReviewEvidence = z.infer<typeof AiStoryPostQcHumanReviewEvidenceSchema>;

export const POST_QC_CREATIVE_AUTHORITY = false as const;
export const POST_QC_AUTO_RETRY = false as const;
export const POST_QC_AUTO_RELEASE = false as const;
export const VISION_PROVIDER_IS_QC_AUTHORITY = false as const;
