import { z } from "zod";
import { RuntimeOwnershipIdentitySchema } from "./ai-story-runtime-contracts";
import { assertWorkspaceScopedDurableObjectKey } from "./ai-story-durable-scene-media";

export const AI_STORY_GENERATION_RESULT_VERSION = "ai-story-generation-result.v1" as const;
const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Source = z.discriminatedUnion("sourceKind", [
  z.object({ sourceKind: z.literal("REMOTE_PROVIDER"), providerAttemptId: z.string().min(1), localGenerationOutputId: z.null(), localWorkerOutputId: z.null() }).strict(),
  z.object({ sourceKind: z.literal("MANUAL_LOCAL"), providerAttemptId: z.null(), localGenerationOutputId: Id, localWorkerOutputId: z.null() }).strict(),
  z.object({ sourceKind: z.literal("LOCAL_GPU_WORKER"), providerAttemptId: z.null(), localGenerationOutputId: z.null(), localWorkerOutputId: Id }).strict(),
]);

/** Immutable accepted media, before QC or Human approval. Production method is provenance only. */
export const AiStoryGenerationResultSchema = z.object({
  generationResultId: Id,
  contractVersion: z.literal(AI_STORY_GENERATION_RESULT_VERSION),
  ownership: RuntimeOwnershipIdentitySchema,
  runtimeAuthorizationId: Id,
  generationUnitId: Id,
  sceneExecutionId: Id,
  sceneId: z.string().min(1),
  sceneOrder: z.number().int().nonnegative(),
  source: Source,
  compiledRequestId: Id,
  compiledRequestFingerprint: Hash,
  inputAuthorityFingerprint: Hash,
  media: z.object({
    assetId: Id,
    contentHash: Hash,
    durableObjectReference: z.string().min(1),
    storagePath: z.string().min(1),
    byteSize: z.number().int().positive(),
    mediaType: z.literal("video/mp4"),
    durationMs: z.number().int().positive(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    readable: z.literal(true),
    decodable: z.literal(true),
  }).strict(),
  /** Exact frozen input lineage, including Character/DNA, Product variant and references. */
  inputAuthority: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  fingerprint: Hash,
}).strict().superRefine((value, ctx) => {
  try {
    assertWorkspaceScopedDurableObjectKey(value.ownership.workspaceId, value.media.storagePath);
    assertWorkspaceScopedDurableObjectKey(value.ownership.workspaceId, value.media.durableObjectReference);
    if (value.media.storagePath !== value.media.durableObjectReference || /[?#]/.test(value.media.storagePath)) throw new Error("Invalid durable reference");
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "GENERATION_RESULT_PRIVATE_MEDIA_REQUIRED" });
  }
});

export type AiStoryGenerationResult = z.infer<typeof AiStoryGenerationResultSchema>;

export const AiStoryGenerationResultDecisionSchema = z.object({
  decisionId: Id,
  generationResultId: Id,
  postQcEvaluationId: Id,
  decision: z.enum(["APPROVED", "LOCAL_REGENERATION_REQUIRED", "REJECTED"]),
  actorUserId: Id,
  rationale: z.string().trim().min(1).max(3000),
  decidedAt: z.string().datetime(),
}).strict();
export type AiStoryGenerationResultDecision = z.infer<typeof AiStoryGenerationResultDecisionSchema>;
