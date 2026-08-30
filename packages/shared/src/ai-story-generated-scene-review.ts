/**
 * EXEC-04 — generated Scene media review / retry contracts.
 *
 * Review attaches to Scene execution + provider attempt/output, not UI state.
 * Retry is a new provider attempt of the same Scene with frozen input.
 * Plan/intent QC is not generated-media approval. EXEC-06 freezes V1 as
 * plan/intent AI QC + mandatory human generated-media review (this module).
 */
import { z } from "zod";
import { RetryEligibilitySchema } from "./ai-story-differentiated-retry";
import { AiStoryPostQcHumanReviewEvidenceSchema } from "./ai-story-post-generation-qc";

export const AI_STORY_GENERATED_SCENE_REVIEW_CONTRACT_VERSION = "1" as const;
export const AI_STORY_SCENE_MAX_ATTEMPTS_ENV = "AI_STORY_SCENE_MAX_ATTEMPTS";
export const AI_STORY_SCENE_MAX_ATTEMPTS_DEFAULT = 3;

export const GENERATED_SCENE_REVIEW_STATES = [
  "PENDING_REVIEW",
  "REJECTED",
  "APPROVED",
  "RETRY_REQUESTED",
  "REJECTED_TERMINAL",
] as const;

export const GeneratedSceneReviewStateSchema = z.enum(
  GENERATED_SCENE_REVIEW_STATES
);
export type GeneratedSceneReviewState = z.infer<
  typeof GeneratedSceneReviewStateSchema
>;

export const GENERATED_SCENE_REVIEW_ERROR_CODES = [
  "GENERATED_SCENE_REVIEW_DENIED",
  "GENERATED_SCENE_REVIEW_NOT_FOUND",
  "GENERATED_SCENE_REVIEW_STATE_CONFLICT",
  "GENERATED_SCENE_APPROVAL_BINDING_INVALID",
  "GENERATED_SCENE_RETRY_NOT_ELIGIBLE",
  "GENERATED_SCENE_RETRY_LIMIT_EXHAUSTED",
  "GENERATED_SCENE_RETRY_IN_FLIGHT",
  "GENERATED_SCENE_IDENTITY_FORGED",
  "GENERATED_SCENE_REVIEW_REDACTED",
] as const;

export const GeneratedSceneReviewErrorCodeSchema = z.enum(
  GENERATED_SCENE_REVIEW_ERROR_CODES
);
export type GeneratedSceneReviewErrorCode = z.infer<
  typeof GeneratedSceneReviewErrorCodeSchema
>;

export function resolveAiStorySceneMaxAttempts(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env[AI_STORY_SCENE_MAX_ATTEMPTS_ENV]?.trim();
  if (!raw) return AI_STORY_SCENE_MAX_ATTEMPTS_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    return AI_STORY_SCENE_MAX_ATTEMPTS_DEFAULT;
  }
  return parsed;
}

export const GeneratedSceneReviewFactSchema = z
  .object({
    generatedSceneReviewId: z.string().uuid(),
    orgId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    campaignId: z.string().uuid(),
    storyId: z.string().uuid(),
    executionPlanId: z.string().uuid(),
    sceneExecutionId: z.string().uuid(),
    sceneId: z.string().min(1),
    providerAttemptId: z.string().min(1),
    sceneResultId: z.string().uuid().nullable(),
    decision: GeneratedSceneReviewStateSchema,
    decidedBy: z.string().uuid().nullable(),
    decidedAt: z.string().datetime().nullable(),
    rationale: z.string().max(2000).nullable(),
    contractVersion: z.literal(AI_STORY_GENERATED_SCENE_REVIEW_CONTRACT_VERSION),
  })
  .strict();

export type GeneratedSceneReviewFact = z.infer<
  typeof GeneratedSceneReviewFactSchema
>;

