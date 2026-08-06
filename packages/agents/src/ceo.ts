import { buildDefaultTaskGraph, callJsonModel } from "./llm";
import {
  TaskGraphSchema,
  strategyAudienceSummary,
  type CampaignAIContext,
  type KnowledgeSnippet,
} from "@ceo-agent/shared";
import { formatKnowledgeForPrompt } from "./knowledge/query";

/**
 * CEO Planning — AD-001
 * Required: campaignContext, assetSummary, costBudgetUsd
 * Optional: knowledgeSnippets, campaignName, videoAnalysis
 * Consumes from context: campaignObjective, publishingPlatforms, businessProfile, strategy
 */
export interface CeoInput {
  campaignContext: CampaignAIContext;
  assetSummary: string;
  costBudgetUsd: number;
  knowledgeSnippets?: KnowledgeSnippet[];
  campaignName?: string;
  videoAnalysis?: string | null;
}

export async function runCeoAgent(input: CeoInput) {
  const ctx = input.campaignContext;
  const goal = ctx.campaignObjective;
  const platforms = ctx.publishingPlatforms;
  const brandProfile = ctx.businessProfile;
  const strategyPlan = ctx.strategy ?? undefined;

  const knowledgeBlock = input.knowledgeSnippets?.length
    ? formatKnowledgeForPrompt(input.knowledgeSnippets)
    : "";

  const system = `You are the CEO Orchestrator for EmberOS — an AI Marketing Operating System.
You plan task graphs but do NOT generate copy or edit instructions directly.
Cost budget: $${input.costBudgetUsd}. Platforms: ${platforms.join(", ")}.
Brand tone: ${brandProfile.tone ?? "professional"}. Banned words: ${(brandProfile.bannedWords ?? []).join(", ") || "none"}.
${strategyPlan ? `Strategy: goal=${strategyPlan.marketingGoal}, audience=${strategyAudienceSummary(strategyPlan)}, angle=${strategyPlan.marketingAngle}, tone=${strategyPlan.tone}, CTA=${strategyPlan.ctaStrategy}` : ""}
${knowledgeBlock ? `Industry knowledge:\n${knowledgeBlock}` : ""}`;

  const user = `Campaign: ${input.campaignName ?? "untitled"}
Goal: ${goal}
Assets: ${input.assetSummary}
${strategyPlan ? `Strategy plan: ${JSON.stringify(strategyPlan)}` : ""}
${input.videoAnalysis ? `\n${input.videoAnalysis}` : ""}
Generate a TaskGraph JSON with steps for strategy, vision, hooks, copy, edit, render, compliance, score, review, platform adapt.`;

  const { result, usage } = await callJsonModel<unknown>(system, user, TaskGraphSchema.toString());

  const parsed = TaskGraphSchema.safeParse(result);
  const taskGraph = parsed.success ? parsed.data : buildDefaultTaskGraph();

  return { taskGraph, usage };
}

export function parseIntent(goal: string, platforms: string[]) {
  return {
    intent: goal,
    platforms,
    parsedAt: new Date().toISOString(),
  };
}
