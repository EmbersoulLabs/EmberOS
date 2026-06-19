import type { FinishedAdRisk } from "@ceo-agent/shared";

export interface AssetRiskMeta {
  finishedAdRisk?: {
    risk: FinishedAdRisk;
    reasons?: string[];
  };
}

export function isRiskyUpload(asset: AssetRiskMeta): boolean {
  const risk = asset.finishedAdRisk?.risk;
  return risk === "medium" || risk === "high";
}

export function maxUploadRisk(assets: AssetRiskMeta[]): FinishedAdRisk {
  let max: FinishedAdRisk = "low";
  for (const a of assets) {
    const r = a.finishedAdRisk?.risk ?? "low";
    if (r === "high") return "high";
    if (r === "medium") max = "medium";
  }
  return max;
}
