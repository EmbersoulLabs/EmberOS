import { z } from "zod";

export const CAMPAIGN_MARKETING_PLAN_CONTRACT_VERSION = "campaign-marketing-plan.v1" as const;
export const CAMPAIGN_CREATIVE_MODULES = ["VIDEO_STUDIO", "PHOTO_SCENE", "AI_STORY"] as const;
export const CampaignCreativeModuleSchema = z.enum(CAMPAIGN_CREATIVE_MODULES);
export const CampaignMarketingPlanAssetModeSchema = z.enum(["ASSET_BASED", "ZERO_ASSET"]);

export const CampaignMarketingPlanContentSchema = z.object({
  objective: z.string().trim().min(1).max(1000),
  targetAudience: z.string().trim().min(1).max(2000),
  marketingApproach: z.string().trim().min(1).max(4000),
  creativeDirection: z.string().trim().min(1).max(4000),
  assetMode: CampaignMarketingPlanAssetModeSchema,
  assetIds: z.array(z.string().uuid()).max(100).default([]),
  missingAssets: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  recommendedModule: CampaignCreativeModuleSchema,
  rationale: z.string().trim().min(1).max(4000),
  expectedOutcome: z.string().trim().min(1).max(2000),
  businessFactRefs: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
}).superRefine((value, ctx) => {
  if (value.assetMode === "ZERO_ASSET" && value.assetIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assetIds"], message: "Zero-asset plans cannot bind assets" });
  }
  if (value.assetMode === "ASSET_BASED" && !value.assetIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assetIds"], message: "Asset-based plans require at least one authorized Campaign asset" });
  }
});

export type CampaignMarketingPlanContent = z.infer<typeof CampaignMarketingPlanContentSchema>;
