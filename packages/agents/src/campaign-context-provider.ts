/**
 * AD-001 — Orchestrator-owned Campaign AI Context provider.
 *
 * This is the ONLY application entry that may call `buildCampaignAIContext`.
 * Campaign AI modules must receive context from the Orchestrator (or pipeline
 * paths that use this provider); they must never assemble Campaign context.
 */
import {
  buildCampaignAIContext,
  withCampaignAIContext,
  type BuildCampaignAIContextInput,
  type CampaignAIContext,
} from "@ceo-agent/shared";

export type ProvideCampaignAIContextInput = BuildCampaignAIContextInput;

/** Construct the canonical CampaignAIContext for a Campaign AI run. */
export function provideCampaignAIContext(
  input: ProvideCampaignAIContextInput
): CampaignAIContext {
  return buildCampaignAIContext(input);
}

/** Enrich optional fields without allowing modules to rebuild core context. */
export function enrichCampaignAIContext(
  base: CampaignAIContext,
  patch: Parameters<typeof withCampaignAIContext>[1]
): CampaignAIContext {
  return withCampaignAIContext(base, patch);
}

export type { CampaignAIContext, ProvideCampaignAIContextInput as CampaignAIContextInput };
