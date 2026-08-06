import type { APIRequestContext } from "@playwright/test";

export const INTERRUPTED_E2E_CAMPAIGN_PREFIXES = ["E2E Video ", "E2E Marketing "] as const;

type CampaignSummary = { id: string; name: string; status: string };

export function isInterruptedE2ECampaign(campaign: CampaignSummary): boolean {
  return (
    INTERRUPTED_E2E_CAMPAIGN_PREFIXES.some((prefix) => campaign.name.startsWith(prefix)) &&
    ["draft", "processing", "failed"].includes(campaign.status)
  );
}

/** Uses authenticated application APIs; never deletes non-E2E or completed records. */
export async function cleanupInterruptedE2ECampaigns(
  request: APIRequestContext,
  workspaceId: string
): Promise<{ deleted: string[] }> {
  const response = await request.get(`/api/campaigns?workspaceId=${workspaceId}`);
  if (!response.ok()) {
    throw new Error(`E2E cleanup list failed (${response.status()}): ${await response.text()}`);
  }
  const body = (await response.json()) as { campaigns?: CampaignSummary[] };
  const targets = (body.campaigns ?? []).filter(isInterruptedE2ECampaign);
  const deleted: string[] = [];
  for (const campaign of targets) {
    const result = await request.delete(`/api/campaigns/${campaign.id}`);
    if (!result.ok() && result.status() !== 404) {
      throw new Error(
        `E2E cleanup failed for ${campaign.id} (${result.status()}): ${await result.text()}`
      );
    }
    deleted.push(campaign.id);
  }
  return { deleted };
}
