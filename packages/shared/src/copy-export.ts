import { getPlatformSpec } from "./platform-specs/index";
import type { CopyVariant, Platform } from "./types/index";

export type CopyExportFormat = "txt" | "doc";

export function parseCopyExportFormat(value: unknown): CopyExportFormat | null {
  if (value === "txt" || value === "text") return "txt";
  if (value === "doc" || value === "docx" || value === "word") return "doc";
  return null;
}

function localeLabel(locale?: string): string {
  if (locale === "zh") return "中文";
  if (locale === "en") return "EN";
  return "";
}

function formatTags(tags: string[]): string {
  if (!tags.length) return "";
  return tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
}

function formatVariantLines(variant: CopyVariant): string[] {
  const platform = getPlatformSpec(variant.platform as Platform);
  const loc = variant.locale ? ` (${localeLabel(variant.locale)})` : "";
  const header = `=== ${platform.name}${loc} ===`;
  const lines = [header, ""];

  if (variant.platform === "xiaohongshu") {
    lines.push(`标题 / Title: ${variant.title}`, "", variant.body, "");
    if (variant.tags.length) lines.push(`标签 / Tags: ${formatTags(variant.tags)}`);
  } else {
    if (variant.title) lines.push(`Title: ${variant.title}`, "");
    lines.push("Hook / 开篇:", variant.hook, "", "Body / 正文:", variant.body, "", "CTA / 行动号召:", variant.cta);
    if (variant.tags.length) lines.push("", `Tags / 标签: ${formatTags(variant.tags)}`);
  }

  return lines;
}

export function buildCreativeCopyText(input: {
  variants: CopyVariant[];
  clipLabel?: string;
  campaignName?: string;
  variantId?: string;
}): string {
  const variants = input.variantId
    ? input.variants.filter((v) => v.id === input.variantId)
    : input.variants;

  if (variants.length === 0) return "";

  const parts: string[] = [];
  if (input.campaignName) parts.push(input.campaignName, "");
  if (input.clipLabel) parts.push(`【${input.clipLabel}】`, "");

  for (const variant of variants) {
    parts.push(...formatVariantLines(variant), "");
  }

  return `${parts.join("\n").trim()}\n`;
}

export function buildTaskCopyText(input: {
  clips: Array<{ label: string; variants: CopyVariant[] }>;
  campaignName?: string;
}): string {
  const parts: string[] = [];
  if (input.campaignName) {
    parts.push(input.campaignName, "", "=".repeat(40), "");
  }

  for (const clip of input.clips) {
    if (clip.variants.length === 0) continue;
    parts.push(`【${clip.label}】`, "");
    for (const variant of clip.variants) {
      parts.push(...formatVariantLines(variant), "");
    }
    parts.push("─".repeat(40), "");
  }

  return `${parts.join("\n").trim()}\n`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToDocHtml(text: string, title: string): string {
  const body = escapeHtml(text)
    .replace(/\n/g, "<br/>\n")
    .replace(/={3,}/g, (m) => `<strong>${m}</strong>`);

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
body { font-family: "Microsoft YaHei", "PingFang SC", Calibri, sans-serif; font-size: 12pt; line-height: 1.5; }
h1 { font-size: 14pt; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function buildCreativeCopyDoc(input: {
  variants: CopyVariant[];
  clipLabel?: string;
  campaignName?: string;
  variantId?: string;
}): string {
  const text = buildCreativeCopyText(input);
  const title = input.clipLabel ?? input.campaignName ?? "Copy";
  return textToDocHtml(text, title);
}

export function buildTaskCopyDoc(input: {
  clips: Array<{ label: string; variants: CopyVariant[] }>;
  campaignName?: string;
}): string {
  const text = buildTaskCopyText(input);
  const title = input.campaignName ?? "All Clips Copy";
  return textToDocHtml(text, title);
}

export function copyExportFilename(base: string, format: CopyExportFormat): string {
  const safe = base.replace(/[^\w\u4e00-\u9fff.-]+/g, "_").replace(/_+/g, "_");
  return `${safe}.${format === "doc" ? "doc" : "txt"}`;
}

export function copyExportContentType(format: CopyExportFormat): string {
  return format === "doc" ? "application/msword" : "text/plain; charset=utf-8";
}

/** UTF-8 BOM helps Notepad on Windows display Chinese correctly. */
export function encodeCopyExportBody(content: string, format: CopyExportFormat): Uint8Array {
  const payload = format === "txt" ? `\uFEFF${content}` : content;
  return new TextEncoder().encode(payload);
}
