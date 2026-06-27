import type { CopyLocale } from "./copy-mix";

const CJK_RE = /[\u4e00-\u9fff]/;

export function isChineseText(text: string): boolean {
  return CJK_RE.test(text);
}

/**
 * True when text is PREDOMINANTLY Chinese \u2014 i.e. more than 30% of non-whitespace
 * characters are CJK. Unlike isChineseText, a Chinese brand/product name embedded
 * in an otherwise-English sentence does NOT count as Chinese text.
 */
export function isMostlyChineseText(text: string): boolean {
  const stripped = text.replace(/\s+/g, "");
  if (!stripped) return false;
  const cjk = (stripped.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjk / stripped.length > 0.30;
}

export function detectCopyLocale(text: string): CopyLocale {
  return isChineseText(text) ? "zh" : "en";
}

/** Short on-screen line — keeps subtitles readable on 9:16. */
export function clipSubtitleLine(text: string, locale: CopyLocale, maxChars?: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const limit = maxChars ?? (locale === "zh" ? 16 : 34);
  if (t.length <= limit) return t;

  if (locale === "zh") {
    const slice = t.slice(0, limit);
    const breakAt = Math.max(slice.lastIndexOf("，"), slice.lastIndexOf("、"));
    return (breakAt > 6 ? slice.slice(0, breakAt) : slice).trim();
  }

  const slice = t.slice(0, limit);
  const breakAt = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf(","));
  return (breakAt > 10 ? slice.slice(0, breakAt) : slice).trim();
}

export function firstPhrase(text: string, locale: CopyLocale): string {
  const parts = text
    .split(/[\n。！？!?；;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return clipSubtitleLine(parts[0] ?? text, locale);
}

export function secondPhrase(text: string, locale: CopyLocale): string {
  const parts = text
    .split(/[\n。！？!?；;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return clipSubtitleLine(parts[1] ?? parts[0] ?? text, locale);
}
