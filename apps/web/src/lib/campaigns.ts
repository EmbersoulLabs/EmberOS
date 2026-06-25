const PROTECTED_CAMPAIGN_STATUSES = new Set(["exported", "approved"]);

export function isCampaignDeletable(
  campaignStatus: string,
  taskStatus?: string | null,
  stepProgress?: Record<string, { status?: string }> | null
): boolean {
  if (PROTECTED_CAMPAIGN_STATUSES.has(campaignStatus)) return false;
  if (campaignStatus === "draft" || campaignStatus === "failed") return true;
  if (campaignStatus === "export_ready") return true;
  if (taskStatus === "failed") return true;
  if (campaignStatus === "processing" || campaignStatus === "pending_internal_review") {
    return true;
  }
  if (stepProgress) {
    const stepFailed = Object.values(stepProgress).some((s) => s?.status === "failed");
    if (stepFailed) return true;
  }
  return false;
}
