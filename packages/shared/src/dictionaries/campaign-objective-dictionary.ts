/** SPEC-002 Campaign Objective predefined values (dropdown + custom). */

export const CAMPAIGN_OBJECTIVE_CUSTOM_ID = "custom" as const;

export const CAMPAIGN_OBJECTIVE_ENTRIES = [
  { id: "brand_awareness", labelKey: "campaign.objective.brandAwareness" },
  { id: "more_views", labelKey: "campaign.objective.moreViews" },
  { id: "more_engagement", labelKey: "campaign.objective.moreEngagement" },
  { id: "more_leads", labelKey: "campaign.objective.moreLeads" },
  { id: "more_sales", labelKey: "campaign.objective.moreSales" },
  { id: "product_launch", labelKey: "campaign.objective.productLaunch" },
  { id: "event_promotion", labelKey: "campaign.objective.eventPromotion" },
  { id: CAMPAIGN_OBJECTIVE_CUSTOM_ID, labelKey: "campaign.objective.custom" },
] as const;

export type CampaignObjectiveId = (typeof CAMPAIGN_OBJECTIVE_ENTRIES)[number]["id"];

export function isCampaignObjectiveId(value: unknown): value is CampaignObjectiveId {
  return (
    typeof value === "string" &&
    CAMPAIGN_OBJECTIVE_ENTRIES.some((e) => e.id === value)
  );
}

export function resolveCampaignObjectiveDisplay(
  objectiveId: string | null | undefined,
  customValue: string | null | undefined
): string {
  if (objectiveId === CAMPAIGN_OBJECTIVE_CUSTOM_ID) {
    return customValue?.trim() || "";
  }
  const entry = CAMPAIGN_OBJECTIVE_ENTRIES.find((e) => e.id === objectiveId);
  return entry?.id ?? objectiveId ?? "";
}
