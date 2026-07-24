import { z } from "zod";

/** PD-041 / PD-044 — Campaign Brief AI Writing Assistant actions only. */
export const CAMPAIGN_BRIEF_ASSIST_ACTIONS = ["polish", "expand", "shorten"] as const;
export type CampaignBriefAssistAction = (typeof CAMPAIGN_BRIEF_ASSIST_ACTIONS)[number];

export const CampaignBriefAssistBodySchema = z.object({
  action: z.enum(CAMPAIGN_BRIEF_ASSIST_ACTIONS),
  text: z.string().trim().min(1).max(10000),
  campaignName: z.string().trim().max(200).optional(),
  objective: z.string().trim().max(500).optional(),
  platforms: z.array(z.string().trim().min(1)).max(20).optional(),
  targetAudience: z.string().trim().max(2000).optional(),
  /** Optional client hint; server prefers campaign/workspace language. */
  workspaceLanguage: z.string().trim().max(32).optional(),
});

export type CampaignBriefAssistBody = z.infer<typeof CampaignBriefAssistBodySchema>;
