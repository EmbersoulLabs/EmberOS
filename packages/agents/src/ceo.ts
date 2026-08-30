import { buildDefaultTaskGraph, callJsonModel } from "./llm";
import {
  TaskGraphSchema,
  strategyAudienceSummary,
  type BrandProfile,
  type StrategyPlan,
  type KnowledgeSnippet,
} from "@ceo-agent/shared";
import { formatKnowledgeForPrompt } from "./knowledge/query";

export interface CeoInput {
  goal: string;
  platforms: string[];
  assetSummary: string;
  brandProfile: BrandProfile;
  costBudgetUsd: number;
  strategyPlan?: StrategyPlan;
  knowledgeSnippets?: KnowledgeSnippet[];
  campaignName?: string;
  videoAnalysis?: string | null;
}

export async function runCeoAgent(input: CeoInput) {
  const knowledgeBlock = input.knowledgeSnippets?.length
    ? formatKnowledgeForPrompt(input.knowledgeSnippets)
    : "";

  const system = `You are the CEO Orchestrator for EmberOS — an AI Marketing Operating System.
You plan task graphs but do NOT generate copy or edit instructions directly.
Cost budget: $${input.costBudgetUsd}. Platforms: ${input.platforms.join(", ")}.
Brand tone: ${input.brandProfile.tone ?? "professional"}. Banned words: ${(input.brandProfile.bannedWords ?? []).join(", ") || "none"}.
${input.strategyPlan ? `Strategy: goal=${input.strategyPlan.marketingGoal}, audience=${strategyAudienceSummary(input.strategyPlan)}, angle=${input.strategyPlan.marketingAngle}, tone=${input.strategyPlan.tone}, CTA=${input.strategyPlan.ctaStrategy}` : ""}
${knowledgeBlock ? `Industry knowledge:\n${knowledgeBlock}` : ""}`;

  const user = `Campaign: ${input.campaignName ?? "untitled"}
Goal: ${input.goal}
Assets: ${input.assetSummary}
${input.strategyPlan ? `Strategy plan: ${JSON.stringify(input.strategyPlan)}` : ""}
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
