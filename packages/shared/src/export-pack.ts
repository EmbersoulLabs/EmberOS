import type { TaskExportResolution } from "./billing";

/** User-facing label: preview = 720p, 1080p, 2k */
export function exportResolutionLabel(resolution: TaskExportResolution): "preview" | "1080p" | "2k" {
  if (resolution === "720p") return "preview";
  if (resolution === "2k") return "2k";
  return "1080p";
}

export function slugifyExportBasename(name: string): string {
  const slug = name
    .trim()
    .replace(/[^\w\u4e00-\u9fff.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return (slug || "campaign").slice(0, 80);
}

export function buildExportPackFilename(
  campaignName: string,
  resolution: TaskExportResolution
): string {
  return `${slugifyExportBasename(campaignName)}_${exportResolutionLabel(resolution)}.zip`;
}

export type ExportPackStepOutput = {
  exportPackUrl: string;
  resolution: TaskExportResolution;
  clipCount: number;
  filename: string;
  completedAt: string;
};

export function platformPublishCopyText(
  platform: string,
  p: { title?: string; body?: string; caption?: string; hashtags?: string[]; tags?: string[] }
): string {
  if (platform === "xiaohongshu") {
    const tags = (p.tags ?? []).map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
    return [p.title, "", p.body, tags].filter(Boolean).join("\n").trim();
  }
  const tags = (p.hashtags ?? []).map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  return [p.caption, tags].filter(Boolean).join("\n\n").trim();
}
