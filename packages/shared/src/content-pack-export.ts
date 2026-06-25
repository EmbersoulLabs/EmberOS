import type { CopyVariant } from "./types/index";
import type { MarketingContentPackage } from "./types/marketing-os";

export const CONTENT_PACK_PLATFORMS = [
  "tiktok",
  "instagram",
  "facebook",
  "linkedin",
  "xiaohongshu",
  "youtubeShorts",
  "googleBusiness",
] as const;

export type ContentPackPlatform = (typeof CONTENT_PACK_PLATFORMS)[number];

export interface TaskContentPack {
  taskId: string;
  campaignId: string;
  clipCount: number;
  hooks: MarketingContentPackage["hooks"];
  ctas: MarketingContentPackage["cta"];
  captions: MarketingContentPackage["captions"];
  voiceScripts: MarketingContentPackage["voiceScripts"];
  subtitleTimeline: MarketingContentPackage["subtitleTimeline"];
  clips: Array<{
    clip: number;
    platforms: Record<string, { hook: string; caption: string; cta: string; hashtags: string[] }>;
  }>;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildTaskContentPack(input: {
  taskId: string;
  campaignId: string;
  contentPackage?: MarketingContentPackage | null;
  creatives: Array<{ copyVariants?: CopyVariant[] | null }>;
}): TaskContentPack {
  const pkg = input.contentPackage;
  const clips = input.creatives.map((creative, i) => {
    const variants = (creative.copyVariants ?? []) as CopyVariant[];
    const primary = variants[0];
    const platforms: TaskContentPack["clips"][number]["platforms"] = {};

    for (const key of CONTENT_PACK_PLATFORMS) {
      const captionFromPkg = pkg?.captions[key]?.trim() ?? "";
      platforms[key] = {
        hook: primary?.hook ?? pkg?.hooks[i]?.text ?? pkg?.hooks[0]?.text ?? "",
        caption: captionFromPkg || primary?.body || "",
        cta: primary?.cta ?? pkg?.cta[i]?.text ?? pkg?.cta[0]?.text ?? "",
        hashtags: primary?.tags ?? [],
      };
    }

    return { clip: i + 1, platforms };
  });

  return {
    taskId: input.taskId,
    campaignId: input.campaignId,
    clipCount: input.creatives.length,
    hooks: pkg?.hooks ?? [],
    ctas: pkg?.cta ?? [],
    captions: pkg?.captions ?? {
      tiktok: "",
      instagram: "",
      facebook: "",
      linkedin: "",
      xiaohongshu: "",
      youtubeShorts: "",
      googleBusiness: "",
    },
    voiceScripts: pkg?.voiceScripts ?? { "15s": "", "30s": "", "60s": "" },
    subtitleTimeline: pkg?.subtitleTimeline ?? [],
    clips,
  };
}

export function contentPackToCsv(pack: TaskContentPack): string {
  const header = "clip,platform,hook,caption,cta,hashtags";
  const rows: string[] = [header];

  for (const clip of pack.clips) {
    for (const platform of CONTENT_PACK_PLATFORMS) {
      const p = clip.platforms[platform];
      if (!p) continue;
      rows.push(
        [
          String(clip.clip),
          platform,
          csvEscape(p.hook),
          csvEscape(p.caption),
          csvEscape(p.cta),
          csvEscape(p.hashtags.join(" ")),
        ].join(",")
      );
    }
  }

  return rows.join("\n");
}

export function contentPackToJson(pack: TaskContentPack): string {
  return JSON.stringify(pack, null, 2);
}
