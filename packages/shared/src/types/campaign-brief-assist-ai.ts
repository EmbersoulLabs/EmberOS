import { z } from "zod";
import { CAMPAIGN_BRIEF_ASSIST_ACTIONS } from "../campaign-brief-assist";

/** Shared Zod contracts for Campaign Brief Assist Skill (PD-014 / PD-041 / PD-044). */
export const CampaignBriefAssistSkillInputSchema = z.object({
  action: z.enum(CAMPAIGN_BRIEF_ASSIST_ACTIONS),
  text: z.string().trim().min(1).max(10000),
  campaignName: z.string().trim().max(200).optional(),
  objective: z.string().trim().max(500).optional(),
  platforms: z.array(z.string().trim().min(1)).max(20).optional(),
  targetAudience: z.string().trim().max(2000).optional(),
});

export type CampaignBriefAssistSkillInput = z.infer<
  typeof CampaignBriefAssistSkillInputSchema
>;

export const CampaignBriefAssistSkillOutputSchema = z.object({
  text: z.string().trim().min(1).max(10000),
});

export type CampaignBriefAssistSkillOutput = z.infer<
  typeof CampaignBriefAssistSkillOutputSchema
>;

export function normalizeCampaignBriefAssistOutput(
  raw: unknown
): CampaignBriefAssistSkillOutput {
  const parsed = CampaignBriefAssistSkillOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid brief assist output");
  }
  return parsed.data;
}
