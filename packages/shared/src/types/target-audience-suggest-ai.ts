import { z } from "zod";

/**
 * PD-044 Target Audience AI Suggest — one proposal per invocation.
 * Context: Objective, Platforms, Campaign Brief, Business Profile, Workspace Language.
 */
export const TargetAudienceSuggestSkillInputSchema = z.object({
  objective: z.string().trim().max(500).optional(),
  platforms: z.array(z.string().trim().min(1)).max(20).optional(),
  campaignBrief: z.string().trim().max(10000).optional(),
  businessProfileSummary: z.string().trim().max(4000).optional(),
  workspaceLanguage: z.string().trim().max(32).optional(),
  currentAudience: z.string().trim().max(2000).optional(),
});

export type TargetAudienceSuggestSkillInput = z.infer<
  typeof TargetAudienceSuggestSkillInputSchema
>;

export const TargetAudienceSuggestSkillOutputSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

export type TargetAudienceSuggestSkillOutput = z.infer<
  typeof TargetAudienceSuggestSkillOutputSchema
>;

export function normalizeTargetAudienceSuggestOutput(
  raw: unknown
): TargetAudienceSuggestSkillOutput {
  const parsed = TargetAudienceSuggestSkillOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid target audience suggest output"
    );
  }
  return parsed.data;
}

export const TargetAudienceSuggestBodySchema = TargetAudienceSuggestSkillInputSchema;
