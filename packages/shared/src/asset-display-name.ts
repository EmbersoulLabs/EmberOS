/**
 * PD-040 — human-readable Asset display names.
 * Original filename must remain separately for traceability.
 */

/** Strip extension, replace separators, collapse whitespace. */
export function cleanOriginalFilename(filename: string): string {
  const base = filename.trim().replace(/^.*[\\/]/, "");
  const withoutExt = base.replace(/\.[^.]+$/, "");
  const cleaned = withoutExt
    .replace(/[_]+/g, " ")
    .replace(/[-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return base || "Untitled asset";
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

export type AssetDisplayNameSource = "ai" | "fallback" | "manual" | "original";

export function resolveAssetDisplayLabel(input: {
  displayName?: string | null;
  originalFilename?: string | null;
  id?: string;
}): string {
  const display = input.displayName?.trim();
  if (display) return display;
  const original = input.originalFilename?.trim();
  if (original) return cleanOriginalFilename(original);
  return input.id?.slice(0, 8) || "Asset";
}
