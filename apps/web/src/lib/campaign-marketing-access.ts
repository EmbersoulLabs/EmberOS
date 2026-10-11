type CampaignRead = {
  id: string;
  name: string;
  status: string;
  platforms: string[];
  goal: string | null;
  objective: string | null;
  objectiveCustom: string | null;
  targetAudience: unknown;
  campaignBrief: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type MarketingTaskRead = {
  id: string;
  status: string;
  campaignId: string;
  createdAt: Date | string;
  stepProgress: unknown;
} | null;

function marketingStepProgress(value: unknown): Record<string, unknown> {
  const progress = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const next: Record<string, unknown> = {};
  if (progress.content_generate) next.content_generate = progress.content_generate;
  if (progress.strategy_plan) next.strategy_plan = progress.strategy_plan;
  return next;
}

/** Campaign fields an editor needs to render Marketing Studio, without operational records. */
export function projectMarketingCampaignRead(campaign: CampaignRead, task: MarketingTaskRead) {
  return {
    campaignAccess: "marketing" as const,
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      platforms: campaign.platforms,
      goal: campaign.goal,
      objective: campaign.objective,
      objectiveCustom: campaign.objectiveCustom,
      targetAudience: campaign.targetAudience,
      campaignBrief: campaign.campaignBrief,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
    },
    assets: [],
    assetStories: [],
    task: task
      ? {
          id: task.id,
          status: task.status,
          campaignId: task.campaignId,
          createdAt: task.createdAt,
          stepProgress: marketingStepProgress(task.stepProgress),
        }
      : null,
    creative: null,
    creatives: [],
    hasVideoAsset: false,
    clipCount: 0,
    canDelete: false,
  };
}
