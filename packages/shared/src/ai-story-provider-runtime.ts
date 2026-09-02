import { z } from "zod";
import { AiStorySeedanceSemanticPlanSchema } from "./ai-story-scene-execution-package";
import { AiStoryEffectiveSceneGenerationAuthoritySchema } from "./ai-story-generation-authority";

export const AI_STORY_COMPILED_PROVIDER_REQUEST_VERSION =
  "ai-story-compiled-provider-request.v1" as const;
export const AI_STORY_PROVIDER_RUNTIME_VERSION =
  "ai-story-provider-runtime.v1" as const;
export const AI_STORY_POST_GENERATION_QC_HOOK_VERSION =
  "ai-story-post-generation-qc-input.v1" as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1);

export const AI_STORY_PROVIDER_ATTEMPT_STATES = [
  "READY",
  "DISPATCHING",
  "SUBMITTED",
  "RUNNING",
  "RECONCILIATION_REQUIRED",
  "PROVIDER_RESULT_READY",
  "POST_GENERATION_QC_PENDING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "MEDIA_INGESTION_FAILED",
] as const;

export const AI_STORY_PROVIDER_FAILURE_CLASSES = [
  "PROVIDER_MODERATION_REJECTED",
  "PROVIDER_TRANSPORT_FAILURE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_GENERATION_FAILED",
  "PROVIDER_CANCELLED",
  "PROVIDER_EXPIRED",
  "PROVIDER_RESULT_MISSING",
  "MEDIA_INGESTION_FAILED",
] as const;

export const AiStoryCompiledReferenceMappingSchema = z.object({
  referenceId: Id,
  assetId: Id,
  authorityType: z.enum(["CAST", "PRODUCT", "LOCATION", "OTHER"]),
  authorityId: Id,
  authorityClass: z.enum(["REQUIRED", "PREFERRED", "OPTIONAL"]),
  wireRole: z.enum(["first_frame", "reference_image"]),
  semanticBinding: Text,
  mediaType: Text.optional(),
  storagePath: Text.optional(),
}).strict();

export const AI_STORY_COMPILED_REFERENCE_ROLES = [
  "FIRST_FRAME",
  "PROVIDER_IMAGE_REFERENCE",
  "STORY_VISUAL_REFERENCE",
  "STORY_CONTINUITY_REFERENCE",
] as const;

/**
 * Complete immutable Story-reference lineage. This is intentionally separate
 * from `referenceMappings`, which contains only assets emitted on the Provider
 * wire. A lineage reference therefore never becomes a Provider input merely
 * because it belongs to the Scene.
 */
export const AiStoryCompiledStoryReferenceSchema = z.object({
  referenceId: Id,
  assetId: Id,
  semanticRole: z.enum(AI_STORY_COMPILED_REFERENCE_ROLES),
  mediaType: Text,
  providerEmitted: z.boolean(),
  providerWireRole: z.enum(["first_frame", "reference_image"]).optional(),
  storagePath: Text.optional(),
}).strict().superRefine((value, context) => {
  const image = value.mediaType.toLowerCase().startsWith("image/");
  if (value.semanticRole === "FIRST_FRAME" && (!image || value.providerWireRole !== "first_frame" || !value.providerEmitted)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "FIRST_FRAME must be an emitted image input" });
  }
  if (value.semanticRole === "PROVIDER_IMAGE_REFERENCE" && (!image || value.providerWireRole !== "reference_image" || !value.providerEmitted)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Provider image references must be emitted image inputs" });
  }
  if (["STORY_VISUAL_REFERENCE", "STORY_CONTINUITY_REFERENCE"].includes(value.semanticRole) && (value.providerEmitted || value.providerWireRole)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Story-only references are lineage-only" });
  }
});

/**
 * Immutable output of Provider compilation. URLs and credentials are deliberately
 * absent: the Worker resolves short-lived transport access from stable Asset IDs.
 */
