import {
  AI_STORY_KEYFRAME_PAID_AUTHORIZATION_CONTRACT_VERSION,
  AiStoryKeyframePaidAuthorizationFactSchema,
  type AiStoryKeyframePaidAuthorizationCore,
  type AiStoryKeyframePaidAuthorizationFact,
} from "./ai-story-keyframe-paid-authorization";
import { sha256CanonicalIntegrityHash } from "./canonical-integrity";

export function keyframePaidAuthorizationIntegrityHash(fact: AiStoryKeyframePaidAuthorizationCore): string {
  return sha256CanonicalIntegrityHash({
    kind: AI_STORY_KEYFRAME_PAID_AUTHORIZATION_CONTRACT_VERSION,
    authority: fact,
  });
}

export function isKeyframePaidAuthorizationIntegrityValid(value: unknown): value is AiStoryKeyframePaidAuthorizationFact {
  const parsed = AiStoryKeyframePaidAuthorizationFactSchema.safeParse(value);
  if (!parsed.success) return false;
  const { deterministicIntegrityHash, ...core } = parsed.data;
  return deterministicIntegrityHash === keyframePaidAuthorizationIntegrityHash(core);
}
