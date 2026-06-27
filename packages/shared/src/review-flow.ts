import type { CampaignStatus } from "./types";

/** Campaign statuses that allow export / final render download. */
export const EXPORTABLE_CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  "approved",
  "export_ready",
] as const;

export function isCampaignExportable(status: string): boolean {
  return (EXPORTABLE_CAMPAIGN_STATUSES as readonly string[]).includes(status);
}

/** Workspace settings: skip client portal and approve after internal review only. */
export function skipClientReview(settings: Record<string, unknown> | null | undefined): boolean {
  if (settings?.skipClientReview === true) return true;
  return settings?.reviewMode === "internal_only";
}

export function isReviewPending(campaignStatus: string): boolean {
  return (
    campaignStatus === "pending_internal_review" || campaignStatus === "pending_client_review"
  );
}

export const EXPORTABLE_CREATIVE_STATUSES = ["approved", "export_ready"] as const;

export function isCreativeExportable(status: string): boolean {
  return (EXPORTABLE_CREATIVE_STATUSES as readonly string[]).includes(status);
}
