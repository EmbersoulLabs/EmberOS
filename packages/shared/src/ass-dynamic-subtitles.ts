/** EmberOS brand ASS subtitle styling — white body, golden keywords, per-char pop. */

/** #FFB800 in ASS BGR (&HAABBGGRR). */
export const ASS_COLOR_GOLD = "&H0000B8FF";
export const ASS_COLOR_WHITE = "&H00FFFFFF";
export const ASS_COLOR_BLACK = "&H00000000";

export const ASS_CHAR_STAGGER_MS = 100;
export const ASS_CHAR_POP_MS = 80;
export const ASS_OUTLINE_PX = 2;

export type HighlightRange = { start: number; end: number };

const PRICE_PATTERNS: RegExp[] = [
  /[$¥￥€£₩]\s?\d+(?:[.,]\d{1,2})?/g,
  /(?:USD|S\$|SGD|RM|NT\$|HK\$)\s?\d+(?:[.,]\d{1,2})?/gi,
  /\d+(?:[.,]\d{1,2})?\s?(?:元|块|美元|美金|港币|新币)/g,
  /\d+(?:[.,]\d{1,2})?\s?(?:USD|usd)/g,
];

const NUMBER_PATTERN = /\d+(?:[.,]\d+)?%?/g;

function mergeHighlightRanges(ranges: HighlightRange[]): HighlightRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: HighlightRange[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

function addRange(ranges: HighlightRange[], start: number, end: number) {
  if (end > start) ranges.push({ start, end });
}

function findProductNameRanges(text: string, productNames: string[]): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  const names = [...new Set(productNames.map((n) => n.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );

  for (const name of names) {
    if (name.length < 2) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const latin = /[a-zA-Z0-9]/.test(name);
    const re = new RegExp(escaped, latin ? "gi" : "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      addRange(ranges, match.index, match.index + match[0].length);
    }
  }
  return ranges;
}

/** Detect number, price, and product-name spans without altering source text. */
export function findSubtitleHighlightRanges(text: string, productNames: string[] = []): HighlightRange[] {
  const ranges: HighlightRange[] = [...findProductNameRanges(text, productNames)];

  for (const pattern of PRICE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      addRange(ranges, match.index, match.index + match[0].length);
    }
  }

  NUMBER_PATTERN.lastIndex = 0;
  let numMatch: RegExpExecArray | null;
  while ((numMatch = NUMBER_PATTERN.exec(text)) !== null) {
    addRange(ranges, numMatch.index, numMatch.index + numMatch[0].length);
  }

  return mergeHighlightRanges(ranges);
}

export function isIndexHighlighted(index: number, ranges: HighlightRange[]): boolean {
  return ranges.some((r) => index >= r.start && index < r.end);
}

function escapeAssTextChar(char: string): string {
  if (char === "\n") return "\\N";
  if (char === "{") return "\\{";
  if (char === "}") return "\\}";
  return char;
}

/** One character: brand colors + pop-in (scale 130% → 100%, stagger 0.1s). */
export function assCharPopTag(charIndex: number, highlighted: boolean): string {
  const delay = charIndex * ASS_CHAR_STAGGER_MS;
  const end1 = delay + ASS_CHAR_POP_MS;
  const end2 = end1 + ASS_CHAR_POP_MS;
  const color = highlighted ? ASS_COLOR_GOLD : ASS_COLOR_WHITE;
  return (
    `{\\c${color}\\3c${ASS_COLOR_BLACK}\\bord${ASS_OUTLINE_PX}` +
    `\\t(${delay},${end1},\\fscx130\\fscy130)` +
    `\\t(${end1},${end2},\\fscx100\\fscy100)}`
  );
}

/** Build ASS dialogue text with per-char pop; preserves line breaks (\\N) for 中英. */
export function buildAssAnimatedDialogueText(text: string, productNames: string[] = []): string {
  const lines = text.split("\n");
  const animatedLines = lines.map((line) => {
    if (!line) return "";
    const ranges = findSubtitleHighlightRanges(line, productNames);
    const chars = [...line];
    let out = "";
    let charIndex = 0;
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i]!;
      if (char === " ") {
        out += " ";
        charIndex += 1;
        continue;
      }
      const highlighted = isIndexHighlighted(i, ranges);
      out += assCharPopTag(charIndex, highlighted) + escapeAssTextChar(char);
      charIndex += 1;
    }
    return out;
  });
  return animatedLines.join("\\N");
}
