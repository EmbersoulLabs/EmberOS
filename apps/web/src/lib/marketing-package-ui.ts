import type { MarketingPackageCardId } from "@ceo-agent/shared";

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text.trim()) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function exportTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function marketingPackageExportFilename(
  campaignName: string,
  cardId: MarketingPackageCardId
): string {
  const safe = campaignName.replace(/[^\w\u4e00-\u9fff-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safe || "campaign"}-${cardId}.txt`;
}
