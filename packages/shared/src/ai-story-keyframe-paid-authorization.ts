import { z } from "zod";

export const AI_STORY_KEYFRAME_PAID_AUTHORIZATION_CONTRACT_VERSION =
  "ai-story-keyframe-paid-authorization.v1" as const;
export const AI_STORY_KEYFRAME_PAID_AUTHORIZATION_REASON =
  "EXPLICIT_PAID_KEYFRAME_GENERATION_CONFIRMATION" as const;

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const AiStoryKeyframePaidAuthorizationFactSchema = z.object({
  authorizationId: z.string().uuid(),
  contractVersion: z.literal(AI_STORY_KEYFRAME_PAID_AUTHORIZATION_CONTRACT_VERSION),
  orgId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  storyId: z.string().uuid(),
  sceneId: z.string().uuid(),
  sceneVersionId: z.string().uuid(),
  preparationAuthorityId: z.string().trim().min(1),
  preparationFingerprint: hash,
  keyframeBriefFingerprint: hash,
  authorizedProviderId: z.string().trim().min(1),
  authorizedModelId: z.string().trim().min(1),
  maximumImageProviderCalls: z.literal(1),
  authorizedBy: z.string().uuid(),
  authorizedAt: z.string().datetime(),
  authorizationReason: z.literal(AI_STORY_KEYFRAME_PAID_AUTHORIZATION_REASON),
  deterministicIntegrityHash: hash,
}).strict();

export type AiStoryKeyframePaidAuthorizationFact = z.infer<
  typeof AiStoryKeyframePaidAuthorizationFactSchema
>;

export type AiStoryKeyframePaidAuthorizationCore = Omit<
  AiStoryKeyframePaidAuthorizationFact,
  "deterministicIntegrityHash"
>;
