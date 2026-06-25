import type { ClipBgmKey } from "../creative-audio";
import { recommendBgm, type BgmRecommendContext } from "./recommend";

/** @deprecated use recommendBgm — thin wrapper for pipeline compatibility */
export function pickBgmForCampaign(input: BgmRecommendContext): ClipBgmKey {
  const rec = recommendBgm(input);
  return rec.trackId as ClipBgmKey;
}

export { recommendBgm };
