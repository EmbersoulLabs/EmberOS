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

const OPERATIONAL_WORKSPACE_ROLES = new Set(["admin", "operator"]);

/** Operator and workspace admin keep the existing operational task payload. */
export function isOperationalWorkspaceRole(role: string): boolean {
  return OPERATIONAL_WORKSPACE_ROLES.has(role);
}

type MarketingTaskResponseRead = {
  id: string;
  status: string;
  campaignId: string;
  workspaceId: string;
  createdAt: Date | string;
  stepProgress: unknown;
};

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

/** Task fields below operator. Omits execution identity, cost, prompts, and signed media. */
export function projectMarketingTaskRead(task: MarketingTaskResponseRead) {
  const stepProgress = marketingStepProgress(task.stepProgress);
  return {
    taskAccess: "marketing" as const,
    task: {
      id: task.id,
      status: task.status,
      campaignId: task.campaignId,
      workspaceId: task.workspaceId,
      createdAt: task.createdAt,
      stepProgress,
    },
    stepProgress,
    creative: null,
    creatives: [] as [],
    clipCount: 0,
  };
}
