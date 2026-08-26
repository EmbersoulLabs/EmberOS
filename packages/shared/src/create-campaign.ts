import { z } from "zod";
import { PublishingPlatformsSchema } from "./publishing-platforms";

export const CAMPAIGN_OBJECTIVE_IDS = [
  "awareness",
  "engagement",
  "sales",
  "lead_generation",
  "other",
] as const;

export type CampaignObjectiveId = (typeof CAMPAIGN_OBJECTIVE_IDS)[number];

export const CAMPAIGN_OBJECTIVE_LABELS: Record<CampaignObjectiveId, string> = {
  awareness: "Awareness",
  engagement: "Engagement",
  sales: "Sales",
  lead_generation: "Lead Generation",
  other: "Other",
};

const UniqueStrings = z
  .array(z.string().trim().min(1).max(120))
  .max(30)
  .transform((values) => [...new Set(values)]);

export const CreateCampaignTargetAudienceSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  demographics: UniqueStrings.default([]),
  interests: UniqueStrings.default([]),
  needs: UniqueStrings.default([]),
  locations: UniqueStrings.default([]),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateCampaignTargetAudience = z.infer<
  typeof CreateCampaignTargetAudienceSchema
>;

const UniqueUuidList = (max: number) =>
  z.array(z.string().uuid()).max(max).refine(
    (values) => new Set(values).size === values.length,
    "References must be unique"
  );

export const CreateCampaignContextSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    workspaceId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    objective: z.enum(CAMPAIGN_OBJECTIVE_IDS),
    customObjective: z.string().trim().min(1).max(500).optional(),
    publishingPlatforms: PublishingPlatformsSchema.refine(
      (values) => values.length > 0,
      "Select at least one Publishing Platform"
    ),
    targetAudience: CreateCampaignTargetAudienceSchema,
    assetReferences: UniqueUuidList(200).default([]),
    assetStoryReferences: UniqueUuidList(50).default([]),
    campaignBrief: z.string().trim().max(10000).optional(),
    inferredLanguage: z.enum(["en", "zh", "ms"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.objective === "other" && !value.customObjective?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customObjective"],
        message: "Custom Objective is required",
      });
    }
    if (value.assetReferences.length + value.assetStoryReferences.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assetReferences"],
        message: "Select at least one Asset or Asset Story",
      });
    }
  });

export type CreateCampaignContext = z.infer<typeof CreateCampaignContextSchema>;

export function campaignObjectiveText(input: {
  objective: CampaignObjectiveId;
  customObjective?: string;
}): string {
  return input.objective === "other"
    ? input.customObjective?.trim() || CAMPAIGN_OBJECTIVE_LABELS.other
    : CAMPAIGN_OBJECTIVE_LABELS[input.objective];
}

export const CampaignAudienceSuggestBodySchema = z.object({
  objective: z.string().trim().min(1).max(500),
  platforms: PublishingPlatformsSchema,
  campaignBrief: z.string().trim().max(10000).optional(),
  currentAudience: z.string().trim().max(2000).optional(),
  workspaceLanguage: z.enum(["en", "zh", "ms"]).default("en"),
});

export const CAMPAIGN_BRIEF_ASSIST_ACTIONS = ["polish", "expand", "shorten"] as const;
export type CampaignBriefAssistAction = (typeof CAMPAIGN_BRIEF_ASSIST_ACTIONS)[number];

export const CampaignBriefAssistBodySchema = z.object({
  action: z.enum(CAMPAIGN_BRIEF_ASSIST_ACTIONS),
  text: z.string().trim().min(1).max(10000),
  campaignName: z.string().trim().max(200).optional(),
  objective: z.string().trim().max(500).optional(),
  platforms: PublishingPlatformsSchema.optional(),
  targetAudience: z.string().trim().max(2000).optional(),
  workspaceLanguage: z.enum(["en", "zh", "ms"]).default("en"),
});