export const GeneratedSceneAttemptReadModelSchema = z
  .object({
    attemptId: z.string().min(1),
    attemptNumber: z.number().int().positive(),
    providerExecutionId: z.string().min(1).nullable(),
    status: z.string().min(1),
    outcome: z.enum(["running", "success", "failure", "unknown"]),
    sceneResultId: z.string().uuid().nullable(),
    reviewState: GeneratedSceneReviewStateSchema.nullable(),
    failureClass: z.string().nullable(),
    knownCostAmount: z.number().nullable(),
    costSource: z.string().nullable(),
    createdAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict();

export type GeneratedSceneAttemptReadModel = z.infer<
  typeof GeneratedSceneAttemptReadModelSchema
>;

/**
 * Browser-safe identity and request-scoped delivery for one persisted Scene
 * Result. The durable storage key is deliberately excluded; deliveryUrl is a
 * short-lived server-minted URL and is never persistence authority.
 */
export const GeneratedSceneMediaReadModelSchema = z
  .object({
    mediaId: z.string().uuid(),
    sceneResultId: z.string().uuid(),
    sceneExecutionId: z.string().uuid(),
    providerAttemptId: z.string().min(1),
    mediaType: z.string().min(1),
    contentType: z.string().min(1),
    deliveryUrl: z.string().url().nullable(),
    expiresAt: z.string().datetime().nullable(),
    deliveryStatus: z.enum(["PENDING", "READY", "UNAVAILABLE"]),
    safeError: z.string().nullable(),
  })
  .strict();

export type GeneratedSceneMediaReadModel = z.infer<
  typeof GeneratedSceneMediaReadModelSchema
>;

export const GeneratedSceneRuntimeStateSchema = z.enum([
  "AUTHORIZED_NOT_RELEASED",
  "QUEUED",
  "PRE_DISPATCH_BLOCKED",
  "RUNNING",
  "PENDING_REVIEW",
  "REJECTED",
  "RETRY_AUTHORIZED",
  "APPROVED",
  "FAILED",
]);
export type GeneratedSceneRuntimeState = z.infer<
  typeof GeneratedSceneRuntimeStateSchema
>;

/** Browser-safe per-Scene generated-media review projection. No secrets/URLs. */
export const GeneratedSceneReviewReadModelSchema = z
  .object({
    sceneExecutionId: z.string().uuid(),
    sceneId: z.string().min(1),
    sceneOrder: z.number().int().nonnegative(),
    reviewState: GeneratedSceneReviewStateSchema,
    runtimeState: GeneratedSceneRuntimeStateSchema.default("QUEUED"),
    reviewAvailable: z.boolean().default(false),
    recoveryMode: z
      .literal("HUMAN_RETRY_FROM_PRE_PROVIDER_FAILURE")
      .nullable()
      .default(null),
    approvedAttemptId: z.string().nullable(),
    approvedSceneResultId: z.string().uuid().nullable(),
    latestAttemptId: z.string().nullable(),
    latestReviewId: z.string().uuid().nullable().default(null),
    retryEligibility: RetryEligibilitySchema.nullable().default(null),
    retryInputRevisionId: z.string().uuid().nullable().default(null),
    retryAuthorizationId: z.string().uuid().nullable().default(null),
    latestAttemptNumber: z.number().int().positive().nullable(),
    latestAttemptStatus: z.string().nullable(),
    attemptCount: z.number().int().nonnegative(),
    retryRemaining: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    latestAttemptKnownCost: z.number().nullable(),
    sceneKnownCost: z.number().nullable(),
    currency: z.literal("USD"),
    running: z.boolean(),
    attempts: z.array(GeneratedSceneAttemptReadModelSchema),
    generatedMedia: GeneratedSceneMediaReadModelSchema.nullable().default(null),
    postGenerationQcEvidence: AiStoryPostQcHumanReviewEvidenceSchema.optional(),
  })
  .strict();

export type GeneratedSceneReviewReadModel = z.infer<
  typeof GeneratedSceneReviewReadModelSchema
>;

export const GeneratedSceneReviewDecisionResponseSchema = z
  .object({
    review: GeneratedSceneReviewFactSchema,
    scene: GeneratedSceneReviewReadModelSchema,
    retryEnqueued: z.boolean(),
    newAttemptNumber: z.number().int().positive().nullable(),
  })
  .strict();

export type GeneratedSceneReviewDecisionResponse = z.infer<
  typeof GeneratedSceneReviewDecisionResponseSchema
>;

const SECRETISH =
  /(authorization|bearer\s|api[_-]?key|secret|signed|x-amz-|token=|stack\s*trace|providerpayload|rawprovider)/i;

export function redactGeneratedSceneReviewError(message: string): string {
  const trimmed = message.trim();
  if (!trimmed || SECRETISH.test(trimmed) || trimmed.length > 280) {
    return "Scene review request failed.";
  }
  return trimmed;
}

const FORGED_REVIEW_BODY_KEYS = [
  "attemptNumber",
  "sceneId",
  "storyId",
  "executionPlanId",
  "reviewedBy",
  "reviewerId",
  "accessMode",
  "settlementMode",
  "role",
] as const;

export function rejectForgedGeneratedSceneReviewBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  for (const key of FORGED_REVIEW_BODY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) return key;
  }
  return null;
}

export function selectAssemblyAuthoritativeSceneResults<
  T extends { readonly sceneExecutionId: string; readonly sceneResultId: string },
>(input: {
  readonly sceneResults: readonly T[];
  readonly approvedSceneResultIds: ReadonlySet<string>;
}): T[] {
  const approved = input.sceneResults.filter((result) =>
    input.approvedSceneResultIds.has(result.sceneResultId)
  );
  const byScene = new Map<string, T>();
  for (const result of approved) {
    if (byScene.has(result.sceneExecutionId)) {
      throw new Error(
        "Multiple approved generated Scene outputs exist for one Scene Execution"
      );
    }
    byScene.set(result.sceneExecutionId, result);
  }
  return [...byScene.values()];
}

export function latestRowBySceneExecutionId<
  T extends { readonly sceneExecutionId: string },
>(
  rows: readonly T[],
  compare: (left: T, right: T) => number
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const current = latest.get(row.sceneExecutionId);
    if (!current || compare(current, row) < 0) {
      latest.set(row.sceneExecutionId, row);
    }
  }
  return latest;
}
