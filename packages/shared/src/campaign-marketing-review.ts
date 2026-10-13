import { z } from "zod";

export const CAMPAIGN_MARKETING_REVIEW_CONTRACT_VERSION = "campaign-marketing-review.v1" as const;
export const CampaignMarketingReviewStatusSchema = z.enum(["PENDING_REVIEW", "APPROVED", "CHANGES_REQUESTED"]);
export const CampaignMarketingArtifactTypeSchema = z.enum(["VIDEO_CREATIVE", "PHOTO_SCENE_GENERATION", "AI_STORY_FINAL_RESULT"]);
export const CampaignMarketingReviewFindingStatusSchema = z.enum(["PASS", "FAIL", "NOT_EVALUATED"]);
export const CampaignMarketingReviewFindingSchema = z.object({
  status: CampaignMarketingReviewFindingStatusSchema,
  detail: z.string().min(1).max(500),
});
export const CampaignMarketingReviewFindingsSchema = z.object({
  provenance: CampaignMarketingReviewFindingSchema,
  planAlignment: CampaignMarketingReviewFindingSchema,
  businessGrounding: CampaignMarketingReviewFindingSchema,
  visualQuality: CampaignMarketingReviewFindingSchema,
  audioQuality: CampaignMarketingReviewFindingSchema,
});

export type CampaignMarketingReviewStatus = z.infer<typeof CampaignMarketingReviewStatusSchema>;
export type CampaignMarketingArtifactType = z.infer<typeof CampaignMarketingArtifactTypeSchema>;
export type CampaignMarketingReviewFindings = z.infer<typeof CampaignMarketingReviewFindingsSchema>;
