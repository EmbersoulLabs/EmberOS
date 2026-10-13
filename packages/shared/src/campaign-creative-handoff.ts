import { z } from "zod";
import { CampaignCreativeModuleSchema, CampaignMarketingPlanAssetModeSchema } from "./campaign-marketing-plan";

export const CAMPAIGN_CREATIVE_HANDOFF_CONTRACT_VERSION = "campaign-creative-handoff.v1" as const;

export const CampaignCreativeHandoffSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  iterationId: z.string().uuid(),
  approvedPlanId: z.string().uuid(),
  selectedModule: CampaignCreativeModuleSchema,
  assetMode: CampaignMarketingPlanAssetModeSchema,
  assetIds: z.array(z.string().uuid()),
  businessProfileSnapshotRef: z.string().min(1),
  destinationReference: z.string().min(1),
});

export function campaignCreativeDestinationReference(module: z.infer<typeof CampaignCreativeModuleSchema>, campaignId: string) {
  if (module === "AI_STORY") return `campaign:${campaignId}:ai-story:new`;
  if (module === "PHOTO_SCENE") return `campaign:${campaignId}:photo-scene`;
  return `campaign:${campaignId}:video-studio`;
}

export function campaignCreativeDestinationPath(module: z.infer<typeof CampaignCreativeModuleSchema>, slug: string, campaignId: string) {
  if (module === "AI_STORY") return `/w/${slug}/campaigns/${campaignId}/ai-stories/episodes/new`;
  if (module === "PHOTO_SCENE") return `/w/${slug}/campaigns/${campaignId}#photo-scene`;
  return `/w/${slug}/campaigns/${campaignId}#module-video-studio`;
}
