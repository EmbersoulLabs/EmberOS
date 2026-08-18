/**
 * Production-pin campaign/asset field mapping for AI Story planning.
 * Source AI Story code expected Sprint 4 campaign columns that are not on b447f53.
 */
export function campaignPlanningFields(campaign: {
  name: string;
  goal?: string | null;
  campaignBrief?: string | null;
  platforms?: string[] | null;
  objectives?: string[] | null;
  metadata?: Record<string, unknown> | null;
}) {
  const meta = campaign.metadata ?? {};
  const objectiveFromMeta = typeof meta.objective === "string" ? meta.objective : null;
  const objectiveCustom =
    typeof meta.objectiveCustom === "string" ? meta.objectiveCustom : null;
  const targetAudienceOverride =
    typeof meta.targetAudienceOverride === "string" ? meta.targetAudienceOverride : null;
  return {
    name: campaign.name,
    objective: objectiveFromMeta ?? campaign.goal ?? campaign.objectives?.[0] ?? null,
    objectiveCustom,
    targetAudienceOverride,
    campaignBrief: campaign.campaignBrief ?? null,
    goal: campaign.goal ?? null,
    platforms: campaign.platforms ?? [],
  };
}

export function assetLabelFromProductionRow(row: {
  id: string;
  storagePath?: string | null;
  metadata?: Record<string, unknown> | null;
}): string {
  const meta = row.metadata ?? {};
  const displayName = typeof meta.displayName === "string" ? meta.displayName.trim() : "";
  const originalFilename =
    typeof meta.originalFilename === "string" ? meta.originalFilename.trim() : "";
  return (
    displayName ||
    originalFilename ||
    row.storagePath?.split("/").pop() ||
    `asset:${row.id.slice(0, 8)}`
  );
}
