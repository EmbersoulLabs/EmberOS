export function formatClipDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem}s`;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

export function formatPlatformLabel(platform: string | undefined): string {
  if (!platform) return "—";
  if (platform === "xiaohongshu") return "小红书";
  if (platform === "instagram") return "Instagram";
  if (platform === "tiktok") return "TikTok";
  if (platform === "douyin") return "抖音";
  return platform;
}

/** Same storage path is overwritten on re-render — bust browser cache. */
export function videoUrlWithCacheBust(
  url: string | undefined,
  updatedAt?: string | Date | null
): string | undefined {
  if (!url) return undefined;
  if (!updatedAt) return url;
  const ms = typeof updatedAt === "string" ? Date.parse(updatedAt) : updatedAt.getTime();
  if (!Number.isFinite(ms)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${ms}`;
}

export function extractClipMeta(creative: Record<string, unknown> | undefined) {
  if (!creative) {
    return {
      durationSec: undefined as number | undefined,
      hookType: undefined as string | undefined,
      platform: undefined as string | undefined,
      score: undefined as number | undefined,
      clipTitle: undefined as string | undefined,
    };
  }

  const editPlan = creative.editPlan as Record<string, unknown> | undefined;
  const clips = editPlan?.clips as Array<{ role?: string }> | undefined;
  const clipMeta = editPlan?.clipMeta as { title?: string; hookType?: string; platform?: string } | undefined;
  const copyVariants = creative.copyVariants as Array<{ platform?: string }> | undefined;

  const durationSec =
    (editPlan?.targetDurationSec as number | undefined) ??
    (() => {
      const clipRows = editPlan?.clips as
        | Array<{ outputDurationSec?: number; endSec?: number; startSec?: number }>
        | undefined;
      const first = clipRows?.[0];
      if (first?.outputDurationSec) return first.outputDurationSec;
      if (first?.endSec != null && first?.startSec != null) return first.endSec - first.startSec;
      return undefined;
    })();

  const hookType = clipMeta?.hookType ?? clips?.[0]?.role;
  const clipTitle = clipMeta?.title;

  const adaptations = creative.platformAdaptations as Record<string, unknown> | undefined;
  const platform =
    clipMeta?.platform ??
    copyVariants?.find((v) => v.platform)?.platform ??
    (adaptations ? Object.keys(adaptations)[0] : undefined);

  const scoreJson = creative.marketingScoreJson as Record<string, unknown> | undefined;
  const score = scoreJson?.overallScore as number | undefined;

  return { durationSec, hookType, platform, score, clipTitle };
}
