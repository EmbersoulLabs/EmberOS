import { callJsonModel } from "@ceo-agent/agents";
import type { CampaignBriefAssistAction } from "@ceo-agent/shared";

const ACTION_INSTRUCTIONS: Record<CampaignBriefAssistAction, string> = {
  polish:
    "Improve wording, grammar, clarity, and structure without changing meaning or campaign direction. Do not invent new facts, offers, products, audiences, or claims.",
  expand:
    "Expand the short idea into one sufficiently complete Campaign Brief using only the provided text and optional campaign context. Do not invent unsupported business facts, offers, products, audiences, or claims.",
  shorten:
    "Condense the text while preserving essential meaning, constraints, and user intent. Do not invent new content.",
};

/**
 * PD-041: one action → one proposed brief result.
 */
export async function assistCampaignBrief(input: {
  action: CampaignBriefAssistAction;
  text: string;
  campaignName?: string;
  objective?: string;
}): Promise<string> {
  const { result } = await callJsonModel<{ text?: string }>(
    `You assist with Campaign Brief writing. ${ACTION_INSTRUCTIONS[input.action]} Return exactly one result. Never return multiple versions.`,
    JSON.stringify({
      action: input.action,
      currentBrief: input.text,
      campaignName: input.campaignName ?? null,
      objective: input.objective ?? null,
    }),
    '{ "text": string }',
    { model: "gpt-4o-mini" }
  );
  const next = result.text?.trim();
  if (!next) throw new Error("Empty AI brief result");
  return next.slice(0, 10000);
}
