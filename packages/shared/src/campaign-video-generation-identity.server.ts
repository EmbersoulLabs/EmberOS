import type { CampaignVideoGenerationIdentityV1 } from "./campaign-video-generation-identity";
import { normalizeCampaignVideoGenerationIdentityV1 } from "./campaign-video-generation-identity";
import { sha256CanonicalIntegrityHash } from "./canonical-integrity";

export function fingerprintCampaignVideoGenerationIdentityV1(input: CampaignVideoGenerationIdentityV1): string {
  return sha256CanonicalIntegrityHash(normalizeCampaignVideoGenerationIdentityV1(input));
}
