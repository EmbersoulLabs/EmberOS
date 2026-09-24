import { sha256CanonicalIntegrityHash } from "./canonical-integrity";
import {
  AiStoryV2vContractError,
  AiStoryV2vExecutionAuthoritySchema,
  type AiStoryV2vExecutionAuthority,
} from "./ai-story-v2v-execution";

export function freezeAiStoryV2vExecutionAuthority(
  input: Omit<AiStoryV2vExecutionAuthority, "fingerprint">,
): AiStoryV2vExecutionAuthority {
  const fingerprint = sha256CanonicalIntegrityHash(input);
  return AiStoryV2vExecutionAuthoritySchema.parse({ ...input, fingerprint });
}

export function assertAiStoryV2vExecutionAuthorityImmutable(
  authorized: AiStoryV2vExecutionAuthority,
  candidate: AiStoryV2vExecutionAuthority,
): void {
  if (authorized.commercialAuthorizationId !== candidate.commercialAuthorizationId) {
    throw new AiStoryV2vContractError(
      "V2V_AUTHORIZATION_IDENTITY_CHANGED",
      "Commercial authorization identity is part of the frozen V2V fact",
    );
  }
  if (authorized.fingerprint !== candidate.fingerprint) {
    throw new AiStoryV2vContractError(
      "V2V_SOURCE_IMMUTABLE_AFTER_AUTHORIZATION",
      "The V2V source fact is immutable after commercial authorization",
    );
  }
}