export const AiStoryCompiledProviderRequestSchema = z.object({
  compiledRequestId: Id,
  contractVersion: z.literal(AI_STORY_COMPILED_PROVIDER_REQUEST_VERSION),
  runtimeVersion: z.literal(AI_STORY_PROVIDER_RUNTIME_VERSION),
  orgId: Id,
  workspaceId: Id,
  campaignId: Id,
  storyId: Id,
  storyVersionId: Id,
  sceneExecutionId: Id,
  sceneExecutionPackageId: Id,
  generationMode: z.enum(["TEXT_TO_VIDEO", "FIRST_FRAME_IMAGE_TO_VIDEO"]),
  generationAuthority: AiStoryEffectiveSceneGenerationAuthoritySchema.optional(),
  providerId: z.literal("seedance"),
  modelId: z.literal("dreamina-seedance-2-0-260128"),
  adapterVersion: Text,
  mappingVersion: Text,
  capabilityVersion: Text,
  qcCapabilityVersion: Text,
  qcEvaluationId: Id,
  qcFingerprint: Hash,
  sceneFingerprint: Hash,
  directorFingerprint: Hash,
  motionFingerprint: Hash,
  castSnapshotFingerprint: Hash,
  locationSnapshotFingerprint: Hash,
  productSnapshotFingerprint: Hash,
  packageFingerprint: Hash,
  semanticPlan: AiStorySeedanceSemanticPlanSchema,
  semanticPlanFingerprint: Hash,
  compiledPrompt: Text,
  compiledPromptFingerprint: Hash,
  structuredRequest: z.object({
    model: z.literal("dreamina-seedance-2-0-260128"),
    duration: z.union([z.literal(4), z.literal(5), z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
    ratio: z.enum(["9:16", "16:9", "1:1"]),
    resolution: z.enum(["480p", "720p", "1080p"]),
    generateAudio: z.literal(false),
    watermark: z.boolean(),
  }).strict(),
  referenceMappings: z.array(AiStoryCompiledReferenceMappingSchema).max(4),
  /** Added append-only; absent only on historical v1 compiled requests. */
  storyReferenceMappings: z.array(AiStoryCompiledStoryReferenceSchema).optional(),
  referenceBudget: z.literal(4),
  degradations: z.array(z.object({
    code: Text,
    authorityId: Id.optional(),
    safeEvidence: Text,
  }).strict()),
  blockedCapabilities: z.array(Text),
  estimatedCost: z.object({
    currency: Text,
    amount: z.number().nonnegative().nullable(),
    source: z.enum(["CONFIGURED_ESTIMATE", "UNKNOWN"]),
  }).strict(),
  dispatchReady: z.literal(true),
  compiledAt: z.string().datetime(),
  requestFingerprint: Hash,
}).strict();

export type AiStoryCompiledProviderRequest = z.infer<
  typeof AiStoryCompiledProviderRequestSchema
>;

export const SEEDANCE_FIRST_FRAME_I2V_WIRE_MODE_ERROR =
  "SEEDANCE_FIRST_FRAME_I2V_WIRE_MODE_INVALID" as const;

export class AiStoryProviderWireModeContractError extends Error {
  readonly code = SEEDANCE_FIRST_FRAME_I2V_WIRE_MODE_ERROR;

  constructor(message: string) {
    super(message);
    this.name = "AiStoryProviderWireModeContractError";
  }
}

/**
 * Provider-mode compatibility is validated independently from Story lineage.
 * V1 first-frame I2V is a one-image wire mode; additional Story images remain
 * immutable lineage but cannot be projected as `reference_image`.
 */
export function assertAiStoryCompiledProviderWireModeCompatibility(
  request: AiStoryCompiledProviderRequest
): void {
  if (request.generationMode !== "FIRST_FRAME_IMAGE_TO_VIDEO") return;
  const firstFrames = request.referenceMappings.filter(
    (reference) => reference.wireRole === "first_frame"
  );
  const referenceImages = request.referenceMappings.filter(
    (reference) => reference.wireRole === "reference_image"
  );
  if (
    request.referenceMappings.length !== 1 ||
    firstFrames.length !== 1 ||
    referenceImages.length !== 0
  ) {
    throw new AiStoryProviderWireModeContractError(
      "FIRST_FRAME_IMAGE_TO_VIDEO requires exactly one first_frame and forbids reference_image inputs"
    );
  }
  const firstFrame = firstFrames[0]!;
  if (firstFrame.mediaType && !firstFrame.mediaType.toLowerCase().startsWith("image/")) {
    throw new AiStoryProviderWireModeContractError(
      "FIRST_FRAME_IMAGE_TO_VIDEO first_frame must use image media"
    );
  }
}

export const AiStoryProviderAttemptBindingSchema = z.object({
  providerAttemptId: Id,
  providerExecutionId: Text,
  contractVersion: z.literal(AI_STORY_PROVIDER_RUNTIME_VERSION),
  compiledRequestId: Id,
  requestFingerprint: Hash,
  attemptInputFingerprint: Hash,
  idempotencyKey: Text,
  attemptNumber: z.number().int().positive(),
  orgId: Id,
  workspaceId: Id,
  campaignId: Id,
  storyId: Id,
  storyVersionId: Id,
  sceneExecutionId: Id,
  generationMode: z.enum(["TEXT_TO_VIDEO", "FIRST_FRAME_IMAGE_TO_VIDEO"]),
  generationAuthority: AiStoryEffectiveSceneGenerationAuthoritySchema.optional(),
  providerId: z.literal("seedance"),
  modelId: z.literal("dreamina-seedance-2-0-260128"),
  adapterVersion: Text,
  mappingVersion: Text,
  capabilityVersion: Text,
  qcEvaluationId: Id,
  qcFingerprint: Hash,
  sceneFingerprint: Hash,
  directorFingerprint: Hash,
  motionFingerprint: Hash,
  castSnapshotFingerprint: Hash,
  locationSnapshotFingerprint: Hash,
  productSnapshotFingerprint: Hash,
  estimatedCost: z.object({
    currency: Text,
    amount: z.number().nonnegative().nullable(),
    source: z.enum(["CONFIGURED_ESTIMATE", "UNKNOWN"]),
  }).strict(),
  /** Canonical commercial reservation consumed by this Attempt before submit. */
  commercialReservationId: Id.optional(),
  status: z.enum(AI_STORY_PROVIDER_ATTEMPT_STATES),
  providerTaskId: Text.optional(),
  submissionClaimOwner: Text.optional(),
  submissionClaimedAt: z.string().datetime().optional(),
  submitStartedAt: z.string().datetime().optional(),
  submittedAt: z.string().datetime().optional(),
  pollCount: z.number().int().nonnegative(),
  failureClass: z.enum(AI_STORY_PROVIDER_FAILURE_CLASSES).optional(),
  actualUsage: z.record(z.unknown()).optional(),
  mediaAssetId: Id.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  automaticPaidRetry: z.literal(false),
  providerFallback: z.literal(false),
}).strict();

export type AiStoryProviderAttemptBinding = z.infer<
  typeof AiStoryProviderAttemptBindingSchema
>;

const ATTEMPT_TRANSITIONS: Readonly<Record<AiStoryProviderAttemptBinding["status"], readonly AiStoryProviderAttemptBinding["status"][]>> = {
  READY: ["DISPATCHING"],
  DISPATCHING: ["SUBMITTED", "RECONCILIATION_REQUIRED", "FAILED"],
  SUBMITTED: ["SUBMITTED", "RUNNING", "PROVIDER_RESULT_READY", "FAILED", "CANCELLED", "EXPIRED"],
  RUNNING: ["RUNNING", "PROVIDER_RESULT_READY", "FAILED", "CANCELLED", "EXPIRED"],
  RECONCILIATION_REQUIRED: ["RECONCILIATION_REQUIRED", "SUBMITTED", "FAILED"],
  PROVIDER_RESULT_READY: ["POST_GENERATION_QC_PENDING", "MEDIA_INGESTION_FAILED"],
  POST_GENERATION_QC_PENDING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [], FAILED: [], CANCELLED: [], EXPIRED: [], MEDIA_INGESTION_FAILED: [],
};

export function isAiStoryProviderAttemptTransitionAllowed(
  from: AiStoryProviderAttemptBinding["status"],
  to: AiStoryProviderAttemptBinding["status"]
): boolean {
  return ATTEMPT_TRANSITIONS[from].includes(to);
}

export const AiStoryProviderRuntimeJobSchema = z.object({
  providerAttemptId: Id,
  workspaceId: Id,
  sceneExecutionId: Id,
  contractVersion: z.literal(AI_STORY_PROVIDER_RUNTIME_VERSION),
}).strict();

export type AiStoryProviderRuntimeJob = z.infer<
  typeof AiStoryProviderRuntimeJobSchema
>;

export const AiStoryPostGenerationQcInputSchema = z.object({
  contractVersion: z.literal(AI_STORY_POST_GENERATION_QC_HOOK_VERSION),
  providerAttemptId: Id,
  compiledRequestId: Id,
  sceneExecutionId: Id,
  generationMode: z.enum(["TEXT_TO_VIDEO", "FIRST_FRAME_IMAGE_TO_VIDEO"]),
  requestFingerprint: Hash,
  sceneFingerprint: Hash,
  directorFingerprint: Hash,
  motionFingerprint: Hash,
  castSnapshotFingerprint: Hash,
  locationSnapshotFingerprint: Hash,
  productSnapshotFingerprint: Hash,
  mediaAssetId: Id,
  requiredExitState: z.array(Text),
  mustKeep: z.array(Text),
  mustAvoid: z.array(Text),
  providerMetadata: z.record(z.unknown()),
}).strict();

export type AiStoryPostGenerationQcInput = z.infer<
  typeof AiStoryPostGenerationQcInputSchema
>;

export const AI_STORY_RUNTIME_CREATIVE_COMPILATION = false as const;
export const AI_STORY_RUNTIME_REFERENCE_BUDGET_DECISION = false as const;
export const AI_STORY_AUTOMATIC_PAID_RETRY = false as const;
export const AI_STORY_CROSS_PROVIDER_FALLBACK = false as const;
