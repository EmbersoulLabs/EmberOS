import { z } from "zod";

export const CAMPAIGN_SOCIAL_CONTENT_CONTRACT_VERSION = "campaign-social-content.v1" as const;
export const CampaignSocialPlatformSchema = z.enum(["YOUTUBE", "TIKTOK"]);
export const CampaignSocialDisclosureSchema = z.object({
  containsAiGeneratedContent: z.boolean(),
  label: z.string().trim().min(1).max(300),
});
export const YouTubeSocialContentSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(5000),
  hashtags: z.array(z.string().trim().regex(/^#[\p{L}\p{N}_]+$/u)).max(15),
});
export const TikTokSocialContentSchema = z.object({
  caption: z.string().trim().min(1).max(2200),
  hashtags: z.array(z.string().trim().regex(/^#[\p{L}\p{N}_]+$/u)).max(20),
});
export const CampaignSocialContentSchema = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("YOUTUBE"), content: YouTubeSocialContentSchema, disclosure: CampaignSocialDisclosureSchema }),
  z.object({ platform: z.literal("TIKTOK"), content: TikTokSocialContentSchema, disclosure: CampaignSocialDisclosureSchema }),
]);

export type CampaignSocialPlatform = z.infer<typeof CampaignSocialPlatformSchema>;
export type CampaignSocialContent = z.infer<typeof CampaignSocialContentSchema>;
