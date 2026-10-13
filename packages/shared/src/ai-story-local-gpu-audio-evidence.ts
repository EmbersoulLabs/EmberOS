import { z } from "zod";

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/** Speech is never machine-approved. Silence is explicit, not an omitted finding. */
export const LOCAL_GPU_AUDIO_SPEECH_CONTENT = ["HUMAN_REVIEW_REQUIRED", "NOT_APPLICABLE"] as const;

export const LocalGpuAudioEvidenceSchema = z.object({
  audioEvidenceId: Id,
  orgId: Id,
  workspaceId: Id,
  executionPlanId: Id,
  sceneExecutionId: Id,
  generationResultId: Id,
  assetId: Id,
  contentHash: Hash,
  hasAudio: z.boolean(),
  speechContent: z.enum(LOCAL_GPU_AUDIO_SPEECH_CONTENT),
  evidenceFingerprint: Hash,
}).strict().superRefine((value, context) => {
  const expected = value.hasAudio ? "HUMAN_REVIEW_REQUIRED" : "NOT_APPLICABLE";
  if (value.speechContent !== expected) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "LOCAL_GPU_AUDIO_SPEECH_CONTENT_INVALID" });
  }
});

export type LocalGpuAudioEvidence = z.infer<typeof LocalGpuAudioEvidenceSchema>;
