import { z } from "zod";

export const CAMPAIGN_CONTENT_ITERATION_CONTRACT_VERSION = "campaign-content-iteration.v1" as const;

export const CAMPAIGN_CONTENT_ITERATION_STATES = [
  "PLANNING", "PLAN_APPROVED", "CREATIVE_IN_PROGRESS", "MARKETING_REVIEW",
  "REVISION_REQUIRED", "REWORK_REQUIRED", "APPROVED", "SOCIAL_CONTENT_READY",
  "PUBLISHED", "NEXT_RECOMMENDED", "COMPLETED", "CANCELLED",
] as const;

export const CampaignContentIterationStateSchema = z.enum(CAMPAIGN_CONTENT_ITERATION_STATES);
export type CampaignContentIterationState = z.infer<typeof CampaignContentIterationStateSchema>;

export const CAMPAIGN_WORKFLOW_FACT_TYPES = [
  "ITERATION_CREATED", "STATE_TRANSITIONED", "PLAN_PROPOSED", "PLAN_APPROVED",
  "MODULE_SELECTED", "ARTIFACT_ATTACHED", "MARKETING_REVIEW_DECIDED",
  "SOCIAL_CONTENT_PREPARED", "PUBLICATION_CONFIRMED", "NEXT_CONTENT_RECOMMENDED",
  "NEXT_CONTENT_APPROVED",
] as const;

export const CampaignWorkflowFactTypeSchema = z.enum(CAMPAIGN_WORKFLOW_FACT_TYPES);
export type CampaignWorkflowFactType = z.infer<typeof CampaignWorkflowFactTypeSchema>;

export const CAMPAIGN_CREATIVE_ARTIFACT_TYPES = ["VIDEO_TASK", "PHOTO_SCENE_GENERATION", "AI_STORY"] as const;
export const CampaignCreativeArtifactTypeSchema = z.enum(CAMPAIGN_CREATIVE_ARTIFACT_TYPES);
export type CampaignCreativeArtifactType = z.infer<typeof CampaignCreativeArtifactTypeSchema>;

const transitions: Readonly<Record<CampaignContentIterationState, readonly CampaignContentIterationState[]>> = {
  PLANNING: ["PLAN_APPROVED", "CANCELLED"],
  PLAN_APPROVED: ["CREATIVE_IN_PROGRESS", "CANCELLED"],
  CREATIVE_IN_PROGRESS: ["MARKETING_REVIEW", "CANCELLED"],
  MARKETING_REVIEW: ["REVISION_REQUIRED", "REWORK_REQUIRED", "APPROVED", "CANCELLED"],
  REVISION_REQUIRED: ["CREATIVE_IN_PROGRESS", "CANCELLED"],
  REWORK_REQUIRED: ["CREATIVE_IN_PROGRESS", "CANCELLED"],
  APPROVED: ["SOCIAL_CONTENT_READY", "CANCELLED"],
  SOCIAL_CONTENT_READY: ["PUBLISHED", "CANCELLED"],
  PUBLISHED: ["NEXT_RECOMMENDED", "COMPLETED"],
  NEXT_RECOMMENDED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionCampaignContentIteration(from: CampaignContentIterationState, to: CampaignContentIterationState): boolean {
  return transitions[from].includes(to);
}

export const CampaignWorkflowFactPayloadSchema = z.record(z.string(), z.unknown());
