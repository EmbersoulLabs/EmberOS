export const BGM_START_PREFERENCES = ["auto", "start", "middle"] as const;
export type BgmStartPreference = (typeof BGM_START_PREFERENCES)[number];
export const DEFAULT_BGM_START_PREFERENCE: BgmStartPreference = "auto";

export function isBgmStartPreference(value: unknown): value is BgmStartPreference {
  return typeof value === "string" && (BGM_START_PREFERENCES as readonly string[]).includes(value);
}

/** Pick where to start reading the BGM bed (skip dull intros on long tracks). */
export function resolveBgmStartOffsetSec(
  trackDurationSec: number,
  clipDurationSec: number,
  preference: BgmStartPreference = "auto"
): number {
  if (preference === "start" || trackDurationSec <= 0) return 0;

  const tailNeeded = Math.max(8, clipDurationSec + 3);
  const maxStart = Math.max(0, trackDurationSec - tailNeeded);

  if (preference === "middle") {
    return Math.min(maxStart, trackDurationSec * 0.35);
  }

  // auto — skip ~12s or 15% on long beds; short tracks start at 0
  if (trackDurationSec > 75) {
    return Math.min(maxStart, Math.max(8, trackDurationSec * 0.15));
  }
  return 0;
}
