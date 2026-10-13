import { z } from "zod";

/**
 * Server-checked lineage for a future LOCAL_GPU_WORKER result.
 * This contract does not submit a Desktop job, register a worker, or admit
 * Native Dialogue or the Staging Product-only candidate.
 */
export const LOCAL_GPU_RESULT_AUTHORITY_DENIED_WORKFLOWS = [
  "MINIMAX_H3_NATIVE_DIALOGUE",
  "MINIMAX_H3_PRODUCT_ONLY_CANDIDATE_V1",
] as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const LocalGpuResultEnvironmentSchema = z.enum(["staging", "production"]);
export const LocalGpuResultAudioPolicySchema = z.enum(["NATIVE", "REMOVE_AUDIO", "PRESERVE"]);

export const LocalGpuGenerationInputAuthoritySchema = z.object({
  localGpuEnvironment: LocalGpuResultEnvironmentSchema,
  localGpuJobId: Id,
  localGpuWorkflow: z.string().trim().min(1),
  workspaceId: Id,
  storyId: Id,
  storyVersionId: Id,
  sceneExecutionId: Id,
  audioPolicy: LocalGpuResultAudioPolicySchema,
  plannedDurationMs: z.number().int().positive(),
  actualDurationMs: z.number().int().positive(),
  fps: z.number().positive(),
  hasAudio: z.boolean(),
  localPackageId: Id,
  localPackageFingerprint: Hash,
  characterAuthority: z.unknown(),
  productAuthority: z.unknown(),
  references: z.unknown(),
  generationMode: z.unknown(),
  generateAudio: z.boolean(),
  audioBlocked: z.boolean(),
  sourceAuthority: z.unknown(),
  planningAuthority: z.unknown(),
}).strict().superRefine((value, context) => {
  if ((LOCAL_GPU_RESULT_AUTHORITY_DENIED_WORKFLOWS as readonly string[]).includes(value.localGpuWorkflow)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "LOCAL_GPU_WORKFLOW_NOT_ENABLED" });
  }
});

export type LocalGpuGenerationInputAuthority = z.infer<typeof LocalGpuGenerationInputAuthoritySchema>;

export function localGpuResultStoragePath(workspaceId: string, contentHash: string): string {
  if (!contentHash.startsWith("sha256:") || !/^sha256:[0-9a-f]{64}$/.test(contentHash)) {
    throw new Error("LOCAL_GPU_RESULT_CONTENT_HASH_REQUIRED");
  }
  return `${workspaceId}/ai-story/local-gpu/${contentHash.slice("sha256:".length)}.mp4`;
}

export function localGpuServerEnvironment(value: string | undefined | null): "staging" | "production" | null {
  const configured = value?.trim();
  return configured === "staging" || configured === "production" ? configured : null;
}
