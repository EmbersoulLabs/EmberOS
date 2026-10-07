import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "./canonical-integrity";
import {
  AiStoryRecommendedDurationAuthoritySchema,
  resolveRecommendedDuration,
  type AiStoryRecommendedDurationAuthority,
  type RecommendedDurationResolveInput,
} from "./ai-story-recommended-duration";

const AUTHORITY_ID_KIND = "ai-story-recommended-duration-authority";

/** Fingerprint and deterministic id for one Recommended Duration decision. */
export function buildAiStoryRecommendedDurationAuthority(
  input: RecommendedDurationResolveInput
): AiStoryRecommendedDurationAuthority {
  const semantic = resolveRecommendedDuration(input);
  const semanticFingerprint = sha256CanonicalIntegrityHash(semantic);
  const authorityId = deterministicUuidFromFingerprint(
    AUTHORITY_ID_KIND,
    semanticFingerprint
  );
  return AiStoryRecommendedDurationAuthoritySchema.parse({
    ...semantic,
    authorityId,
    semanticFingerprint,
  });
}
